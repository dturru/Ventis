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
from collections import defaultdict, deque
from datetime import datetime, timedelta

from sheet_source import fetch_rows, COLUMNS
from merge_runs import apply_merges, load_merges

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
    # Google Sheets reformats the ISO timestamp (space separator, UNPADDED hour,
    # e.g. "2026-06-02 0:59:32"). strptime is lenient about padding, so this parses
    # both that and the firmware's "YYYY-MM-DDTHH:MM:SS".
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(ts, fmt)
        except (ValueError, TypeError):
            pass
    return None


def _dt(r):
    # Sort key by ACTUAL time — never lexical, since Sheets' unpadded hours break it.
    return _parse(_ts(r)) or datetime.min


def group_runs(rows, merges=None):
    """Group rows into runs. Rows with a run_id group directly. Legacy rows (no
    run_id) are split into contiguous sessions: a new run starts on a condition
    change or a time gap > GAP_MINUTES, so an overnight run stays whole while two
    separate same-label sessions don't merge.

    A founder merge overlay (merge_runs.py) is then applied to fold runs the
    grouper wrongly split (e.g. a reboot read as a >GAP_MINUTES gap) back into one.
    Pass merges={} to disable, or a {member_key: canonical_id} map to override."""
    runs = defaultdict(list)
    legacy = []
    for r in rows:
        rid = str(r.get("run_id", "")).strip()
        if rid:
            runs[rid].append(r)
        else:
            legacy.append(r)

    legacy.sort(key=_dt)
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

    try:
        runs = apply_merges(runs, load_merges() if merges is None else merges)
    except Exception as e:
        print(f"(run merges skipped: {e})")

    for k in runs:
        runs[k].sort(key=_dt)
    return runs


def _co2_val(v):
    s = str(v).strip()
    if s in ("", "None"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def co2_stats(rows, warmup_min=15, peak_window_min=5):
    """Robust per-run CO2 stats that reject deployment / boundary artifacts.

    - co2_mean: arithmetic mean AFTER dropping the first `warmup_min` minutes — the
      SCD40 warm-up + handling at deployment bias the opening readings high.
    - co2_peak: the max of a `peak_window_min`-minute ROLLING MEAN, so a brief spike
      (startup, reboot-resume, the pull) can't masquerade as the peak while a genuine
      sustained high survives. Computed on the warm-up-trimmed series too.

    Falls back to the full series when trimming would leave too little data (short
    runs). Returns {co2_mean, co2_peak}; both None if there is no usable CO2."""
    pts = []
    for r in rows:
        dt = _parse(_ts(r))
        c = _co2_val(r.get("co2_ppm"))
        if dt is not None and c is not None:
            pts.append((dt, c))
    if not pts:
        return {"co2_mean": None, "co2_peak": None}
    pts.sort(key=lambda p: p[0])
    kept = [p for p in pts if p[0] >= pts[0][0] + timedelta(minutes=warmup_min)]
    if len(kept) < max(2, len(pts) // 10):     # short run -> don't over-trim
        kept = pts
    vals = [c for _, c in kept]
    co2_mean = round(sum(vals) / len(vals), 1)
    win = timedelta(minutes=peak_window_min)
    dq = deque(); run = 0.0; k = 0; best = None; n = len(kept)
    for i in range(n):
        while k < n and kept[k][0] <= kept[i][0] + win:
            dq.append(kept[k][1]); run += kept[k][1]; k += 1
        if dq:
            m = run / len(dq)
            best = m if best is None or m > best else best
        run -= dq.popleft()
    return {"co2_mean": co2_mean, "co2_peak": round(best) if best is not None else None}


def _meta(key, run_rows):
    conds = [str(r.get("condition", "")) for r in run_rows if r.get("condition")]
    st = co2_stats(run_rows)
    return {
        "run_key": key,
        "run_id": str(run_rows[0].get("run_id", "")).strip(),
        "device_id": str(run_rows[0].get("device_id", "")),
        "condition": max(set(conds), key=conds.count) if conds else "",
        "start": _ts(run_rows[0]),
        "end": _ts(run_rows[-1]),
        "n_rows": len(run_rows),
        "co2_mean": st["co2_mean"],
        "co2_peak": st["co2_peak"],
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
    newest_key = max(runs, key=lambda k: _dt(runs[k][-1]))

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
