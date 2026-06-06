"""Refresh the Ventis dataset + back it up, in one shot. (The `/ventis-backup` skill.)

Pipeline:
  1. Pull the live `telemetry` tab (read-only) -> archive/telemetry_live.csv
  2. SQLite sync  -> archive/ventis.db        (durable system of record / moat)
  3. Archive completed runs -> archive/<run>.csv + runs_index.json
  4. Charts per the Data Plotting SOP -> archive/graphs/<condition>.png
  5. Zip the whole archive/ (data + manifest + db + graphs) to a dated file in
     OneDrive (auto off-machine cloud backup).

Everything lives under the gitignored archive/ dir — the dataset is the moat,
never committed. Step 4 is best-effort (skipped with a warning if matplotlib/
pandas aren't installed) so a missing plot dep never blocks the backup.

Usage:
  python refresh_backup.py            # full refresh + backup
  python refresh_backup.py --no-graphs
  python refresh_backup.py --no-backup   # steps 1-4 only (CI: refresh + chart, no OneDrive zip)
"""
import csv as _csv
import os
import shutil
import subprocess
import sys
from datetime import datetime

import sheet_source
import sqlite_sync
import archive_runs

HERE = os.path.dirname(os.path.abspath(__file__))
ARCHIVE_DIR = os.path.join(HERE, "archive")
GRAPHS_DIR = os.path.join(ARCHIVE_DIR, "graphs")
LIVE_CSV = os.path.join(ARCHIVE_DIR, "telemetry_live.csv")
REPO = os.path.dirname(os.path.dirname(HERE))         # site/scripts -> site -> repo root
PLOTTER = os.path.join(REPO, "plot_ventis_run.py")


def _step(n, msg):
    print(f"\n=== {n}/5 {msg} ===")


def main(argv):
    do_graphs = "--no-graphs" not in argv
    do_backup = "--no-backup" not in argv
    os.makedirs(ARCHIVE_DIR, exist_ok=True)

    _step(1, "pull telemetry")
    rows = sheet_source.fetch_rows()
    with open(LIVE_CSV, "w", newline="", encoding="utf-8") as f:
        w = _csv.DictWriter(f, fieldnames=sheet_source.COLUMNS + ["run_id"],
                            extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    print(f"  {len(rows)} rows -> {LIVE_CSV}")

    _step(2, "SQLite sync")
    before, after, nruns = sqlite_sync.sync()
    print(f"  readings {before} -> {after} (+{after - before}), runs {nruns}")

    _step(3, "archive completed runs")
    archive_runs.main([])   # default: skips the active/newest run

    _step(4, "charts (Data Plotting SOP)")
    if do_graphs and os.path.exists(PLOTTER):
        os.makedirs(GRAPHS_DIR, exist_ok=True)
        try:
            subprocess.run([sys.executable, PLOTTER, "--csv", LIVE_CSV,
                            "--all", "--out", GRAPHS_DIR], check=True)
            pngs = [f for f in os.listdir(GRAPHS_DIR) if f.endswith(".png")]
            print(f"  {len(pngs)} chart(s) -> {GRAPHS_DIR}")
        except Exception as e:
            print(f"  (charts skipped: {e})")
    else:
        print("  (charts skipped)")

    if not do_backup:
        print("\nDONE — dataset refreshed + charted (backup skipped, --no-backup).")
        return 0

    _step(5, "backup to OneDrive")
    onedrive = os.environ.get("OneDrive") or os.path.expanduser(r"~\OneDrive")
    dest = os.path.join(onedrive, "Ventis-Backups")
    os.makedirs(dest, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    base = os.path.join(dest, f"ventis-archive_{stamp}")
    zip_path = shutil.make_archive(base, "zip", ARCHIVE_DIR)
    size_kb = round(os.path.getsize(zip_path) / 1024, 1)
    print(f"  backup -> {zip_path} ({size_kb} KB)")

    print("\nDONE — dataset refreshed, charted, and backed up off-machine.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
