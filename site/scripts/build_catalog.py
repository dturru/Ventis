"""Build the Data Library catalog from ventis.db: catalog.json + per-run series."""
import json, os, re, shutil, sqlite3, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ARCHIVE_DIR = os.path.join(HERE, "archive")
DB = os.path.join(ARCHIVE_DIR, "ventis.db")
GRAPHS_DIR = os.path.join(ARCHIVE_DIR, "graphs")


def parse_label(condition: str):
    """building_condition_occupancy -> {building, occupancy}. Tolerant of legacy."""
    s = str(condition or "").strip().lower()
    toks = re.split(r"[^a-z0-9]+", s)
    toks = [t for t in toks if t]
    building = toks[0] if toks else ""
    occ = None
    for t in toks:
        m = re.match(r"(\d+)person", t)
        if m:
            occ = int(m.group(1)); break
    return {"building": building, "occupancy": occ}


from datetime import datetime

ASHRAE = 1000


def _parse_dt(s):
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(str(s), fmt)
        except (ValueError, TypeError):
            pass
    return None


def _slug(s):
    return re.sub(r"[^a-z0-9]+", "_", str(s).lower()).strip("_") or "run"


def run_record(run: dict) -> dict:
    lab = parse_label(run.get("condition", ""))
    a, b = _parse_dt(run.get("start")), _parse_dt(run.get("end"))
    dur = round((b - a).total_seconds() / 3600, 2) if a and b else None
    peak = run.get("co2_peak")
    rid = (run.get("run_id") or "").strip() or run.get("run_key")
    return {
        "run_id": rid,
        "run_key": run.get("run_key"),
        "device_id": run.get("device_id", ""),
        "building": lab["building"],
        "condition": run.get("condition", ""),
        "occupancy": lab["occupancy"],
        "window_state": run.get("window_state", ""),
        "date": str(run.get("start", ""))[:10],
        "start": run.get("start", ""),
        "end": run.get("end", ""),
        "duration_h": dur,
        "n_rows": run.get("n_rows"),
        "co2_mean": run.get("co2_mean"),
        "co2_peak": peak,
        "ashrae_exceed": bool(peak is not None and peak > ASHRAE),
        "consent": run.get("consent", ""),
        "chart": f"{_slug(run.get('condition',''))}.png",
        "csv": f"{run.get('run_key')}.csv",
        "series": f"{rid}.json",
        "notes": "",
    }


SERIES_MAX = 1500   # downsample cap per run for the (future) compare view


def _now():
    from datetime import timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def build(db_path=DB, out_dir=None, graphs_dir=GRAPHS_DIR):
    out_dir = out_dir or os.path.join(HERE, "..", "..", "library", "public", "data")
    os.makedirs(os.path.join(out_dir, "series"), exist_ok=True)
    con = sqlite3.connect(db_path); con.row_factory = sqlite3.Row
    runs = [dict(r) for r in con.execute("SELECT * FROM runs ORDER BY start")]
    records = [run_record(r) for r in runs]
    json.dump({"generated": _now(), "runs": records},
              open(os.path.join(out_dir, "catalog.json"), "w"), indent=2, default=str)
    for r in runs:
        rid = (r.get("run_id") or "").strip() or r["run_key"]
        rows = con.execute(
            "SELECT timestamp,co2_ppm,temp_c,humidity_pct FROM readings "
            "WHERE run_key=? ORDER BY timestamp", (r["run_key"],)).fetchall()
        step = max(1, len(rows) // SERIES_MAX)
        rows = rows[::step]
        json.dump({
            "ts":   [x["timestamp"] for x in rows],
            "co2_ppm":      [x["co2_ppm"] for x in rows],
            "temp_c":       [x["temp_c"] for x in rows],
            "humidity_pct": [x["humidity_pct"] for x in rows],
        }, open(os.path.join(out_dir, "series", f"{rid}.json"), "w"), default=str)
    con.close()
    # copy charts (best-effort)
    cdst = os.path.join(out_dir, "charts"); os.makedirs(cdst, exist_ok=True)
    if os.path.isdir(graphs_dir):
        for f in os.listdir(graphs_dir):
            if f.endswith(".png"):
                shutil.copy2(os.path.join(graphs_dir, f), cdst)
    return len(records)


def main(argv):
    n = build()
    print(f"catalog built: {n} runs")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
