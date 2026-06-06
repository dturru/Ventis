"""Archive completed Ventis runs out of the live Sheet into per-run files.

The `telemetry` tab is an INGEST BUFFER, not the permanent home (Sheets caps at
~1.1M rows and reads pull the whole tab). This pulls READ-ONLY, groups rows into
runs, and writes each COMPLETE run to its own CSV under archive/, plus a manifest
(runs_index.json) = the queryable index of the whole dataset. The archive dir is
gitignored — the dataset is the moat, never committed.

Run grouping:
  - by `run_id` when present (firmware >= run_id build)
  - legacy fallback: condition + date  (rows that predate run_id; approximate —
    an overnight run crossing midnight splits by date. run_id fixes this going
    forward.)

Completeness (TZ-free + safe): the run owning the newest row is treated as
possibly-still-logging and SKIPPED, unless --all is passed (use when logging is
confirmed off). So an actively-growing run is never archived mid-flight.

Idempotent: a run already in the manifest with the same row count is skipped.

This is the READ/archive half only. Pruning archived rows from the live tab is a
WRITE and must use a SEPARATE write-scoped path — never widen this read-only key
(see vault: Security Review 2026-06-05).

Usage:
  python archive_runs.py            # archive completed runs (skips the active/newest run)
  python archive_runs.py --all      # archive everything (logging confirmed stopped)
  python archive_runs.py --dry-run  # show what would be archived, write nothing
"""
import csv
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime

from sheet_source import fetch_rows, COLUMNS

GAP_MINUTES = 60   # legacy grouping: a gap longer than this starts a new run

HERE = os.path.dirname(os.path.abspath(__file__))
ARCHIVE_DIR = os.path.join(HERE, "archive")
MANIFEST = os.path.join(ARCHIVE_DIR, "runs_index.json")
OUT_COLUMNS = COLUMNS + ["run_id"]


def _ts(r):
    return str(r.get("timestamp", ""))


def _safe(name):
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", name)[:80]


def _parse(ts):
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(ts, fmt)
        except (ValueError, TypeError):
            pass
    return None


def group_runs(rows):
    """Group rows into runs. Rows with a run_id group directly. Legacy rows (no
    run_id) are split into contiguous sessions: a new run starts on a condition
    change or a time gap > GAP_MINUTES, so an overnight run stays whole while two
    separate same-label sessions don't merge."""
    runs = defaultdict(list)
    legacy = []
    for r in rows:
        rid = str(r.get("run_id", "")).strip()
        if rid:
            runs[rid].append(r)
        else:
            legacy.append(r)

    legacy.sort(key=_ts)
    cur_key, last_dt, last_cond = None, None, None
    for r in legacy:
        cond = str(r.get("condition", "")).strip() or "unlabeled"
        dt = _parse(_ts(r))
        gap = dt and last_dt and (dt - last_dt).total_seconds() > GAP_MINUTES * 60
        if cur_key is None or cond != last_cond or gap:
            start = _ts(r)[:19].replace(" ", "T").replace(":", "").replace("-", "")
            cur_key = f"legacy_{_safe(cond)}_{start}"
        runs[cur_key].append(r)
        last_dt, last_cond = (dt or last_dt), cond

    for k in runs:
        runs[k].sort(key=_ts)
    return runs


def _meta(key, run_rows):
    co2 = [float(r["co2_ppm"]) for r in run_rows
           if str(r.get("co2_ppm", "")).strip() not in ("", "None")]
    conds = [str(r.get("condition", "")) for r in run_rows if r.get("condition")]
    return {
        "run_key": key,
        "run_id": str(run_rows[0].get("run_id", "")).strip(),
        "device_id": str(run_rows[0].get("device_id", "")),
        "condition": max(set(conds), key=conds.count) if conds else "",
        "start": _ts(run_rows[0]),
        "end": _ts(run_rows[-1]),
        "n_rows": len(run_rows),
        "co2_mean": round(sum(co2) / len(co2), 1) if co2 else None,
        "co2_peak": max(co2) if co2 else None,
        "csv": _safe(key) + ".csv",
    }


def main(argv):
    dry = "--dry-run" in argv
    do_all = "--all" in argv

    rows = fetch_rows()
    runs = group_runs(rows)
    if not runs:
        print("no rows to archive")
        return 0

    # the run owning the globally newest row is possibly still logging
    newest_key = max(runs, key=lambda k: _ts(runs[k][-1]))

    manifest = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as f:
            manifest = json.load(f)

    archived, skipped = [], []
    for key, run_rows in sorted(runs.items()):
        if key == newest_key and not do_all:
            skipped.append((key, "active/newest — use --all to include"))
            continue
        meta = _meta(key, run_rows)
        prev = manifest.get(key)
        if prev and prev.get("n_rows") == meta["n_rows"]:
            skipped.append((key, f"already archived ({meta['n_rows']} rows)"))
            continue
        archived.append(meta)
        if not dry:
            os.makedirs(ARCHIVE_DIR, exist_ok=True)
            with open(os.path.join(ARCHIVE_DIR, meta["csv"]), "w",
                      newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=OUT_COLUMNS, extrasaction="ignore")
                w.writeheader()
                w.writerows(run_rows)
            manifest[key] = meta

    if not dry and archived:
        os.makedirs(ARCHIVE_DIR, exist_ok=True)
        with open(MANIFEST, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2, default=str)

    label = "WOULD archive" if dry else "archived"
    print(f"pulled {len(rows)} rows / {len(runs)} runs")
    print(f"\n{label} ({len(archived)}):")
    for m in archived:
        print(f"  {m['run_key']:<34s} {m['n_rows']:>5d} rows  "
              f"{m['condition']!r:<22s} co2_peak={m['co2_peak']}")
    print(f"\nskipped ({len(skipped)}):")
    for k, why in skipped:
        print(f"  {k:<34s} {why}")
    if dry:
        print("\n(dry run — nothing written)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
