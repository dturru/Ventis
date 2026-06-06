# Ventis Supabase System-of-Record Migration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Supabase Postgres the durable, always-on, off-laptop system-of-record holding the FULL union of Ventis readings (live Sheet + archived per-run CSVs + pre-Sheet historical), synced hourly by CI. Removes the "dataset lives on one laptop" risk, gives the cofounder SQL access, and survives Sheet pruning.

**Rationale:** Council verdict 2026-06-06 (vault `Council Verdict — Acquisition Roadmap Sequencing 2026-06-06`) — durability is the load-bearing, solo-doable move; the at-risk data is the archived/historical runs that (post-prune) live only on Diego's disk. This is Tier 2 of the storage spec (`Data Storage — run_id + Archival + Scaling Spec`).

**Scope (this cut):** Stand up the schema + an idempotent `supabase_sync.py` that upserts the union into Postgres, run it in CI hourly. KEEP the existing catalog build (reads the CI-rebuilt SQLite) unchanged — Supabase is the durable SoR + cofounder access now; pointing `build_catalog` at Supabase is a **later** step (noted at the end). YAGNI: no firmware change (device still POSTs to the Sheet), no per-user app auth (Supabase dashboard access covers the two founders).

**Tech:** Python 3 + `psycopg` (Postgres driver) + pytest. Supabase free tier. Reuse `sheet_source` / `archive_runs` / `sqlite_sync` row logic (DRY).

**Conventions:** paths relative to repo root. Secrets via env only (never committed). Branch `feat-supabase-sor`.

---

## Prereqs (Diego — manual, one-time)
- **P1.** Create a Supabase project (free tier) at supabase.com → note the **project ref**.
- **P2.** Project → **Settings → Database → Connection string → URI** (the `postgresql://...` string, "session"/"transaction" pooler is fine). This is `SUPABASE_DB_URL`.
- **P3.** Run the schema SQL from Task 1 in the Supabase **SQL Editor** (paste + run).
- **P4.** Add repo secret **`SUPABASE_DB_URL`** (GitHub → Settings → Secrets → Actions). Keep it OUT of git.
- *(These gate Tasks 4 and 6; Tasks 1–3 + 5 are buildable without them.)*

---

## Phase 1 — Schema + row builder

### Task 1: Schema SQL (mirrors sqlite_sync, Postgres-native)

**Files:** Create `site/scripts/supabase_schema.sql`

```sql
-- Ventis system-of-record (Supabase Postgres). Mirrors the SQLite Tier-1 schema.
create table if not exists readings (
  id            bigint generated always as identity primary key,
  timestamp     timestamptz,
  device_id     text,
  run_id        text,
  run_key       text,
  condition     text,
  co2_ppm       double precision,
  temp_c        double precision,
  humidity_pct  double precision,
  fan_duty      double precision,
  window_state  text,
  consent       text,
  unique (device_id, timestamp)
);
create index if not exists idx_readings_run on readings(run_key);
create index if not exists idx_readings_ts  on readings(timestamp);

create table if not exists runs (
  run_key    text primary key,
  run_id     text,
  device_id  text,
  condition  text,
  start_ts   timestamptz,
  end_ts     timestamptz,
  n_rows     integer,
  co2_mean   double precision,
  co2_peak   double precision
);
```
*(Note: `start`/`end` are reserved-ish in SQL → use `start_ts`/`end_ts` here; the sync maps to them.)*

**Step: Commit**
```bash
git add site/scripts/supabase_schema.sql
git commit -m "feat(supabase): Postgres schema for the system-of-record"
```

---

### Task 2: Pure row builder (reuse sqlite_sync's union + normalization)

**Files:** Create `site/scripts/supabase_sync.py`; Test `site/scripts/tests/test_supabase_sync.py`

**Step 1: Failing test** — the builder turns raw union rows into normalized reading dicts (ts normalized, nums coerced, run_key tagged), reusing existing logic.
```python
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from supabase_sync import build_reading_rows

def test_build_reading_rows_normalizes_and_tags():
    raw = [
        {"timestamp": "2026-06-01 0:59:32", "device_id": "ventis-01",
         "condition": "fahey_window_1person", "co2_ppm": "812", "temp_c": "22",
         "humidity_pct": "44", "fan_duty": "0", "window_state": "open", "consent": "anon"},
    ]
    rows = build_reading_rows(raw)
    r = rows[0]
    assert r["timestamp"] == "2026-06-01 00:59:32"   # hour zero-padded (sqlite_sync bug-fix reused)
    assert r["co2_ppm"] == 812.0
    assert r["run_key"]                                # tagged by group_runs
    assert set(r) >= {"timestamp","device_id","run_id","run_key","condition",
                      "co2_ppm","temp_c","humidity_pct","fan_duty","window_state","consent"}
```
Run: `python -m pytest site/scripts/tests/test_supabase_sync.py -v` → FAIL.

