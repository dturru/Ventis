# Run Annotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This plan is written for a COLD START — no prior session context needed.

**Goal:** Let the founders attach a note + quality flag to any run, stored in Supabase, surfaced in the gated catalog.

**Architecture:** Mirrors the consent ledger exactly. A founder CLI (`annotate.py`) upserts into a Supabase `annotations` table (keyed by `run_key`); `build_catalog` merges annotations into each run record (non-fatal if absent); the catalog UI (`RunDetail`, `RunTable`) displays the note + a quality badge. Read-only in the browser — no web write path, no auth needed (writes happen via the founder CLI, exactly like consent).

**Tech Stack:** Python (psycopg, pytest) for the CLI + merge; React/Vite + vitest for the catalog UI; Supabase Postgres.

**Orientation for a cold start — read these existing files first; this feature is a near-clone of the consent pattern:**
- `site/scripts/consent_ledger.py` — the dual-path (Supabase-vs-CSV) CLI + `merge_consent` to copy. `annotate.py` is structurally identical.
- `site/scripts/build_catalog.py` — see how `merge_consent(records, load_ledger())` is called inside `build()` in a try/except; annotations merge goes right next to it.
- `site/scripts/supabase_schema.sql` — where the `annotations` table DDL is added.
- `library/src/lib/catalog.ts` (the `Run` interface), `library/src/components/RunDetail.tsx` (the detail rows incl. the Consent row), `library/src/components/RunTable.tsx` (the table + ASHRAE badge) — where the UI changes go.
- `site/scripts/tests/test_consent_ledger.py` and `library/src/lib/catalog.test.ts` — test styles to mirror.

**Conventions confirmed:**
- Quality flags: `good` | `caution` | `exclude` (anything else = no flag). `exclude` means "do not use this run in analysis/figures."
- One annotation row per run (upsert by `run_key`). Multiple timestamped notes are out of scope for v1.
- `updated_by` = a founder pseudonym (never an occupant identity).
- Annotations are NON-destructive metadata; they never alter readings/runs.

---

## Prerequisite (Diego — manual, one-time, before Task 5 e2e)

- [ ] Run the `annotations` DDL (Task 1) in the Supabase SQL editor. (`build_catalog` is non-fatal if the table is missing, so merge order is safe.)

---

## Task 1: Add the `annotations` table to the schema

**Files:**
- Modify: `site/scripts/supabase_schema.sql`

- [ ] **Step 1: Append the table**

Add to the end of `site/scripts/supabase_schema.sql`:

```sql

-- Founder run annotations: note + quality flag per run (keyed by run_key).
-- Written by annotate.py; read by build_catalog into each run record. No PII.
create table if not exists annotations (
  run_key      text primary key,
  note         text,
  quality_flag text,                 -- good | caution | exclude (else: no flag)
  tags         text,                  -- optional, comma-separated
  updated_by   text,                  -- founder pseudonym, never an occupant
  updated_at   timestamptz default now()
);
```

- [ ] **Step 2: Commit**

```bash
git add site/scripts/supabase_schema.sql
git commit -m "feat(annotations): annotations table in schema"
```

---

## Task 2: `annotate.py` — dual-path CLI + merge (pure functions, TDD)

**Files:**
- Create: `site/scripts/annotate.py`
- Test: `site/scripts/tests/test_annotate.py`

This mirrors `consent_ledger.py`. Read that file first; reuse its psycopg/dict_row patterns verbatim.

- [ ] **Step 1: Write the failing tests**

`site/scripts/tests/test_annotate.py`:

```python
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import annotate
from annotate import is_flag_valid, merge_annotations, load_annotations, write_annotations, upsert_annotation


def test_is_flag_valid():
    assert is_flag_valid("good")
    assert is_flag_valid("caution")
    assert is_flag_valid("exclude")
    assert not is_flag_valid("")
    assert not is_flag_valid("banana")


def test_merge_annotations_annotates_records():
    records = [{"run_key": "k1"}, {"run_key": "k2"}]
    annos = {"k1": {"run_key": "k1", "note": "fan died at 2am", "quality_flag": "caution",
                    "tags": "hardware", "updated_by": "diego"}}
    merge_annotations(records, annos)
    assert records[0]["note"] == "fan died at 2am"
    assert records[0]["quality_flag"] == "caution"
    assert records[0]["tags"] == "hardware"
    assert records[1]["note"] == ""           # no annotation -> empty, not missing
    assert records[1]["quality_flag"] == ""
    assert records[1]["tags"] == ""


def test_csv_roundtrip(tmp_path):
    p = tmp_path / "annotations.csv"
    write_annotations({"k1": {"run_key": "k1", "note": "n", "quality_flag": "good",
                              "tags": "", "updated_by": "diego"}}, str(p))
    a = load_annotations(str(p), db_url="")     # force CSV
    assert a["k1"]["quality_flag"] == "good"


def test_load_annotations_routes_to_supabase(monkeypatch):
    seen = {}
    monkeypatch.setattr(annotate, "_load_annotations_pg",
                        lambda url: (seen.update(url=url), {"k": {"note": "x"}})[1])
    a = load_annotations(db_url="postgresql://fake")
    assert seen["url"] == "postgresql://fake" and a["k"]["note"] == "x"


def test_upsert_annotation_routes_to_supabase(monkeypatch):
    cap = {}
    monkeypatch.setattr(annotate, "_upsert_pg", lambda rec, url: cap.update(rec=rec, url=url))
    rec = {"run_key": "k1", "note": "n", "quality_flag": "good", "tags": "", "updated_by": "diego"}
    upsert_annotation(rec, db_url="postgresql://fake")
    assert cap["url"] == "postgresql://fake" and cap["rec"]["quality_flag"] == "good"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest site/scripts/tests/test_annotate.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'annotate'`

