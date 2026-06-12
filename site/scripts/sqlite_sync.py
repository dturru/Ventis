"""Sync the Ventis dataset into a durable SQLite file (Tier 1 store).

The Sheet is the ingest BUFFER and the per-run CSVs are the archive; this unions
BOTH into one queryable SQLite file (archive/ventis.db) = the system of record /
moat. Idempotent + incremental (re-running only adds new rows) and survives Sheet
pruning, because it also ingests the archived CSVs for runs no longer in the Sheet.

Tables:
  readings  one row per sample. UNIQUE(device_id, timestamp) -> dedup on re-sync.
  runs      one row per run, rebuilt each sync (condition, start/end, n_rows, co2 stats).

Timestamps are NORMALIZED to "YYYY-MM-DD HH:MM:SS" on insert — Sheets returns
unpadded hours ("0:59:32") which would otherwise break ordering/queries.

sqlite3 is stdlib — no new deps. DB lives in the gitignored archive/ dir (moat).

Usage:
  python sqlite_sync.py                       # pull Sheet + ingest archive/*.csv -> ventis.db
  python sqlite_sync.py --no-sheet            # archive CSVs only (offline / Sheet unreachable)
  python sqlite_sync.py --sql "SELECT ..."    # run an ad hoc query against the db
"""
import csv
import glob
import os
import sqlite3
import sys

from archive_runs import ARCHIVE_DIR, group_runs, _parse, _ts
from sheet_source import fetch_rows, COLUMNS

DB = os.path.join(ARCHIVE_DIR, "ventis.db")

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS readings (
  timestamp     TEXT,
  device_id     TEXT,
  run_id        TEXT,
  run_key       TEXT,
  condition     TEXT,
  co2_ppm       REAL,
  temp_c        REAL,
  humidity_pct  REAL,
  fan_duty      REAL,
  window_state  TEXT,
  consent       TEXT,
  UNIQUE(device_id, timestamp)
);
CREATE INDEX IF NOT EXISTS idx_readings_run ON readings(run_key);
CREATE INDEX IF NOT EXISTS idx_readings_ts  ON readings(timestamp);
CREATE TABLE IF NOT EXISTS runs (
  run_key    TEXT PRIMARY KEY,
  run_id     TEXT,
  device_id  TEXT,
  condition  TEXT,
  start      TEXT,
  "end"      TEXT,
  n_rows     INTEGER,
  co2_mean   REAL,
  co2_peak   REAL
);
"""

# NOTE: SQLite is the local dev cache; the live catalog reads Supabase, where
# co2_mean/co2_peak are the robust (warm-up-trimmed mean + 5-min rolling-mean peak)
# values from supabase_sync.aggregate_runs / archive_runs.co2_stats. Here they stay
# raw AVG/MAX for a cheap local view — don't treat these as the published figures.
REBUILD_RUNS = """
DELETE FROM runs;
INSERT INTO runs (run_key, run_id, device_id, condition, start, "end", n_rows, co2_mean, co2_peak)
SELECT run_key,
       MAX(run_id),
       MAX(device_id),
       (SELECT condition FROM readings r2 WHERE r2.run_key = r.run_key
        GROUP BY condition ORDER BY COUNT(*) DESC LIMIT 1),
       MIN(timestamp), MAX(timestamp), COUNT(*),
       ROUND(AVG(co2_ppm), 1), MAX(co2_ppm)
FROM readings r GROUP BY run_key;
"""


def _num(v):
    s = str(v).strip()
    if s in ("", "None"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _norm_ts(v):
    dt = _parse(str(v))
    return dt.strftime("%Y-%m-%d %H:%M:%S") if dt else str(v)


def _load_archive_csvs():
    rows = []
    for path in sorted(glob.glob(os.path.join(ARCHIVE_DIR, "*.csv"))):
        with open(path, newline="", encoding="utf-8") as f:
            rows.extend(csv.DictReader(f))
    return rows


def sync(use_sheet=True):
    rows = []
    if use_sheet:
        try:
            rows.extend(fetch_rows())
        except RuntimeError as e:
            print(f"(sheet unreachable: {e} — using archive CSVs only)")
    rows.extend(_load_archive_csvs())

    # tag each row with its run_key (same grouping logic as archive_runs)
    tagged = []
    for key, run_rows in group_runs(rows).items():
        for r in run_rows:
            d = dict(r)
            d["run_key"] = key
            tagged.append(d)

    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    con = sqlite3.connect(DB)
    con.executescript(SCHEMA_SQL)
    before = con.execute("SELECT COUNT(*) FROM readings").fetchone()[0]
    con.executemany(
        "INSERT OR IGNORE INTO readings "
        "(timestamp,device_id,run_id,run_key,condition,co2_ppm,temp_c,"
        " humidity_pct,fan_duty,window_state,consent) VALUES "
        "(:timestamp,:device_id,:run_id,:run_key,:condition,:co2_ppm,:temp_c,"
        " :humidity_pct,:fan_duty,:window_state,:consent)",
        [{
            "timestamp": _norm_ts(r.get("timestamp", "")),
            "device_id": str(r.get("device_id", "")),
            "run_id": str(r.get("run_id", "")).strip(),
            "run_key": r["run_key"],
            "condition": str(r.get("condition", "")),
            "co2_ppm": _num(r.get("co2_ppm")),
            "temp_c": _num(r.get("temp_c")),
            "humidity_pct": _num(r.get("humidity_pct")),
            "fan_duty": _num(r.get("fan_duty")),
            "window_state": str(r.get("window_state", "")),
            "consent": str(r.get("consent", "")),
        } for r in tagged],
    )
    con.executescript(REBUILD_RUNS)
    con.commit()
    after = con.execute("SELECT COUNT(*) FROM readings").fetchone()[0]
    nruns = con.execute("SELECT COUNT(*) FROM runs").fetchone()[0]
    con.close()
    return before, after, nruns


def run_query(sql):
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    try:
        cur = con.execute(sql)
        rows = cur.fetchall()
        if rows:
            cols = rows[0].keys()
            print(" | ".join(cols))
            print("-" * 60)
            for row in rows:
                print(" | ".join(str(row[c]) for c in cols))
        print(f"\n({len(rows)} rows)")
    finally:
        con.close()


def main(argv):
    if "--sql" in argv:
        i = argv.index("--sql")
        if i + 1 >= len(argv):
            print("usage: --sql \"SELECT ...\"")
            return 1
        if not os.path.exists(DB):
            print(f"no db yet at {DB} — run a sync first")
            return 1
        run_query(argv[i + 1])
        return 0

    before, after, nruns = sync(use_sheet="--no-sheet" not in argv)
    print(f"synced -> {DB}")
    print(f"readings: {before} -> {after}  (+{after - before} new)")
    print(f"runs:     {nruns}")
    run_query("SELECT run_key, condition, start, \"end\", n_rows, co2_mean, co2_peak "
              "FROM runs ORDER BY start")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
