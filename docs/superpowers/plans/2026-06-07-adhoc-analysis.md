# Ad-hoc Analysis From Anywhere Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Written for a COLD START — no prior session context needed. **Implement the Run Annotations plan first if both are queued** (this plan is independent but assumes Supabase is the system of record, which it is as of 2026-06-07).

**Goal:** Query and analyze the Ventis dataset against the Supabase system-of-record from any machine (not laptop-bound), repeatably and safely (read-only).

**Architecture:** Three pieces. (1) Reusable SQL **views** in Supabase for common aggregates. (2) A small **`analyze.py` CLI** that connects via `SUPABASE_DB_URL`, runs either a named query from a version-controlled library or an ad-hoc `--sql`, refuses anything that isn't read-only, and prints a table or writes CSV/JSON. (3) A **query library** of `.sql` files under version control. "From anywhere" = anyone with the read connection string and the repo can run the same analyses; nothing depends on the laptop's SQLite.

**Tech Stack:** Python (psycopg, pytest), Supabase Postgres. No new web surface, no new deps beyond `psycopg` (already in `site/scripts/requirements.txt`).

**Orientation for a cold start — read first:**
- `site/scripts/supabase_schema.sql` — the `readings` + `runs` tables (and `consent`, `annotations` if those plans shipped). Views are appended here.
- `site/scripts/sqlite_sync.py` — has a `run_query(sql)` helper + `--sql` CLI that prints a result table. `analyze.py` is the Postgres analog; mirror its print format.
- `site/scripts/reconcile_consent.py` / `supabase_sync.py` — the psycopg `dict_row` connection pattern to reuse.

**Conventions confirmed:**
- **Read-only:** `analyze.py` rejects any statement that is not a single `SELECT`/`WITH` query. The connection string is the privileged `postgres` role, so the guard is enforced in code (reject `;`-chained statements and non-SELECT leading keywords).
- Views are prefixed `v_` and live in Supabase (added to the schema file; a human runs the DDL once).
- Output: pretty table by default; `--csv PATH` and `--json` for machine use.

---

## Prerequisite (Diego — manual, one-time)

- [ ] Run the analysis-views DDL (Task 1) in the Supabase SQL editor. (Independent of the CLI; the CLI also runs ad-hoc SQL without the views.)
- [ ] Have `SUPABASE_DB_URL` available wherever you run `analyze.py` (Session-pooler URI).

---

## Task 1: Reusable analysis views in the schema

**Files:**
- Modify: `site/scripts/supabase_schema.sql`

- [ ] **Step 1: Append the views**

Add to the end of `site/scripts/supabase_schema.sql`:

```sql

-- ---- Analysis views (read-only aggregates over the SoR) ---------------------
-- Per-run summary with duration + ASHRAE exceedance.
create or replace view v_run_summary as
select r.run_key, r.run_id, r.condition, r.device_id,
       r.start_ts, r.end_ts,
       round(extract(epoch from (r.end_ts - r.start_ts)) / 3600.0, 2) as duration_h,
       r.n_rows, r.co2_mean, r.co2_peak,
       (r.co2_peak > 1000) as ashrae_exceed
from runs r;

-- Building/occupancy comparison: averaged CO2 across runs sharing a condition.
create or replace view v_building_compare as
select condition,
       count(*)                         as runs,
       round(avg(co2_mean)::numeric, 1) as avg_co2_mean,
       max(co2_peak)                    as max_co2_peak,
       sum(n_rows)                      as total_readings
from runs
group by condition
order by avg_co2_mean desc nulls last;

-- Per-run share of readings over the ASHRAE 1000 ppm line.
create or replace view v_ashrae_exceedance as
select rd.run_key,
       count(*)                                                       as readings,
       count(*) filter (where rd.co2_ppm > 1000)                      as over_1000,
       round(100.0 * count(*) filter (where rd.co2_ppm > 1000)
             / nullif(count(*), 0), 1)                                as pct_over_1000
from readings rd
where rd.co2_ppm is not null
group by rd.run_key
order by pct_over_1000 desc nulls last;
```

- [ ] **Step 2: Commit**

```bash
git add site/scripts/supabase_schema.sql
git commit -m "feat(analysis): reusable analysis views (run summary, building compare, ASHRAE)"
```

---

## Task 2: `analyze.py` — read-only guard + query resolution (pure, TDD)

**Files:**
- Create: `site/scripts/analyze.py`
- Test: `site/scripts/tests/test_analyze.py`

- [ ] **Step 1: Write the failing tests**

`site/scripts/tests/test_analyze.py`:

```python
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pytest
from analyze import is_read_only, resolve_query, format_table


def test_is_read_only_allows_select_and_with():
    assert is_read_only("select * from runs")
    assert is_read_only("  SELECT 1")
    assert is_read_only("with x as (select 1) select * from x")


def test_is_read_only_rejects_writes_and_chains():
    assert not is_read_only("update runs set co2_peak=0")
    assert not is_read_only("delete from runs")
    assert not is_read_only("drop view v_run_summary")
    assert not is_read_only("select 1; drop table runs")     # no chained statements
    assert not is_read_only("")


def test_resolve_query_named(tmp_path):
    qdir = tmp_path / "analysis"; qdir.mkdir()
    (qdir / "buildings.sql").write_text("select * from v_building_compare")
    assert resolve_query("buildings", qdir=str(qdir)) == "select * from v_building_compare"


def test_resolve_query_unknown_raises(tmp_path):
    qdir = tmp_path / "analysis"; qdir.mkdir()
    with pytest.raises(SystemExit):
        resolve_query("nope", qdir=str(qdir))


def test_format_table():
    out = format_table([{"condition": "fahey", "runs": 1}, {"condition": "judge", "runs": 2}])
    assert "condition" in out and "fahey" in out and "judge" in out
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest site/scripts/tests/test_analyze.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'analyze'`

- [ ] **Step 3: Write `analyze.py`**

`site/scripts/analyze.py`:

```python
"""Ad-hoc, read-only analysis of the Ventis Supabase system-of-record, from anywhere.

Run a named query from the version-controlled library (site/scripts/analysis/*.sql)
or an ad-hoc SELECT. Read-only by construction: anything that isn't a single
SELECT/WITH query is refused. Output is a table, CSV, or JSON.

Env: SUPABASE_DB_URL (Session-pooler URI).

Usage:
  python analyze.py --list                       # list named queries
  python analyze.py --name buildings             # run a named query
  python analyze.py --sql "select * from v_run_summary order by co2_peak desc"
  python analyze.py --name buildings --csv out.csv
  python analyze.py --sql "select count(*) from readings" --json
"""
import csv
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
QDIR = os.path.join(HERE, "analysis")


def is_read_only(sql):
    """True iff sql is a single SELECT/WITH query (no chained/extra statements, no writes)."""
    s = (sql or "").strip().rstrip(";").strip()
    if not s:
        return False
    if ";" in s:                      # reject chained statements
        return False
    head = s.split(None, 1)[0].lower()
    return head in ("select", "with")


def resolve_query(name, qdir=QDIR):
    path = os.path.join(qdir, f"{name}.sql")
    if not os.path.exists(path):
        avail = ", ".join(sorted(os.path.splitext(os.path.basename(p))[0]
                                 for p in glob.glob(os.path.join(qdir, "*.sql")))) or "(none)"
        print(f"unknown query '{name}'. available: {avail}")
        raise SystemExit(2)
    with open(path, encoding="utf-8") as f:
        return f.read().strip()


def _run(sql, db_url):
    import psycopg
    from psycopg.rows import dict_row
    with psycopg.connect(db_url) as con, con.cursor(row_factory=dict_row) as cur:
        cur.execute(sql)
        return cur.fetchall()


def format_table(rows):
    if not rows:
        return "(0 rows)"
    cols = list(rows[0].keys())
    widths = {c: max(len(c), *(len(str(r.get(c, ""))) for r in rows)) for c in cols}
    line = "  ".join(c.ljust(widths[c]) for c in cols)
    sep = "  ".join("-" * widths[c] for c in cols)
    body = "\n".join("  ".join(str(r.get(c, "")).ljust(widths[c]) for c in cols) for r in rows)
    return f"{line}\n{sep}\n{body}\n({len(rows)} rows)"


def list_queries(qdir=QDIR):
    names = sorted(os.path.splitext(os.path.basename(p))[0] for p in glob.glob(os.path.join(qdir, "*.sql")))
    print("named queries:" if names else "no named queries yet")
    for n in names:
        print(f"  {n}")


def main(argv):
    if "--list" in argv:
        list_queries()
        return 0

    if "--name" in argv:
        sql = resolve_query(argv[argv.index("--name") + 1])
    elif "--sql" in argv:
        sql = argv[argv.index("--sql") + 1]
    else:
        print(__doc__)
        return 1

    if not is_read_only(sql):
        print("refused: analyze.py runs a single read-only SELECT/WITH query only")
        return 2

    db = os.environ.get("SUPABASE_DB_URL")
    if not db:
        print("SUPABASE_DB_URL not set")
        return 2

    rows = _run(sql, db)

    if "--csv" in argv:
        out = argv[argv.index("--csv") + 1]
        with open(out, "w", newline="", encoding="utf-8") as f:
            if rows:
                w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
                w.writeheader()
                w.writerows(rows)
        print(f"wrote {len(rows)} rows -> {out}")
    elif "--json" in argv:
        print(json.dumps(rows, default=str, indent=2))
    else:
        print(format_table(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest site/scripts/tests/test_analyze.py -q`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add site/scripts/analyze.py site/scripts/tests/test_analyze.py
