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

try:
    import sheet_source  # same dir; optional — private live Google Sheets pull
except ImportError:
    sheet_source = None

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


def _mean(xs):
    return sum(xs) / len(xs) if xs else None


def bucketize(samples):
    """samples: list of dicts {ts, co2, fan?, tempC?, hum?, tempOutC?}.

    Returns 5-min-bucketed points. CO2 = mean, fan = max, temp/humidity = mean.
    temp/humidity/outdoor are only emitted on points where source data exists
    (never fabricated)."""
    samples = [s for s in samples if s.get("co2") is not None and s["co2"] > 0]
    if not samples:
        return []
    samples.sort(key=lambda x: x["ts"])
    t0 = samples[0]["ts"]
    midnight = t0.replace(hour=0, minute=0, second=0, microsecond=0)
    buckets = {}
    for s in samples:
        key = int((s["ts"] - t0).total_seconds() // (BUCKET_MIN * 60))
        b = buckets.setdefault(key, {"co2": [], "fan": [], "tempC": [], "hum": [], "tempOutC": [], "ts": s["ts"]})
        b["co2"].append(s["co2"])
        for fld in ("fan", "tempC", "hum", "tempOutC"):
            if s.get(fld) is not None:
                b[fld].append(s[fld])
    pts = []
    for key in sorted(buckets):
        b = buckets[key]
        hod = round((b["ts"] - midnight).total_seconds() / 3600.0, 3)
        p = {"hod": hod, "co2": round(_mean(b["co2"]))}
        if b["fan"]:
            p["fan"] = round(max(b["fan"]))
        if b["tempC"]:
            p["tempC"] = round(_mean(b["tempC"]), 1)
        if b["hum"]:
            p["hum"] = round(_mean(b["hum"]))
        if b["tempOutC"]:
            p["tempOutC"] = round(_mean(b["tempOutC"]), 1)
        pts.append(p)
    return pts


def _num(row, *keys):
    for k in keys:
        v = row.get(k, "")
        if v is not None and str(v).strip() != "":
            try:
                return float(v)
            except ValueError:
                pass
    return None


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
            out.append({"ts": parse_ts(r["timestamp"]), "co2": co2,
                        "tempC": _num(r, "temp_c"), "hum": _num(r, "humidity_pct")})
    return bucketize(out)


def from_ew():
    out = []
    with open(EW, newline="") as f:
        for r in csv.DictReader(f):
            try:
                co2 = int(float(r["co2"]))
            except (ValueError, KeyError):
                continue
            out.append({"ts": parse_ts(r["timestamp"]), "co2": co2,
                        "tempC": _num(r, "temp_in_c"), "hum": _num(r, "humidity_pct"),
                        "tempOutC": _num(r, "temp_out_c")})
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
            fan = _num(r, "fan_duty")
            if fan is not None:
                fan = round(fan / 255.0 * 100)
            out.append({"ts": parse_ts(r["timestamp"]), "co2": co2, "fan": fan,
                        "tempC": _num(r, "temp_c"), "hum": _num(r, "humidity_pct")})
    return bucketize(out)


# ── Live Google Sheets source (private; for NEW runs, no CSV export) ──────────
_TELEMETRY_CACHE = None


def _telemetry_rows():
    """Cached pull of the live `telemetry` tab, or None if not configured."""
    global _TELEMETRY_CACHE
    if _TELEMETRY_CACHE is None:
        if sheet_source and sheet_source.sheet_configured():
            try:
                _TELEMETRY_CACHE = sheet_source.fetch_rows()
                print(f"  [sheet] live: pulled {len(_TELEMETRY_CACHE)} telemetry rows")
            except Exception as e:  # noqa: BLE001 — any failure → local fallback
                print(f"  [sheet] live pull failed ({e}); using local CSVs only")
                _TELEMETRY_CACHE = []
        else:
            _TELEMETRY_CACHE = []
    return _TELEMETRY_CACHE or None


def from_sheet(condition):
    """Build a run's points from the live telemetry tab, filtered by `condition`.

    Use this for NEW runs you log going forward — no CSV download needed. fan_duty
    is auto-scaled: any value >100 is treated as a 0-255 PWM byte, else as 0-100 %.
    Returns [] (skips the run) if the live sheet isn't configured."""
    rows = _telemetry_rows()
    if not rows:
        print(f"  [sheet] '{condition}': no live data (sheet not configured) — skipped")
        return []
    raw = [r for r in rows if str(r.get("condition", "")).strip() == condition]
    fans = [f for f in (_num(r, "fan_duty") for r in raw) if f is not None]
    scale = 255.0 if (fans and max(fans) > 100) else 100.0
    out = []
    for r in raw:
        try:
            co2 = int(float(r["co2_ppm"]))
        except (ValueError, KeyError, TypeError):
            continue
        fan = _num(r, "fan_duty")
        out.append({"ts": parse_ts(str(r["timestamp"])), "co2": co2,
                    "fan": round(fan / scale * 100) if fan is not None else None,
                    "tempC": _num(r, "temp_c"), "hum": _num(r, "humidity_pct")})
    return bucketize(out)


# To add a NEW run to the site WITHOUT any CSV download: log it with a clean
# label (e.g. "judge_closed_1ppl"), then add an entry to `runs` below using
# points=from_sheet("judge_closed_1ppl"), and add its id to the `order` list.


def peak(points):
    return max(p["co2"] for p in points) if points else None


runs = {
    "choates": {
        "id": "choates",
        "name": "Choates / Little Hall · 1 person, no AC",
        "tag": "The wake-up call",
        "hero": True,
        "framing": "Old, un-renovated stock with no AC and poor ventilation. One person, asleep, pushed the room to 1,111 ppm and held it about four hours above the ASHRAE 1,000 ppm line. No alarm, no smell, no way to know it was happening.",
        "takeaway": "Bad air doesn’t need a crowd. One person in old stock is enough, and you’d never feel it.",
        "peakLabel": 1111,
        "peakNote": "~4 hrs above ASHRAE 1,000 ppm",
        "points": from_vault("dorm_baseline_occupied"),
    },
    "fahey": {
        "id": "fahey",
        "name": "Fahey Hall · single",
        "tag": "Why “just open a window” isn’t the answer",
        "framing": "An open window worked: the air was clean at ~650 ppm. Then the occupant closed it at ~2:30 AM for the AC and fell asleep. Over the next nine hours CO₂ climbed to 979 with the fan running the whole time. It only cleared when they woke and reopened the window at ~11:40 AM.",
        "takeaway": "A window ventilates only while it’s open and you’re awake to keep it that way. The moment comfort wins (heat, cold, or the AC), your air degrades for hours you’ll never feel. That’s the gap Ventis closes.",
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
        "name": "2-person apartment · central AC",
        "tag": "AC ≠ ventilation",
        "framing": "A modern apartment with central AC still hit 1,176 ppm with two people, roughly eight hours above 1,000 ppm overnight.",
        "takeaway": "Air conditioning cools the air; it doesn’t exchange it. CO₂ still builds.",
        "peakLabel": 1176,
        "peakNote": "~8 hrs above ASHRAE 1,000 ppm",
        "points": from_vault("apt_bedroom_two_ppl"),
    },
    "eastwheelock": {
        "id": "eastwheelock",
        "name": "East Wheelock · renovated HVAC, 2 people",
        "tag": "Honest negative control",
        "framing": "Premium, renovated stock with real mechanical ventilation. Two occupants, yet CO₂ peaked at 846 ppm and declined overnight, never crossing 1,000.",
        "takeaway": "We don’t overclaim. Buildings that already exchange air don’t need us; the old stock does.",
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
