# Ventis Historical Import + Robust Labeling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Get all 6 Ventis runs onto the live catalog with correct building names, by making `parse_label` robust and importing the 4 historical runs into the Sheet via a paste-able CSV.

**Architecture:** (1) Upgrade `parse_label` in `build_catalog.py` to scan a `KNOWN_BUILDINGS` registry + recognize occupancy variants. (2) A one-time `import_history.py` maps the legacy CSVs → telemetry schema, relabels to canonical `building_condition_occupancy`, sanitizes, and emits `archive/history_import.csv` for manual paste into the Sheet. (3) A paste-able cofounder guide. Then the existing pipeline + CI surface everything.

**Tech Stack:** Python 3 stdlib + pytest. No new deps.

**Design doc:** `docs/plans/2026-06-05-ventis-history-import-design.md`

**Conventions:** paths relative to repo root. Moat data stays gitignored (`archive/`). Work on branch `feat-history-import`.

---

## Phase 1 — Robust `parse_label`

### Task 1: Known-building scan

**Files:**
- Modify: `site/scripts/build_catalog.py`
- Test: `site/scripts/tests/test_build_catalog.py`

**Step 1: Write the failing test** (append)
```python
def test_parse_label_known_building_anywhere():
    # legacy "roomtype - building" must still resolve the building
    assert parse_label("1RSingle - Fahey")["building"] == "fahey"
    # building-first convention still works
    assert parse_label("judge_baseline_2person")["building"] == "judge"
    assert parse_label("eastwheelock_fanclosed_2person")["building"] == "eastwheelock"
    # unknown building -> first-token fallback (back-compat)
    assert parse_label("mystery_x_1person")["building"] == "mystery"
```

**Step 2: Run to verify it fails**
`python -m pytest site/scripts/tests/test_build_catalog.py::test_parse_label_known_building_anywhere -v` → FAIL.

**Step 3: Minimal implementation** — in `build_catalog.py`, add the registry above `parse_label` and use it:
```python
KNOWN_BUILDINGS = {
    # Ventis dataset buildings
    "fahey", "judge", "eastwheelock", "summit", "little", "midmass",
    # Dartmouth halls (seed; extend as runs are deployed)
    "cohen", "bissell", "brown", "french", "mclane", "hitchcock", "zimmerman",
    "wheeler", "richardson", "morton", "mcculloch", "russellsage", "butterfield",
    "streeter", "lord", "topliff", "ripley", "smith", "woodward", "gile",
    "northmass", "southfay", "midfay", "northfay", "hinman", "andres", "maxwell",
}

def parse_label(condition: str):
    """building_condition_occupancy -> {building, occupancy}. Tolerant of legacy.
    Building = first KNOWN_BUILDINGS token found anywhere, else first token."""
    s = str(condition or "").strip().lower()
    toks = [t for t in re.split(r"[^a-z0-9]+", s) if t]
    building = next((t for t in toks if t in KNOWN_BUILDINGS), toks[0] if toks else "")
    occ = _occupancy(toks)
    return {"building": building, "occupancy": occ}
```
(Leave the existing occupancy loop for now — Task 2 replaces it with `_occupancy`.)
For Task 1 only, keep occupancy inline if `_occupancy` not yet defined — simplest: define a stub `_occupancy` returning the existing logic:
```python
WORD_NUM = {"one":1,"two":2,"three":3,"four":4,"five":5,"six":6}

def _occupancy(toks):
    for t in toks:
        m = re.match(r"(\d+)person$", t)
        if m:
            return int(m.group(1))
    return None
```

**Step 4: Run to verify it passes** — PASS (and the 6 existing tests still pass: `... test_build_catalog.py -v`).

**Step 5: Commit**
```bash
git add site/scripts/build_catalog.py site/scripts/tests/test_build_catalog.py
git commit -m "feat(catalog): parse_label scans KNOWN_BUILDINGS (fixes legacy building)"
```

---

### Task 2: Occupancy variants

**Files:**
- Modify: `site/scripts/build_catalog.py` (`_occupancy`)
- Test: `site/scripts/tests/test_build_catalog.py`

**Step 1: Write the failing test** (append)
```python
def test_parse_label_occupancy_variants():
    assert parse_label("eastwheelock_fanclosed_2person")["occupancy"] == 2
    assert parse_label("eastwheelock_fan_closed_2ppl")["occupancy"] == 2
    assert parse_label("summit_bedroom_two_ppl")["occupancy"] == 2
    assert parse_label("midmass_windowfan_3person")["occupancy"] == 3
    assert parse_label("little_baseline_occupied")["occupancy"] is None
```

**Step 2: Run to verify it fails** — `2ppl` / `two_ppl` not handled → FAIL.