git commit -m "feat(analysis): analyze.py read-only CLI (named + ad-hoc queries, TDD)"
```

---

## Task 3: Query library

**Files:**
- Create: `site/scripts/analysis/buildings.sql`
- Create: `site/scripts/analysis/runs.sql`
- Create: `site/scripts/analysis/ashrae.sql`

- [ ] **Step 1: Create the three starter queries**

`site/scripts/analysis/buildings.sql`:
```sql
select * from v_building_compare
```

`site/scripts/analysis/runs.sql`:
```sql
select condition, date(start_ts) as date, duration_h, co2_mean, co2_peak, ashrae_exceed
from v_run_summary
order by start_ts
```

`site/scripts/analysis/ashrae.sql`:
```sql
select e.run_key, s.condition, e.readings, e.over_1000, e.pct_over_1000
from v_ashrae_exceedance e
join v_run_summary s using (run_key)
order by e.pct_over_1000 desc nulls last
```

- [ ] **Step 2: Commit**

```bash
git add site/scripts/analysis/
git commit -m "feat(analysis): starter query library (buildings, runs, ashrae)"
```

---

## Task 4: Docs + verification

**Files:**
- Create: `docs/ventis-analysis.md`

- [ ] **Step 1: Write the how-to**

`docs/ventis-analysis.md`:

```markdown
# Analyzing the Ventis dataset from anywhere

The dataset lives in Supabase (the system of record). Any machine with the repo
and the read connection string can run the same analyses. Nothing depends on a
laptop's local copy.

## Setup
1. Get `SUPABASE_DB_URL` (the Session-pooler URI) from your password manager.
2. `pip install -r site/scripts/requirements.txt`
3. `export SUPABASE_DB_URL="postgresql://..."`  (PowerShell: `$env:SUPABASE_DB_URL="..."`)

## Run
- List saved analyses:           `python site/scripts/analyze.py --list`
- A saved analysis:              `python site/scripts/analyze.py --name buildings`
- Ad-hoc (read-only):            `python site/scripts/analyze.py --sql "select * from v_run_summary"`
- To CSV / JSON:                 add `--csv out.csv` or `--json`

`analyze.py` refuses anything that is not a single read-only SELECT/WITH query.

## Saved analyses
- `buildings` — avg/peak CO2 by condition (building + occupancy)
- `runs` — every run with duration + ASHRAE flag
- `ashrae` — % of each run's readings over 1000 ppm

Add more by dropping a `.sql` file in `site/scripts/analysis/`.

## The Supabase SQL editor
For one-off exploration you can also use Supabase -> SQL Editor directly; the
`v_*` views are there too. Keep anything you'll re-run in `analysis/` so it's
versioned and shareable.
```

- [ ] **Step 2: Add an Operations SOP pointer (gated catalog)**

In `library/src/components/OperationsPage.tsx`, add a short card:

```tsx
      <h2 style={h2}>Analyzing the data</h2>
      <div style={card}>
        Query the system-of-record from anywhere (read-only):
        <code style={code}>python site/scripts/analyze.py --name buildings</code> (or
        <code style={code}>--sql "..."</code>, <code style={code}>--list</code>). Full guide:
        <code style={code}>docs/ventis-analysis.md</code>.
      </div>
```

Run: `cd library && npm run build` → PASS.

- [ ] **Step 3: Commit**

```bash
git add docs/ventis-analysis.md library/src/components/OperationsPage.tsx
git commit -m "docs(analysis): from-anywhere analysis guide + Operations pointer"
```

- [ ] **Step 4: End-to-end (needs the views DDL + SUPABASE_DB_URL)**

```bash
python site/scripts/analyze.py --list                 # lists buildings/runs/ashrae
python site/scripts/analyze.py --name buildings        # prints the comparison table
python site/scripts/analyze.py --sql "drop table runs" # must REFUSE (read-only guard)
```
Confirm the first two print real rows and the third is refused.

- [ ] **Step 5: Open the PR**

```bash
git push -u Ventis feat-adhoc-analysis
```
PR to `main`; merge after verification. (No CI change — `analyze.py` is an on-demand tool, not part of the pipeline.)

---

## Self-review notes
- Read-only by construction (Task 2 guard) — the privileged connection string can't be used to mutate via this tool. Verified by tests + the e2e refusal check.
- No new pipeline step, no new web surface, no new deps — lowest-risk addition; "from anywhere" = repo + connection string.
- Views are `create or replace` (safe to re-run). Independent of the annotations plan.
- Out of scope: charts/plots (use the existing `plot_ventis_run.py` on CSV output if needed), scheduled/materialized aggregates (`v_*` are plain views; promote to materialized later if a query gets slow).
