"""Extract the 4 measured Ventis runs into a Recharts-ready runs.json.

Source CSVs (real measured data — DO NOT fabricate values):
  - dorm_baseline_occupied (Choates/Little)  -> vault ventis_data.csv
  - apt_bedroom_two_ppl     (2-person apt)    -> vault ventis_data.csv
  - East Wheelock           (neg. control)    -> repo "1RDouble - EW.csv"
  - 1RSingle - Fahey        (hero, window exp)-> repo telemetry.csv

Downsamples to 5-minute buckets (mean CO2, max fan). X-axis = continuous
hours-of-day (start-day midnight = 0; next day carries past 24) so wall-clock
tick labels stay honest across the overnight boundary.

Run from anywhere:  python extract_runs.py
Writes: ../src/data/runs.json
"""
import csv, json, os
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "src", "data", "runs.json"))

VAULT = r"C:\Users\turru\Documents\Diego_School_Vault\Projects\Ventis\Data\ventis_data.csv"
REPO = r"C:\Users\turru\Projects\ventis"
EW = os.path.join(REPO, "Ventis.v1 Logger - 1RDouble - EW.csv")
FAHEY = os.path.join(REPO, "Ventis.v1 Logger - telemetry.csv")

BUCKET_MIN = 5


def parse_ts(s):
    s = s.strip()
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    raise ValueError(f"bad ts {s!r}")


def bucketize(samples):
    """samples: list of (datetime, co2, fan_or_None). Returns list of points."""
    samples = [s for s in samples if s[1] is not None and s[1] > 0]
    if not samples:
        return []
    samples.sort(key=lambda x: x[0])
    t0 = samples[0][0]
    midnight = t0.replace(hour=0, minute=0, second=0, microsecond=0)
    buckets = {}
    for ts, co2, fan in samples:
        key = int((ts - t0).total_seconds() // (BUCKET_MIN * 60))
        b = buckets.setdefault(key, {"co2": [], "fan": [], "ts": ts})
        b["co2"].append(co2)
        if fan is not None:
            b["fan"].append(fan)
    pts = []
    for key in sorted(buckets):
        b = buckets[key]
        ts = b["ts"]
        hod = round((ts - midnight).total_seconds() / 3600.0, 3)
        p = {"hod": hod, "co2": round(sum(b["co2"]) / len(b["co2"]))}
        if b["fan"]:
            p["fan"] = round(max(b["fan"]))
        pts.append(p)
    return pts


def from_vault(label):
    out = []
    with open(VAULT, newline="") as f:
        for r in csv.DictReader(f):
            if r["condition"] != label:
                continue
            try:
                co2 = int(float(r["co2_ppm"]))
            except (ValueError, KeyError):
                continue
            out.append((parse_ts(r["timestamp"]), co2, None))
    return bucketize(out)


def from_ew():
    out = []
    with open(EW, newline="") as f:
        for r in csv.DictReader(f):
            try:
                co2 = int(float(r["co2"]))
            except (ValueError, KeyError):
                continue
            out.append((parse_ts(r["timestamp"]), co2, None))
    return bucketize(out)


def from_fahey():
    out = []
    with open(FAHEY, newline="") as f:
        for r in csv.DictReader(f):
            if r["condition"] != "1RSingle - Fahey":
                continue
            try:
                co2 = int(float(r["co2_ppm"]))
            except (ValueError, KeyError):
                continue
            # fan_duty 0-255 -> percent (128 ~= 50% per field notes)
            fan = None
            try:
                fan = round(float(r["fan_duty"]) / 255.0 * 100)
            except (ValueError, KeyError):
                fan = None
            out.append((parse_ts(r["timestamp"]), co2, fan))
    return bucketize(out)


def peak(points):
    return max(p["co2"] for p in points) if points else None


runs = {
    "choates": {
        "id": "choates",
        "name": "Choates / Little Hall — 1 person, no AC",
        "tag": "The wake-up call",
        "hero": True,
        "framing": "Old, un-renovated stock — no AC, poor ventilation. One person, asleep, pushed the room to 1,111 ppm and held it about four hours above the ASHRAE 1,000 ppm line. No alarm, no smell, no way to know it was happening.",
        "takeaway": "Bad air doesn’t need a crowd. One person in old stock is enough — and you’d never feel it.",
        "peakLabel": 1111,
        "peakNote": "~4 hrs above ASHRAE 1,000 ppm",
        "points": from_vault("dorm_baseline_occupied"),
    },
    "fahey": {
        "id": "fahey",
        "name": "Fahey Hall — single",
        "tag": "Why “just open a window” isn’t the answer",
        "framing": "An open window worked — the air was clean at ~650 ppm. Then the occupant closed it at ~2:30 AM for the AC and fell asleep. Over the next nine hours CO₂ climbed to 979 with the fan running the whole time, useless. It only cleared when they woke and reopened the window at ~11:40 AM.",
        "takeaway": "A window ventilates only while it’s open and you’re awake to keep it that way. The moment comfort wins — heat, cold, or the AC — your air degrades for hours you’ll never feel. That’s the gap Ventis closes.",
        "peakLabel": 979,
        "peakNote": "the problem was the nine hours, not the 979 peak",
        "showFan": True,
        "phases": [
            {"from": 21.583, "to": 26.5, "label": "WINDOW OPEN", "kind": "open"},
            {"from": 26.5, "to": 35.667, "label": "WINDOW CLOSED · fan 100%", "kind": "closed"},
            {"from": 35.667, "to": 40.0, "label": "REOPENED", "kind": "open"},
        ],
        "points": from_fahey(),
    },
    "apt": {
        "id": "apt",
        "name": "2-person apartment — central AC",
        "tag": "AC ≠ ventilation",
        "framing": "A modern apartment with central AC still hit 1,176 ppm with two people — roughly eight hours above 1,000 ppm overnight.",
        "takeaway": "Air conditioning cools the air; it doesn’t exchange it. CO₂ still builds.",
        "peakLabel": 1176,
        "peakNote": "~8 hrs above ASHRAE 1,000 ppm",
        "points": from_vault("apt_bedroom_two_ppl"),
    },
    "eastwheelock": {
        "id": "eastwheelock",
        "name": "East Wheelock — renovated HVAC, 2 people",
        "tag": "Honest negative control",
        "framing": "Premium, renovated stock with real mechanical ventilation. Two occupants, yet CO₂ peaked at 846 ppm and declined overnight — never crossing 1,000.",
        "takeaway": "We don’t overclaim. Buildings that already exchange air don’t need us — the old stock does.",
        "peakLabel": 846,
        "peakNote": "declined overnight; never crossed 1,000",
        "points": from_ew(),
    },
}

for r in runs.values():
    r["peak"] = peak(r["points"])
    r["n"] = len(r["points"])

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump({"order": ["choates", "fahey", "apt", "eastwheelock"], "runs": runs}, f, ensure_ascii=False, indent=1)

for k, r in runs.items():
    print(f"{k:14s} n={r['n']:4d}  peak={r['peak']} ppm")
print("wrote", OUT)