- [ ] **Step 3: Write `annotate.py`**

`site/scripts/annotate.py`:

```python
"""Founder run annotations: a note + quality flag per run (the qualitative layer
on top of the measured data). Stored in the Supabase `annotations` table when
SUPABASE_DB_URL is set (read by build_catalog into the catalog), else a local
gitignored archive/annotations.csv. Structurally identical to consent_ledger.py.

Usage:
  python annotate.py --list
  python annotate.py --set <run_key> --note "fan died ~2am" --flag caution --tags hardware --by diego
"""
import csv
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ARCHIVE_DIR = os.path.join(HERE, "archive")
DB = os.path.join(ARCHIVE_DIR, "ventis.db")
STORE = os.path.join(ARCHIVE_DIR, "annotations.csv")

COLS = ["run_key", "note", "quality_flag", "tags", "updated_by"]
VALID_FLAGS = {"good", "caution", "exclude"}


def _db_url():
    return os.environ.get("SUPABASE_DB_URL")


def is_flag_valid(flag):
    return str(flag or "").strip() in VALID_FLAGS


def load_annotations(path=STORE, db_url=None):
    """-> {run_key: record dict}. Supabase when configured, else CSV. db_url="" forces CSV."""
    src = db_url if db_url is not None else _db_url()
    if src:
        return _load_annotations_pg(src)
    if not os.path.exists(path):
        return {}
    with open(path, newline="", encoding="utf-8") as f:
        return {r["run_key"]: r for r in csv.DictReader(f) if r.get("run_key")}


def _load_annotations_pg(db_url):
    import psycopg
    from psycopg.rows import dict_row
    with psycopg.connect(db_url) as con, con.cursor(row_factory=dict_row) as cur:
        cur.execute("select run_key, note, quality_flag, tags, updated_by from annotations")
        rows = cur.fetchall()
    return {r["run_key"]: {k: ("" if v is None else v) for k, v in r.items()}
            for r in rows if r.get("run_key")}


def merge_annotations(records, annos):
    """Annotate catalog run records with note/quality_flag/tags (empty string if none)."""
    for r in records:
        a = annos.get(r.get("run_key")) or {}
        r["note"] = a.get("note", "") or ""
        flag = a.get("quality_flag", "") or ""
        r["quality_flag"] = flag if is_flag_valid(flag) else ""
        r["tags"] = a.get("tags", "") or ""
    return records


def write_annotations(annos, path=STORE):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore")
        w.writeheader()
        for rk in sorted(annos):
            w.writerow(annos[rk])


def _upsert_pg(rec, db_url):
    import psycopg
    p = {c: rec.get(c, "") for c in COLS}
    with psycopg.connect(db_url) as con, con.cursor() as cur:
        cur.execute(
            "insert into annotations (run_key,note,quality_flag,tags,updated_by) "
            "values (%(run_key)s,%(note)s,%(quality_flag)s,%(tags)s,%(updated_by)s) "
            "on conflict (run_key) do update set note=excluded.note, "
            "quality_flag=excluded.quality_flag, tags=excluded.tags, "
            "updated_by=excluded.updated_by, updated_at=now()", p)
        con.commit()


def upsert_annotation(rec, path=STORE, db_url=None):
    src = db_url if db_url is not None else _db_url()
    if src:
        _upsert_pg(rec, src)
    else:
        annos = load_annotations(path, db_url="")
        annos[rec["run_key"]] = rec
        write_annotations(annos, path)


def _db_runs(db_url=None):
    src = db_url if db_url is not None else _db_url()
    if src:
        import psycopg
        from psycopg.rows import dict_row
        with psycopg.connect(src) as con, con.cursor(row_factory=dict_row) as cur:
            cur.execute("select run_key, condition from runs order by start_ts")
            return cur.fetchall()
    if not os.path.exists(DB):
        return []
    con = sqlite3.connect(DB); con.row_factory = sqlite3.Row
    rows = [dict(r) for r in con.execute("SELECT run_key, condition FROM runs ORDER BY start")]
    con.close()
    return rows


def _arg(argv, flag, default=""):
    return argv[argv.index(flag) + 1] if flag in argv and argv.index(flag) + 1 < len(argv) else default


def main(argv):
    store = "Supabase" if _db_url() else f"CSV ({STORE})"
    if "--set" in argv:
        rk = _arg(argv, "--set")
        existing = load_annotations().get(rk, {})
        rec = {
            "run_key": rk,
            "note": _arg(argv, "--note", existing.get("note", "")),
            "quality_flag": _arg(argv, "--flag", existing.get("quality_flag", "")),
            "tags": _arg(argv, "--tags", existing.get("tags", "")),
            "updated_by": _arg(argv, "--by", existing.get("updated_by", "")),
        }
        upsert_annotation(rec)
        print(f"annotated {rk} -> {store}: flag={rec['quality_flag'] or '-'} "
              f"{'(invalid flag)' if rec['quality_flag'] and not is_flag_valid(rec['quality_flag']) else ''}")
        return 0

    annos = load_annotations()
    runs = _db_runs()
    print(f"annotations ({len(annos)} set) -> {store}")
    for r in runs:
        a = annos.get(r["run_key"], {})
        print(f"  [{(a.get('quality_flag') or '-'):8s}] {r['condition']:38s} {a.get('note','')[:50]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest site/scripts/tests/test_annotate.py -q`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add site/scripts/annotate.py site/scripts/tests/test_annotate.py