**Step 3: Minimal implementation** — replace `_occupancy`:
```python
WORD_NUM = {"one":1,"two":2,"three":3,"four":4,"five":5,"six":6}

def _occupancy(toks):
    # digit forms: "2person", "2ppl"
    for t in toks:
        m = re.match(r"(\d+)(person|ppl)$", t)
        if m:
            return int(m.group(1))
    # word forms: "two" immediately before "ppl"/"person"
    for i, t in enumerate(toks):
        if t in ("ppl", "person") and i > 0 and toks[i-1] in WORD_NUM:
            return WORD_NUM[toks[i-1]]
    return None
```

**Step 4: Run to verify it passes** — PASS (all prior tests too).

**Step 5: Commit**
```bash
git add site/scripts/build_catalog.py site/scripts/tests/test_build_catalog.py
git commit -m "feat(catalog): parse_label recognizes Nppl + word-number occupancy"
```

---

## Phase 2 — Historical import script

### Task 3: Legacy-row mapper (pure function)

**Files:**
- Create: `site/scripts/import_history.py`
- Test: `site/scripts/tests/test_import_history.py`

**Step 1: Write the failing test**
```python
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from import_history import map_row, RELABEL

def test_map_row_legacy_schema():
    raw = {"timestamp": "2026-06-01 01:00:00", "run": "eastwheelock_fan_closed_2ppl",
           "co2": "812", "temp_in_c": "22.5", "humidity_pct": "44"}
    r = map_row(raw, "eastwheelock_fanclosed_2person")
    assert r["condition"] == "eastwheelock_fanclosed_2person"
    assert r["co2_ppm"] == "812"
    assert r["temp_c"] == "22.5"
    assert r["device_id"] == "ventis-01"
    assert r["consent"] == "anon"
    # canonical telemetry columns present
    for c in ("timestamp","device_id","condition","co2_ppm","temp_c","humidity_pct",
              "fan_duty","window_state","consent"):
        assert c in r

def test_map_row_fan_on_to_duty():
    raw = {"timestamp": "t", "run": "T window fan", "co2": "700",
           "temp_in_c": "21", "humidity_pct": "40", "fan_on": "true"}
    assert map_row(raw, "midmass_windowfan_3person")["fan_duty"] == 100
    raw["fan_on"] = "false"
    assert map_row(raw, "midmass_windowfan_3person")["fan_duty"] == 0
```

**Step 2: Run to verify it fails** — FAIL (`import_history` missing).

**Step 3: Minimal implementation** — `site/scripts/import_history.py`:
```python
"""One-time importer: legacy run CSVs -> telemetry-schema CSV for pasting into the Sheet.

Maps legacy columns -> telemetry schema, relabels condition to the canonical
building_condition_occupancy convention, and anonymizes (device_id=ventis-01,
consent=anon). Emits archive/history_import.csv. Read-only on the Sheet (we never
write to it from here) — Diego pastes the output. See design doc.

Usage:
  python import_history.py --csv "<file1>" "<file2>" ...   # explicit inputs
  python import_history.py                                  # default: archive/_history/*.csv
"""
import csv, glob, os, sys

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
        try: fan = int(float(g["fan_duty"]))
        except ValueError: pass
    return {
        "timestamp":   g.get("timestamp", ""),
        "device_id":   "ventis-01",
        "condition":   canonical_label,
        "co2_ppm":     g.get("co2_ppm", ""),
        "temp_c":      g.get("temp_c", ""),
        "humidity_pct":g.get("humidity_pct", ""),
        "fan_duty":    fan,
        "window_state":"",
        "consent":     "anon",
    }
```

**Step 4: Run to verify it passes** — PASS.

**Step 5: Commit**
```bash
git add site/scripts/import_history.py site/scripts/tests/test_import_history.py
git commit -m "feat(import): legacy-row -> telemetry-schema mapper + relabel"
```

---

### Task 4: File driver (read CSVs, filter to RELABEL, emit one CSV)

**Files:**
- Modify: `site/scripts/import_history.py`
- Test: `site/scripts/tests/test_import_history.py`

**Step 1: Write the failing test** (append)
```python
import csv as _csv
from import_history import convert_files

def test_convert_files_filters_and_relabels(tmp_path):
    src = tmp_path / "ew.csv"
    src.write_text("timestamp,run,co2,temp_in_c,humidity_pct\n"
                   "2026-06-01 01:00:00,eastwheelock_fan_closed_2ppl,812,22.5,44\n"
                   "2026-06-01 01:00:30,some_unmapped_run,900,22,45\n", encoding="utf-8")
    out = tmp_path / "out.csv"
    n = convert_files([str(src)], str(out))
    rows = list(_csv.DictReader(open(out, encoding="utf-8")))
    assert n == 1                                   # unmapped row skipped
    assert rows[0]["condition"] == "eastwheelock_fanclosed_2person"
    assert rows[0]["device_id"] == "ventis-01"
```

**Step 2: Run to verify it fails** — FAIL (`convert_files` undefined).

