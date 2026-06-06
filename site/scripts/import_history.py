"""One-time importer: legacy run CSVs -> telemetry-schema CSV for pasting into the Sheet.

Maps legacy columns -> telemetry schema, relabels condition to the canonical
building_condition_occupancy convention, and anonymizes (device_id=ventis-01,
consent=anon). Emits archive/history_import.csv. Read-only on the Sheet (we never
write to it from here) — Diego pastes the output. See design doc.

Usage:
  python import_history.py --csv "<file1>" "<file2>" ...   # explicit inputs
  python import_history.py                                  # default: archive/_history/*.csv
"""
import collections
import csv
import glob
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ARCHIVE_DIR = os.path.join(HERE, "archive")
OUT_CSV = os.path.join(ARCHIVE_DIR, "history_import.csv")

COLUMNS = ["timestamp", "device_id", "condition", "co2_ppm", "temp_c",
           "humidity_pct", "fan_duty", "window_state", "consent"]

# raw condition (as it appears in the legacy CSV) -> canonical label
RELABEL = {
    "eastwheelock_fan_closed_2ppl": "eastwheelock_fanclosed_2person",
    "T window fan":                 "midmass_windowfan_3person",
    "apt_bedroom_two_ppl":          "summit_bedroom_2person",
    "dorm_baseline_occupied":       "little_baseline_1person",
}

ALIASES = {"run": "condition", "co2": "co2_ppm", "temp_in_c": "temp_c"}


def _truthy(v):
    return str(v).strip().lower() in ("true", "1", "1.0", "yes", "on")


def map_row(raw: dict, canonical_label: str) -> dict:
    g = {ALIASES.get(k, k): v for k, v in raw.items()}
    fan = 100 if _truthy(g.get("fan_on", "")) else 0
    if "fan_duty" in g and str(g.get("fan_duty")).strip() not in ("", "None"):
        try:
            fan = int(float(g["fan_duty"]))
        except ValueError:
            pass
    return {
        "timestamp":    g.get("timestamp", ""),
        "device_id":    "ventis-01",
        "condition":    canonical_label,
        "co2_ppm":      g.get("co2_ppm", ""),
        "temp_c":       g.get("temp_c", ""),
        "humidity_pct": g.get("humidity_pct", ""),
        "fan_duty":     fan,
        "window_state": "",
        "consent":      "anon",
    }


def convert_files(paths, out_csv=OUT_CSV):
    out_rows = []
    for p in paths:
        with open(p, newline="", encoding="utf-8") as f:
            for raw in csv.DictReader(f):
                cond_col = "condition" if "condition" in raw else "run"
                raw_cond = str(raw.get(cond_col, "")).strip()
                if raw_cond not in RELABEL:
                    continue                        # only import the 4 target runs
                out_rows.append(map_row(raw, RELABEL[raw_cond]))
    os.makedirs(os.path.dirname(out_csv), exist_ok=True)
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        w.writeheader()
        w.writerows(out_rows)
    return len(out_rows)


def main(argv):
    if "--csv" in argv:
        paths = argv[argv.index("--csv") + 1:]
    else:
        paths = sorted(glob.glob(os.path.join(ARCHIVE_DIR, "_history", "*.csv")))
    n = convert_files(paths)
    print(f"history import: {n} rows -> {OUT_CSV}")
    summary = collections.Counter()
    for p in paths:
        with open(p, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                c = str(r.get("condition", r.get("run", ""))).strip()
                if c in RELABEL:
                    summary[RELABEL[c]] += 1
    for k, v in sorted(summary.items()):
        print(f"  {k}: {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
