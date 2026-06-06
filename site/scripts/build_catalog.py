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