**Step 3: Minimal implementation** (append)
```python
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
        w.writeheader(); w.writerows(out_rows)
    return len(out_rows)

def main(argv):
    if "--csv" in argv:
        paths = argv[argv.index("--csv") + 1:]
    else:
        paths = sorted(glob.glob(os.path.join(ARCHIVE_DIR, "_history", "*.csv")))
    n = convert_files(paths)
    print(f"history import: {n} rows -> {OUT_CSV}")
    # per-condition summary
    import collections
    summary = collections.Counter()
    for p in paths:
        with open(p, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                c = str(r.get("condition", r.get("run", ""))).strip()
                if c in RELABEL: summary[RELABEL[c]] += 1
    for k, v in sorted(summary.items()):
        print(f"  {k}: {v}")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

**Step 4: Run to verify it passes** — PASS (all import tests).

**Step 5: Commit**
```bash
git add site/scripts/import_history.py site/scripts/tests/test_import_history.py
git commit -m "feat(import): convert_files driver — filter to target runs + emit CSV"
```

---

### Task 5: Run against the real historical CSVs (smoke)

**Step 1:** Stage the 3 source CSVs into `archive/_history/` (gitignored) from the OneDrive backup:
```bash
mkdir -p site/scripts/archive/_history
python - <<'PY'
import zipfile
z = zipfile.ZipFile(r"C:/Users/turru/OneDrive/Ventis-Backups/ventis-FULL-dataset_2026-06-05_2112.zip")
for n in ["vault-Data/eastwheelock_fan_closed_2ppl.csv",
          "vault-Data/Ventis.v1 Logger - T window fan.csv",
          "vault-Data/ventis_data.csv"]:
    open("site/scripts/archive/_history/" + n.split("/")[-1], "wb").write(z.read(n))
print("staged 3 history CSVs")
PY
```
**Step 2:** `python site/scripts/import_history.py`
Expected: `history import: ~7994 rows -> .../history_import.csv` with per-condition counts:
`eastwheelock_fanclosed_2person: 1353`, `midmass_windowfan_3person: 2224`, `summit_bedroom_2person: 2363`, `little_baseline_1person: 2054`.
**Step 3:** Confirm `archive/_history/` and `history_import.csv` are gitignored (under `archive/`). No commit (artifacts only).

---

## Phase 3 — Cofounder guide

### Task 6: Write the paste-able Sheet guide

**Files:**
- Create: `docs/ventis-sheet-guide.md`

**Step 1:** Write `docs/ventis-sheet-guide.md` containing:
- **Labeling rule:** `building_condition_occupancy`, all lowercase, NEVER names/room numbers (anonymization cardinal rule). Examples: `little_baseline_1person`, `eastwheelock_fanclosed_2person`.
- **Building slugs:** the `KNOWN_BUILDINGS` list (consistent names; "if your building isn't here, add it lowercase, no spaces").
- **Start/stop a run:** edit the `control` tab **ROW 2** only — `A2`=logging (start/stop), `B2`=label, `C2`=**bump `seq` to a new higher number** (device compares vs NVS-persisted value). Editing any other row does nothing.
- **Handoff:** run `/ventis-backup` after a run.

**Step 2: Commit**
```bash
git add docs/ventis-sheet-guide.md
git commit -m "docs(import): paste-able in-Sheet cofounder labeling + start/stop guide"
```

---

## Phase 4 — Integrate + verify (needs Diego for the paste)

### Task 7: Paste + verify locally

**Step 1 (Diego):** Open `archive/history_import.csv`, copy its data rows (not the header), and **append** them to the Sheet's `telemetry` tab. Create a `guide` tab and paste `docs/ventis-sheet-guide.md`.
**Step 2:** `VENTIS_SHEET_ID=<id> python site/scripts/sqlite_sync.py`
Expected: `runs: 6` — conditions include all 6 canonical labels.
**Step 3:** `python site/scripts/build_catalog.py` → `catalog built: 6 runs`. Verify buildings:
```bash
python -c "import json;[print(r['building'],r['occupancy'],r['condition']) for r in json.load(open('library/public/data/catalog.json'))['runs']]"
```
Expected: `fahey 1 ...`, `judge 2 ...`, `eastwheelock 2 ...`, `summit 2 ...`, `little 1 ...`, `midmass 3 ...`.

### Task 8: Finish + deploy
- Run full suites: `python -m pytest site/scripts/tests/ -v` (all pass) ; `cd library && npm test`.
- Use superpowers:finishing-a-development-branch → PR `feat-history-import` → `main`.
- After merge: manual `workflow_dispatch` → live catalog shows all 6 runs with correct buildings.
- Update memory + vault `Data/Data Library — Design.md` (note: 6 runs live).

---

## Notes
- DRY: reuse `sqlite_sync`/`build_catalog`; the importer only maps + relabels.
- YAGNI: no Sheet auto-write, no editing existing Fahey/Judge rows, no exhaustive hall list.
- Anonymization is enforced at import (device_id=ventis-01, consent=anon, canonical labels) — the cardinal rule.