**Step 2: Implement** (reuse `sqlite_sync` helpers — DRY)
```python
"""Sync the full Ventis union (live Sheet + archive CSVs) into Supabase Postgres
= the durable, off-laptop system of record. Idempotent (upsert). Reuses the same
union + normalization as sqlite_sync; only the sink changes (SQLite -> Postgres).

Env: SUPABASE_DB_URL (Postgres URI), VENTIS_SHEET_ID, VENTIS_SA_JSON (key path).
Usage:
  python supabase_sync.py            # pull Sheet + archive CSVs -> upsert Supabase
  python supabase_sync.py --no-sheet # archive CSVs only
"""
import os, sys
from sqlite_sync import _load_archive_csvs, _num, _norm_ts
from archive_runs import group_runs
from sheet_source import fetch_rows

READING_COLS = ["timestamp","device_id","run_id","run_key","condition","co2_ppm",
                "temp_c","humidity_pct","fan_duty","window_state","consent"]

def build_reading_rows(raw_rows):
    tagged = []
    for key, run_rows in group_runs(raw_rows).items():
        for r in run_rows:
            tagged.append({
                "timestamp": _norm_ts(r.get("timestamp", "")),
                "device_id": str(r.get("device_id", "")),
                "run_id": str(r.get("run_id", "")).strip(),
                "run_key": key,
                "condition": str(r.get("condition", "")),
                "co2_ppm": _num(r.get("co2_ppm")),
                "temp_c": _num(r.get("temp_c")),
                "humidity_pct": _num(r.get("humidity_pct")),
                "fan_duty": _num(r.get("fan_duty")),
                "window_state": str(r.get("window_state", "")),
                "consent": str(r.get("consent", "")),
            })
    return tagged
```
Run the test → PASS.

**Step 3: Commit**
```bash
git add site/scripts/supabase_sync.py site/scripts/tests/test_supabase_sync.py
git commit -m "feat(supabase): pure reading-row builder (reuses sqlite_sync union)"
```

---

### Task 3: Runs aggregation from readings (pure, mirrors REBUILD_RUNS)

**Files:** Modify `supabase_sync.py`; Test append.

**Step 1: Failing test** — `aggregate_runs(rows)` groups readings into run records (start/end/n_rows/co2 stats, majority condition).
```python
from supabase_sync import aggregate_runs
def test_aggregate_runs():
    rows = [
      {"run_key":"k","run_id":"","device_id":"ventis-01","condition":"fahey_window_1person",
       "timestamp":"2026-06-01 21:00:00","co2_ppm":800.0,"temp_c":22.0,"humidity_pct":40.0,
       "fan_duty":0.0,"window_state":"open","consent":"anon"},
      {"run_key":"k","run_id":"","device_id":"ventis-01","condition":"fahey_window_1person",
       "timestamp":"2026-06-01 22:00:00","co2_ppm":1000.0,"temp_c":22.0,"humidity_pct":41.0,
       "fan_duty":0.0,"window_state":"open","consent":"anon"},
    ]
    runs = aggregate_runs(rows)
    assert len(runs) == 1
    r = runs[0]
    assert r["run_key"]=="k" and r["n_rows"]==2 and r["co2_peak"]==1000.0
    assert r["start_ts"]=="2026-06-01 21:00:00" and r["end_ts"]=="2026-06-01 22:00:00"
```
**Step 2: Implement** (append)
```python
def aggregate_runs(rows):
    by = {}
    for r in rows:
        by.setdefault(r["run_key"], []).append(r)
    out = []
    for key, rs in by.items():
        ts = sorted(x["timestamp"] for x in rs)
        co2 = [x["co2_ppm"] for x in rs if x["co2_ppm"] is not None]
        # majority condition
        conds = {}
        for x in rs: conds[x["condition"]] = conds.get(x["condition"],0)+1
        cond = max(conds, key=conds.get) if conds else ""
        out.append({
            "run_key": key,
            "run_id": next((x["run_id"] for x in rs if x["run_id"]), ""),
            "device_id": next((x["device_id"] for x in rs if x["device_id"]), ""),
            "condition": cond,
            "start_ts": ts[0], "end_ts": ts[-1], "n_rows": len(rs),
            "co2_mean": round(sum(co2)/len(co2), 1) if co2 else None,
            "co2_peak": max(co2) if co2 else None,
        })
    return out
```
Run → PASS. **Commit:** `feat(supabase): runs aggregation from readings`.

---

## Phase 2 — Postgres sink + CLI

### Task 4: Upsert into Supabase (integration; gated on SUPABASE_DB_URL)