git commit -m "feat(annotations): annotate.py dual-path CLI + merge (TDD)"
```

---

## Task 3: Merge annotations in `build_catalog`

**Files:**
- Modify: `site/scripts/build_catalog.py`
- Test: `site/scripts/tests/test_build_catalog.py`

- [ ] **Step 1: Add a failing test**

Append to `site/scripts/tests/test_build_catalog.py`:

```python
def test_build_merges_annotations(tmp_path, monkeypatch):
    # build() should annotate run records with note/quality_flag from the annotations store
    import build_catalog as bc
    runs = [{"run_key": "k1", "run_id": "r1", "device_id": "ventis-01",
             "condition": "choates_x_1person", "start": "2026-06-01 21:00:00",
             "end": "2026-06-01 22:00:00", "n_rows": 2, "co2_mean": 800.0, "co2_peak": 1100.0}]
    readings = {"k1": [{"timestamp": "2026-06-01 21:00:00", "co2_ppm": 800.0, "temp_c": 22.0,
                        "humidity_pct": 40.0, "fan_duty": 0.0, "window_state": "closed",
                        "condition": "choates_x_1person"}]}
    monkeypatch.setattr(bc, "_fetch_postgres", lambda url: (runs, readings))
    import annotate
    monkeypatch.setattr(annotate, "load_annotations",
                        lambda *a, **k: {"k1": {"run_key": "k1", "note": "fan died",
                                                "quality_flag": "caution", "tags": ""}})
    out = tmp_path / "out"
    bc.build(out_dir=str(out), graphs_dir=str(tmp_path), db_url="postgresql://fake")
    cat = __import__("json").load(open(out / "catalog.json"))
    assert cat["runs"][0]["note"] == "fan died"
    assert cat["runs"][0]["quality_flag"] == "caution"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python -m pytest site/scripts/tests/test_build_catalog.py::test_build_merges_annotations -q`
Expected: FAIL — `note` not in the record.

- [ ] **Step 3: Add the merge to `build()`**

In `site/scripts/build_catalog.py`, find the existing consent-merge block inside `build()`:

```python
    try:
        from consent_ledger import load_ledger, merge_consent
        merge_consent(records, load_ledger())
    except Exception as e:
        print(f"(consent ledger skipped: {e})")
```

Add directly after it:

```python
    # annotate with founder notes + quality flags (non-fatal if the table is absent)
    try:
        from annotate import load_annotations, merge_annotations
        merge_annotations(records, load_annotations())
    except Exception as e:
        print(f"(annotations skipped: {e})")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest site/scripts/tests/test_build_catalog.py -q`
Expected: PASS (all, including the new test)

- [ ] **Step 5: Commit**

```bash
git add site/scripts/build_catalog.py site/scripts/tests/test_build_catalog.py
git commit -m "feat(annotations): merge notes + quality flag into catalog records"
```

---

## Task 4: Surface annotations in the catalog UI

**Files:**
- Modify: `library/src/lib/catalog.ts`
- Modify: `library/src/components/RunDetail.tsx`
- Modify: `library/src/components/RunTable.tsx`
- Test: `library/src/lib/catalog.test.ts`

- [ ] **Step 1: Extend the `Run` type + a failing test**

In `library/src/lib/catalog.ts`, add to the `Run` interface (near `consent_status`):

```typescript
  note?: string;
  quality_flag?: string;
  tags?: string;
