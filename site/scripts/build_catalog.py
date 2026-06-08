"""Build the Data Library catalog from ventis.db: catalog.json + per-run series + CSV."""
import csv, json, os, re, shutil, sqlite3, sys

from _env import load_env
load_env()   # pick up SUPABASE_DB_URL from a gitignored .env if present (CI's env wins)

HERE = os.path.dirname(os.path.abspath(__file__))
ARCHIVE_DIR = os.path.join(HERE, "archive")
DB = os.path.join(ARCHIVE_DIR, "ventis.db")
GRAPHS_DIR = os.path.join(ARCHIVE_DIR, "graphs")


KNOWN_BUILDINGS = {
    # Ventis dataset buildings
    "fahey", "judge", "eastwheelock", "summit", "little", "midmass",
    # Dartmouth halls (seed; extend as runs are deployed)
    "cohen", "bissell", "brown", "french", "mclane", "hitchcock", "zimmerman",
    "wheeler", "richardson", "morton", "mcculloch", "russellsage", "butterfield",
    "streeter", "lord", "topliff", "ripley", "smith", "woodward", "gile",
    "northmass", "southfay", "midfay", "northfay", "hinman", "andres", "maxwell",
}

WORD_NUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6}


def _occupancy(toks):
    # digit forms: "2person", "2ppl"
    for t in toks:
        m = re.match(r"(\d+)(person|ppl)$", t)
        if m:
            return int(m.group(1))
    # word forms: "two" immediately before "ppl"/"person"
    for i, t in enumerate(toks):
        if t in ("ppl", "person") and i > 0 and toks[i - 1] in WORD_NUM:
            return WORD_NUM[toks[i - 1]]
    return None


def parse_label(condition: str):
    """building_condition_occupancy -> {building, occupancy}. Tolerant of legacy.
    Building = first KNOWN_BUILDINGS token found anywhere, else first token."""
    s = str(condition or "").strip().lower()
    toks = [t for t in re.split(r"[^a-z0-9]+", s) if t]
    building = next((t for t in toks if t in KNOWN_BUILDINGS), toks[0] if toks else "")
    return {"building": building, "occupancy": _occupancy(toks)}


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
        "csv": f"{rid}.csv",
        "series": f"{rid}.json",
        "notes": "",
    }


SERIES_MAX = 1500   # downsample cap per run for the (future) compare view


def _now():
    from datetime import timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


READING_SELECT = ("timestamp,co2_ppm,temp_c,humidity_pct,fan_duty,window_state,condition")


def _fetch_sqlite(db_path):
    """Local Tier-1 store. Returns (runs[list of dict], readings{run_key: [dict]})."""
    con = sqlite3.connect(db_path); con.row_factory = sqlite3.Row
    runs = [dict(r) for r in con.execute("SELECT * FROM runs ORDER BY start")]
    readings = {}
    for r in runs:
        rows = con.execute(
            f"SELECT {READING_SELECT} FROM readings WHERE run_key=? ORDER BY timestamp",
            (r["run_key"],)).fetchall()
        readings[r["run_key"]] = [dict(x) for x in rows]
    con.close()
    return runs, readings


def _fetch_postgres(db_url):
    """Supabase system-of-record. Same return shape as _fetch_sqlite — timestamps
    cast to the canonical 'YYYY-MM-DD HH:MM:SS' string and start_ts/end_ts aliased
    to start/end, so all downstream logic is identical to the SQLite path."""
    import psycopg
    from psycopg.rows import dict_row
    with psycopg.connect(db_url) as con, con.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT run_key, run_id, device_id, condition, "
            "to_char(start_ts,'YYYY-MM-DD HH24:MI:SS') AS start, "
            "to_char(end_ts,'YYYY-MM-DD HH24:MI:SS') AS \"end\", "
            "n_rows, co2_mean, co2_peak FROM runs ORDER BY start_ts")
        runs = cur.fetchall()
        readings = {}
        for r in runs:
            cur.execute(
                "SELECT to_char(timestamp,'YYYY-MM-DD HH24:MI:SS') AS timestamp, "
                "co2_ppm,temp_c,humidity_pct,fan_duty,window_state,condition "
                "FROM readings WHERE run_key=%s ORDER BY timestamp", (r["run_key"],))
            readings[r["run_key"]] = cur.fetchall()
    return runs, readings


def build(db_path=DB, out_dir=None, graphs_dir=GRAPHS_DIR, db_url=None):
    out_dir = out_dir or os.path.join(HERE, "..", "..", "library", "public", "data")
    os.makedirs(os.path.join(out_dir, "series"), exist_ok=True)
    # Source of truth: Supabase when SUPABASE_DB_URL is set (CI), else local SQLite
    # (dev / explicit db_path in tests). Pass db_url="" to force SQLite.
    src = db_url if db_url is not None else os.environ.get("SUPABASE_DB_URL")
    if src:
        runs, readings = _fetch_postgres(src)
        print(f"(catalog source: Supabase — {len(runs)} runs)")
    else:
        runs, readings = _fetch_sqlite(db_path)
        print(f"(catalog source: SQLite {db_path} — {len(runs)} runs)")
    records = [run_record(r) for r in runs]
    # annotate with verifiable consent status from the ledger (falls back to unverified)
    try:
        from consent_ledger import load_ledger, merge_consent
        merge_consent(records, load_ledger())
    except Exception as e:
        print(f"(consent ledger skipped: {e})")
    # annotate with founder notes + quality flags (non-fatal if the table is absent)
    try:
        from annotate import load_annotations, merge_annotations
        merge_annotations(records, load_annotations())
    except Exception as e:
        print(f"(annotations skipped: {e})")
    json.dump({"generated": _now(), "runs": records},
              open(os.path.join(out_dir, "catalog.json"), "w"), indent=2, default=str)
    csv_dir = os.path.join(out_dir, "csv")
    os.makedirs(csv_dir, exist_ok=True)
    CSV_COLS = ["timestamp", "co2_ppm", "temp_c", "humidity_pct",
                "fan_duty", "window_state", "condition"]
    for r in runs:
        rid = (r.get("run_id") or "").strip() or r["run_key"]
        full = readings.get(r["run_key"], [])
        # full raw CSV (downloadable from the run detail page)
        with open(os.path.join(csv_dir, f"{rid}.csv"), "w", newline="", encoding="utf-8") as cf:
            w = csv.writer(cf)
            w.writerow(CSV_COLS)
            for x in full:
                w.writerow([x[c] for c in CSV_COLS])
        # downsampled series JSON (for charts / compare view)
        step = max(1, len(full) // SERIES_MAX)
        rows = full[::step]
        json.dump({
            "ts":   [x["timestamp"] for x in rows],
            "co2_ppm":      [x["co2_ppm"] for x in rows],
            "temp_c":       [x["temp_c"] for x in rows],
            "humidity_pct": [x["humidity_pct"] for x in rows],
        }, open(os.path.join(out_dir, "series", f"{rid}.json"), "w"), default=str)
    # copy charts (best-effort)
    cdst = os.path.join(out_dir, "charts"); os.makedirs(cdst, exist_ok=True)
    if os.path.isdir(graphs_dir):
        for f in os.listdir(graphs_dir):
            if f.endswith(".png"):
                # lowercase dest so the catalog's _slug(condition) reference
                # resolves on case-sensitive hosts (Linux CI / Cloudflare)
                shutil.copy2(os.path.join(graphs_dir, f),
                             os.path.join(cdst, f.lower()))
    return len(records)


def main(argv):
    n = build()
    print(f"catalog built: {n} runs")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