**Files:** Modify `supabase_sync.py`; add `psycopg[binary]>=3` to `site/scripts/requirements.txt`.

**Step 1:** Add the sink + `main()`:
```python
def push(reading_rows, run_rows, db_url):
    import psycopg
    from psycopg.rows import dict_row
    with psycopg.connect(db_url) as con:
        with con.cursor() as cur:
            cur.executemany(
              "insert into readings (timestamp,device_id,run_id,run_key,condition,co2_ppm,"
              "temp_c,humidity_pct,fan_duty,window_state,consent) values "
              "(%(timestamp)s,%(device_id)s,%(run_id)s,%(run_key)s,%(condition)s,%(co2_ppm)s,"
              "%(temp_c)s,%(humidity_pct)s,%(fan_duty)s,%(window_state)s,%(consent)s) "
              "on conflict (device_id, timestamp) do nothing", reading_rows)
            cur.execute("delete from runs")
            cur.executemany(
              "insert into runs (run_key,run_id,device_id,condition,start_ts,end_ts,"
              "n_rows,co2_mean,co2_peak) values (%(run_key)s,%(run_id)s,%(device_id)s,"
              "%(condition)s,%(start_ts)s,%(end_ts)s,%(n_rows)s,%(co2_mean)s,%(co2_peak)s)",
              run_rows)
        con.commit()
        with con.cursor() as cur:
            n = cur.execute("select count(*) from readings").fetchone()[0]
    return n

def sync(use_sheet=True):
    raw = []
    if use_sheet:
        try: raw.extend(fetch_rows())
        except RuntimeError as e: print(f"(sheet unreachable: {e})")
    raw.extend(_load_archive_csvs())
    rows = build_reading_rows(raw)
    runs = aggregate_runs(rows)
    db = os.environ.get("SUPABASE_DB_URL")
    if not db:
        print(f"(dry run — {len(rows)} readings, {len(runs)} runs; set SUPABASE_DB_URL to push)")
        return 0, len(rows), len(runs)
    total = push(rows, runs, db)
    return total, len(rows), len(runs)

def main(argv):
    total, nr, nrun = sync(use_sheet="--no-sheet" not in argv)
    print(f"supabase sync: pushed {nr} readings ({nrun} runs); table now {total}")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```
**Step 2 (Diego prereqs P1–P4 done):** seed run locally:
`SUPABASE_DB_URL=... VENTIS_SHEET_ID=... python site/scripts/supabase_sync.py`
Expected: `pushed N readings (M runs); table now N`. Re-run → `table now N` unchanged (idempotent upsert proven).
**Step 3:** Verify in Supabase SQL editor: `select condition, count(*) from readings group by 1;` matches the catalog's run row-counts. **Commit** (code only; no secrets): `feat(supabase): idempotent upsert sink + CLI`.

---

### Task 5: Wire into CI (hourly durable sync)

**Files:** Modify `.github/workflows/data-library.yml` — add a step after `build_catalog`:
```yaml
      - name: Sync system-of-record to Supabase (durable, off-laptop)
        if: ${{ env.SUPABASE_DB_URL != '' }}
        env:
          SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}
          VENTIS_SHEET_ID: ${{ secrets.VENTIS_SHEET_ID }}
        run: python site/scripts/supabase_sync.py
```
The `if:` guard means CI stays green even before the secret exists. **Commit:** `ci(supabase): hourly system-of-record sync`.

---

## Phase 3 — Verify & finish

### Task 6: End-to-end verification
- [ ] `python -m pytest site/scripts/tests/ -v` — all green (incl. new supabase tests).
- [ ] Local seed sync pushes; re-run is idempotent (count stable).
- [ ] Supabase row counts per condition == catalog run counts.
- [ ] Cofounder can log into Supabase and run `select * from runs` (cofounder access = the unblock).
- [ ] `git status` clean of any secret / DB URL.

### Task 7: Finish
- superpowers:finishing-a-development-branch → PR → main.
- Update vault `Data Storage — ... Scaling Spec` (Tier 2 = LIVE) + memory.

---

## Later (NOT this cut — explicit next step)
- Point `build_catalog.py` at Supabase (read `runs`/`readings` from Postgres) and retire the CI SQLite rebuild → Supabase becomes the single SoR feeding the catalog. Then enable Sheet auto-prune (now safe: Supabase holds full history).
- Per-user auth (Supabase Auth) if/when the College wants logins — the Approach-B graduation.

## Notes
- DRY: reuses `group_runs`, `_num`, `_norm_ts`, `_load_archive_csvs` — only the sink changes.
- The Sheet stays the device ingest buffer (no firmware change). Supabase is the durable union + query layer + cofounder access.
- Idempotent by `unique(device_id, timestamp)` → safe to run hourly + locally without dupes.