```

Append to `library/src/lib/catalog.test.ts` a test that a run with `quality_flag` parses (mirror the existing parse test in that file — read it first and match its style). If the file only tests transforms, add:

```typescript
import { describe, it, expect } from "vitest";
// ...existing imports...
describe("Run annotation fields", () => {
  it("carries optional note/quality_flag/tags", () => {
    const r = { run_key: "k1", quality_flag: "caution", note: "fan died" } as any;
    expect(r.quality_flag).toBe("caution");
    expect(r.note).toBe("fan died");
  });
});
```

Run: `cd library && npx vitest run src/lib/catalog.test.ts` → expect PASS (type-only change; this guards the shape).

- [ ] **Step 2: Show the note + quality badge in `RunDetail`**

In `library/src/components/RunDetail.tsx`, read how the existing rows array is built (e.g. the `["Consent", ...]` row). Add two rows after the Consent row:

```tsx
    ["Quality", run.quality_flag ? (
      <span style={{
        color: run.quality_flag === "exclude" ? "var(--red)"
             : run.quality_flag === "caution" ? "var(--amber)" : "var(--green)",
        fontWeight: 600,
      }}>{run.quality_flag}</span>
    ) : "—"],
    ["Note", run.note || "—"],
```

(If `var(--amber)` is not defined in the catalog's CSS, use `var(--muted)` instead — check `library/src/*.css` first.)

- [ ] **Step 3: Show a flag badge in `RunTable`**

In `library/src/components/RunTable.tsx`, where each row renders badges (the ASHRAE badge is the model), add next to it, guarded:

```tsx
{run.quality_flag === "exclude" && <span style={badge}>excluded</span>}
{run.quality_flag === "caution" && <span style={badge}>caution</span>}
```

Reuse the existing `badge` style object in that file (read it; match the ASHRAE badge's styling).

- [ ] **Step 4: Build + verify**

Run: `cd library && npm run build` → PASS (tsc + vite).
Run: `cd library && npx vitest run` → PASS (all).
Run: `grep -rn "—" library/src/components/RunDetail.tsx` → the `"—"` placeholders here are UI affordances, acceptable (the em-dash rule targets the public `site/` prose). Leave them.

- [ ] **Step 5: Commit**

```bash
git add library/src/lib/catalog.ts library/src/lib/catalog.test.ts library/src/components/RunDetail.tsx library/src/components/RunTable.tsx
git commit -m "feat(annotations): show note + quality badge in catalog UI"
```

---

## Task 5: Document + end-to-end

**Files:**
- Modify: `library/src/components/OperationsPage.tsx`

- [ ] **Step 1: Add an annotations note to the Operations SOP**

In `library/src/components/OperationsPage.tsx`, add a short card or list item under the SOPs:

```tsx
      <h2 style={h2}>Annotating runs</h2>
      <div style={card}>
        Add a note or quality flag to a run (e.g. a hardware hiccup, or "exclude from figures"):
        <pre style={{ ...code, display: "block", padding: 12, whiteSpace: "pre-wrap" }}>
python site/scripts/annotate.py --set &lt;run_key&gt; --note "fan died ~2am" --flag caution --by diego
        </pre>
        Flags: <code style={code}>good</code> / <code style={code}>caution</code> /
        <code style={code}>exclude</code>. Shows on the run detail + table at the next catalog build.
      </div>
```

Run: `cd library && npm run build` → PASS. Commit:

```bash
git add library/src/components/OperationsPage.tsx
git commit -m "docs(annotations): annotate CLI in Operations SOP"
```

- [ ] **Step 2: End-to-end (needs the Prerequisite DDL + SUPABASE_DB_URL set locally)**

```bash
# from repo root, SUPABASE_DB_URL set in the shell:
python site/scripts/annotate.py --set <a real run_key> --note "test annotation" --flag caution --by diego
python site/scripts/annotate.py --list      # shows the flag + note, store -> Supabase
```
Then trigger the data-library workflow (`workflow_dispatch`) and confirm that run shows the note + caution badge in the catalog. (`build_catalog` reads annotations via the SUPABASE_DB_URL it already has in CI.)

- [ ] **Step 3: Open the PR**

```bash
git push -u Ventis feat-run-annotations
```
PR to `main`; merge after verification.

---

## Self-review notes
- Mirrors consent exactly (CLI dual-path + build_catalog merge + UI display), so a cold-start executor has a working analog for every piece.
- `build_catalog` annotation merge is non-fatal → merge-order-safe (table can be created any time).
- Out of scope (v1): in-browser editing of annotations (needs a write path/auth — defer), multiple timestamped notes per run.
