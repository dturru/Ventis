"""Sync the full Ventis union (live Sheet + archive CSVs) into Supabase Postgres
= the durable, off-laptop system of record. Idempotent (upsert). Reuses the same
union + normalization as sqlite_sync; only the sink changes (SQLite -> Postgres).

Env:
  SUPABASE_DB_URL  Postgres connection URI (Supabase -> Settings -> Database)
  VENTIS_SHEET_ID  the telemetry Google Sheet id
  VENTIS_SA_JSON   path to the read-only service-account key (default: ./service_account.json)

Usage:
  python supabase_sync.py            # pull Sheet + archive CSVs -> upsert Supabase
  python supabase_sync.py --no-sheet # archive CSVs only (offline)
"""
import os
import sys

from sqlite_sync import _load_archive_csvs, _num, _norm_ts
from archive_runs import group_runs, _parse
from sheet_source import fetch_rows

READING_COLS = ["timestamp", "device_id", "run_id", "run_key", "condition", "co2_ppm",
                "temp_c", "humidity_pct", "fan_duty", "window_state", "consent"]


def build_reading_rows(raw_rows):
    """Union raw rows -> normalized, run_key-tagged reading dicts (same logic as sqlite_sync)."""
    tagged = []
    for key, run_rows in group_runs(raw_rows).items():
        for r in run_rows:
            # Postgres timestamptz rejects ""/garbage (SQLite tolerated it). Skip rows
            # with no parseable timestamp — they're blank/unlabeled junk, not real samples.
            if _parse(str(r.get("timestamp", ""))) is None:
                continue
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


def aggregate_runs(rows):
    """Reading dicts -> one run record each (start/end/n_rows/co2 stats, majority condition)."""
    by = {}
    for r in rows:
        by.setdefault(r["run_key"], []).append(r)
    out = []
    for key, rs in by.items():
        ts = sorted(x["timestamp"] for x in rs)
        co2 = [x["co2_ppm"] for x in rs if x["co2_ppm"] is not None]
        conds = {}
        for x in rs:
            conds[x["condition"]] = conds.get(x["condition"], 0) + 1
        cond = max(conds, key=conds.get) if conds else ""
        out.append({
            "run_key": key,
            "run_id": next((x["run_id"] for x in rs if x["run_id"]), ""),
            "device_id": next((x["device_id"] for x in rs if x["device_id"]), ""),
            "condition": cond,
            "start_ts": ts[0], "end_ts": ts[-1], "n_rows": len(rs),
            "co2_mean": round(sum(co2) / len(co2), 1) if co2 else None,
            "co2_peak": max(co2) if co2 else None,
        })
    return out


def push(reading_rows, run_rows, db_url):
    """Upsert readings (on conflict do nothing) + rebuild runs. Returns readings count."""
    import psycopg
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
            total = cur.execute("select count(*) from readings").fetchone()[0]
    return total


def sync(use_sheet=True):
    raw = []
    if use_sheet:
        try:
            raw.extend(fetch_rows())
        except RuntimeError as e:
            print(f"(sheet unreachable: {e} — using archive CSVs only)")
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
    print(f"supabase sync: built {nr} readings ({nrun} runs); table now {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
