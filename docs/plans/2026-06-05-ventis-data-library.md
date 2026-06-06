# Ventis Data Library Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a private, auto-updating web catalog of every Ventis run (sort/filter → run detail with SOP chart + stats + notes), refreshed by a cron GitHub Action over the existing pipeline.

**Architecture:** Approach A (scheduled static + gated host), built B-ready. A cron Action pulls the Sheet (ephemeral read-only key) → existing pipeline (`sqlite_sync`/`archive_runs`/`plot_ventis_run`) → `build_catalog.py` emits `catalog.json` + per-run series JSON + chart PNGs → a static React/Vite app → deployed to a gated host. `catalog.json` schema = the future Postgres `runs` table 1:1.

**Tech Stack:** Python 3 (stdlib + existing scripts; pytest), React + Vite + TypeScript (Vitest), GitHub Actions, Cloudflare Pages + Access (or Vercel Authentication).

**Design doc:** `docs/plans/2026-06-05-ventis-data-library-design.md`

**Conventions:** all paths relative to repo root `C:\Users\turru\Projects\ventis`. Moat data (`ventis.db`, CSVs, JSON, PNGs) are build artifacts — never committed. Work on branch `feat-data-library`.

---

## Phase 1 — Catalog builder (`build_catalog.py`)

### Task 1: Parse building/occupancy from the condition label

**Files:**
- Create: `site/scripts/build_catalog.py`
- Test: `site/scripts/tests/test_build_catalog.py`

**Step 1: Write the failing test**
```python
# site/scripts/tests/test_build_catalog.py
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from build_catalog import parse_label

def test_parse_label_standard():
    assert parse_label("choates_windowclosed_1person") == {
        "building": "choates", "occupancy": 1}

def test_parse_label_two_person():
    assert parse_label("mclane_acon_2person")["occupancy"] == 2

def test_parse_label_no_occupancy():
    assert parse_label("east_wheelock")["occupancy"] is None

def test_parse_label_legacy_freeform():
    # legacy labels (spaces/caps) still yield a building token, no crash
    assert parse_label("1RSingle - Fahey")["building"] != ""
```

**Step 2: Run to verify it fails**
Run: `python -m pytest site/scripts/tests/test_build_catalog.py -v`
Expected: FAIL (`build_catalog` / `parse_label` not defined).

**Step 3: Minimal implementation**
```python
# site/scripts/build_catalog.py  (top)
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
```

**Step 4: Run to verify it passes**
Run: `python -m pytest site/scripts/tests/test_build_catalog.py -v`
Expected: PASS (4 tests).

**Step 5: Commit**
```bash
git add site/scripts/build_catalog.py site/scripts/tests/test_build_catalog.py
git commit -m "feat(catalog): parse building/occupancy from condition label"
```

---

### Task 2: Build a catalog record from a run (the B-ready contract)

**Files:**
- Modify: `site/scripts/build_catalog.py`
- Test: `site/scripts/tests/test_build_catalog.py`

**Step 1: Write the failing test** (append)
```python
from build_catalog import run_record

def test_run_record_shape():
    run = {"run_key": "k1", "run_id": "ventis-01_100", "device_id": "ventis-01",
           "condition": "choates_windowclosed_1person", "start": "2026-06-01 21:00:00",
           "end": "2026-06-01 23:00:00", "n_rows": 240, "co2_mean": 800.0,
           "co2_peak": 1100.0}
    r = run_record(run)
    for key in ("run_id","building","occupancy","date","duration_h","co2_peak",
                "ashrae_exceed","consent","chart","csv","series","notes"):
        assert key in r
    assert r["building"] == "choates"
    assert r["ashrae_exceed"] is True          # peak 1100 > 1000
    assert r["date"] == "2026-06-01"
    assert abs(r["duration_h"] - 2.0) < 0.01
```

**Step 2: Run to verify it fails** — `... -v` → FAIL (`run_record` undefined).

**Step 3: Minimal implementation** (append to `build_catalog.py`)
```python
from datetime import datetime

ASHRAE = 1000

def _parse_dt(s):
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try: return datetime.strptime(str(s), fmt)
        except (ValueError, TypeError): pass
    return None

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

def _slug(s):
    return re.sub(r"[^a-z0-9]+", "_", str(s).lower()).strip("_") or "run"
```

**Step 4: Run to verify it passes** — PASS.

**Step 5: Commit**
```bash
git add site/scripts/build_catalog.py site/scripts/tests/test_build_catalog.py
git commit -m "feat(catalog): run_record = B-ready catalog contract"
```

---

### Task 3: Emit catalog.json + per-run series + gather charts

**Files:**
- Modify: `site/scripts/build_catalog.py`
- Test: `site/scripts/tests/test_build_catalog.py` (uses a temp SQLite fixture)

**Step 1: Write the failing test** (append)
```python
import sqlite3, json, tempfile
from build_catalog import build

def _fixture_db(path):
    con = sqlite3.connect(path)
    con.executescript("""
      CREATE TABLE runs (run_key TEXT, run_id TEXT, device_id TEXT, condition TEXT,
        start TEXT, end TEXT, n_rows INT, co2_mean REAL, co2_peak REAL);
      CREATE TABLE readings (run_key TEXT, run_id TEXT, timestamp TEXT,
        co2_ppm REAL, temp_c REAL, humidity_pct REAL);
      INSERT INTO runs VALUES ('k1','r1','ventis-01','choates_x_1person',
        '2026-06-01 21:00:00','2026-06-01 22:00:00',2,800,1100);
      INSERT INTO readings VALUES ('k1','r1','2026-06-01 21:00:00',800,22,40),
                                  ('k1','r1','2026-06-01 21:30:00',1100,22,41);
    """); con.commit(); con.close()

def test_build_emits_catalog_and_series(tmp_path):
    db = tmp_path / "ventis.db"; _fixture_db(str(db))
    out = tmp_path / "out"
    build(db_path=str(db), out_dir=str(out), graphs_dir=str(tmp_path))
    cat = json.load(open(out / "catalog.json"))
    assert len(cat["runs"]) == 1
    assert cat["runs"][0]["building"] == "choates"
    series = json.load(open(out / "series" / "r1.json"))
    assert len(series["co2_ppm"]) == 2
```

**Step 2: Run to verify it fails** — FAIL (`build` undefined).

**Step 3: Minimal implementation** (append)
```python
SERIES_MAX = 1500   # downsample cap per run for the (future) compare view

def build(db_path=DB, out_dir=None, graphs_dir=GRAPHS_DIR):
    out_dir = out_dir or os.path.join(HERE, "..", "library", "public", "data")
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
            if f.endswith(".png"): shutil.copy2(os.path.join(graphs_dir, f), cdst)
    return len(records)

def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def main(argv):
    n = build()
    print(f"catalog built: {n} runs")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

**Step 4: Run to verify it passes** — PASS (all tests).

**Step 5: Commit**
```bash
git add site/scripts/build_catalog.py site/scripts/tests/test_build_catalog.py
git commit -m "feat(catalog): emit catalog.json + downsampled per-run series + charts"
```

---

### Task 4: Run the builder against the real DB (smoke)

**Step 1:** `python site/scripts/sqlite_sync.py` (ensure db fresh).
**Step 2:** `python site/scripts/build_catalog.py`
Expected: `catalog built: 2 runs`; `library/public/data/catalog.json` exists with the real runs; `series/*.json` + `charts/*.png` present.
**Step 3:** Add `library/public/data/` to `.gitignore` (build artifact / moat).
```bash
echo "library/public/data/" >> .gitignore
git add .gitignore && git commit -m "chore: gitignore catalog build artifacts (moat)"
```

---

## Phase 2 — Catalog frontend (`library/`)

### Task 5: Scaffold the Vite + React + TS app

**Step 1:** Scaffold:
```bash
cd "C:/Users/turru/Projects/ventis" && npm create vite@latest library -- --template react-ts
cd library && npm install && npm install react-router-dom recharts
```
**Step 2:** Copy design tokens from `app/` (colors/typography) into `library/src/theme.css`; import in `main.tsx`. (Keep it minimal — match the existing Ventis look.)
**Step 3:** Add Vitest:
```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```
Add to `library/package.json` scripts: `"test": "vitest run"`. Add `library/vitest.config.ts` (jsdom env).
**Step 4: Commit**
```bash
git add library && git commit -m "chore(library): scaffold Vite+React+TS catalog app"
```

---

### Task 6: Catalog table (load catalog.json, sort + filter)

**Files:**
- Create: `library/src/lib/catalog.ts` (types + loader), `library/src/components/RunTable.tsx`
- Test: `library/src/lib/catalog.test.ts`

**Step 1: Write the failing test** (a pure filter/sort util — the testable core)
```ts
// library/src/lib/catalog.test.ts
import { describe, it, expect } from "vitest";
import { filterRuns, sortRuns, Run } from "./catalog";
const runs: Run[] = [
  { run_id:"a", building:"choates", occupancy:1, co2_peak:1100, date:"2026-06-01" } as Run,
  { run_id:"b", building:"fahey",   occupancy:2, co2_peak:700,  date:"2026-06-02" } as Run,
];
it("filters by building", () => {
  expect(filterRuns(runs, { building:"choates" }).length).toBe(1);
});
it("sorts by co2_peak desc", () => {
  expect(sortRuns(runs, "co2_peak", "desc")[0].run_id).toBe("a");
});
```

**Step 2: Run to verify it fails** — `cd library && npm test` → FAIL.

**Step 3: Minimal implementation** — `library/src/lib/catalog.ts`
```ts
export interface Run {
  run_id: string; run_key: string; building: string; condition: string;
  occupancy: number|null; window_state: string; date: string; start: string;
  end: string; duration_h: number|null; n_rows: number; co2_mean: number|null;
  co2_peak: number|null; ashrae_exceed: boolean; consent: string;
  chart: string; csv: string; series: string; notes: string;
}
export async function loadCatalog(): Promise<Run[]> {
  const r = await fetch("/data/catalog.json"); return (await r.json()).runs;
}
export function filterRuns(runs: Run[], f: Partial<Record<keyof Run, any>>): Run[] {
  return runs.filter(r => Object.entries(f).every(([k,v]) =>
    v == null || v === "" || String((r as any)[k]).toLowerCase().includes(String(v).toLowerCase())));
}
export function sortRuns(runs: Run[], key: keyof Run, dir: "asc"|"desc"): Run[] {
  const s = [...runs].sort((a,b) => ((a[key] as any) > (b[key] as any) ? 1 : -1));
  return dir === "desc" ? s.reverse() : s;
}
```

**Step 4: Run to verify it passes** — PASS.

**Step 5:** Build `RunTable.tsx` (renders rows, column headers toggle sort, filter inputs for building/condition/occupancy/date; ASHRAE-exceed shown as a red badge; row → `/run/:run_id`). Wire into `App.tsx`.

**Step 6: Commit**
```bash
git add library/src && git commit -m "feat(library): run catalog table with filter + sort"
```

---

### Task 7: Run detail page (chart + stats + series)

**Files:**
- Create: `library/src/components/RunDetail.tsx`
- Modify: `library/src/App.tsx` (route `/run/:run_id`)

**Step 1:** Render: the SOP chart `<img src={/data/charts/${run.chart}}>`, a stats block (building, occupancy, window, duration, n_rows, co2_mean/peak, ASHRAE badge, consent, run_id), and the analysis-note text if present. (Recharts re-plot of `series/<run_id>.json` is optional polish — the PNG is the SOP chart.)
**Step 2:** Manual check: `npm run dev`, click a run, detail loads chart + stats.
**Step 3: Commit**
```bash
git add library/src && git commit -m "feat(library): run detail page (chart + stats)"
```

---

### Task 8: Build + local full-app verification

**Step 1:** `cd library && npm run build` → `library/dist/` builds clean.
**Step 2:** `npm run preview`, click through: table sorts/filters, detail pages load charts. (`public/data/` is populated by Task 4.)
**Step 3: Commit** any fixups.

---

## Phase 3 — Automation + gated hosting

### Task 9: GitHub Action — scheduled refresh + deploy

**Files:**
- Create: `.github/workflows/data-library.yml`

**Step 1:** Workflow (cron + manual dispatch):
```yaml
name: data-library
on:
  schedule: [{ cron: "17 * * * *" }]   # hourly
  workflow_dispatch:
jobs:
  build-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install -r site/scripts/requirements.txt
      - name: Write service-account key
        run: echo '${{ secrets.VENTIS_SA_JSON }}' > site/scripts/service_account.json
      - name: Refresh + build catalog
        env:
          VENTIS_SHEET_ID: ${{ secrets.VENTIS_SHEET_ID }}
        run: |
          python site/scripts/sqlite_sync.py
          python site/scripts/archive_runs.py --all
          python site/scripts/build_catalog.py
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: cd library && npm ci && npm run build
      - name: Deploy to Cloudflare Pages
        uses: cloudflare/pages-action@v1
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}
          accountId: ${{ secrets.CF_ACCOUNT_ID }}
          projectName: ventis-data-library
          directory: library/dist
```
**Step 2:** Add charts step — generate PNGs before build_catalog: `python site/scripts/plot_ventis_run.py --csv site/scripts/archive/telemetry_live.csv --all --out site/scripts/archive/graphs` (and ensure matplotlib in requirements). Or call `refresh_backup.py --no-graphs` is wrong here (we want graphs) — call the individual steps as above + a plot step.
**Step 3:** Set repo **secrets**: `VENTIS_SA_JSON` (the key file contents), `VENTIS_SHEET_ID`, `CF_API_TOKEN`, `CF_ACCOUNT_ID`.
**Step 4:** Verify key file is gitignored (`site/scripts/service_account.json` already is). Confirm the Action never commits artifacts.
**Step 5: Commit**
```bash
git add .github/workflows/data-library.yml
git commit -m "ci(library): scheduled refresh + deploy to Cloudflare Pages"
```

---

### Task 10: Gate the site (Cloudflare Access) — and PROVE it blocks anon

> 🔴 Moat boundary. Do NOT enable the cron / first real deploy until the gate is verified.

**Step 1:** In Cloudflare: create the Pages project `ventis-data-library`. Add an **Access application** over its domain — policy = email allowlist (Diego + cofounder).
**Step 2:** Trigger one **manual** `workflow_dispatch` deploy.
**Step 3: VERIFY THE GATE:** `curl -sI https://<project>.pages.dev/data/catalog.json` from an unauthenticated context → expect a **302 to the Cloudflare Access login**, NOT `200` + JSON. Also load in an incognito browser → login wall, no data visible.
**Step 4:** Only after the gate is confirmed, leave the hourly cron enabled.
**Step 5:** Document the host + secrets in vault `Data/Live Sheet Pull Setup.md` (append a "Data Library" section).

---

## Phase 4 — Verify & finish

### Task 11: End-to-end verification

- [ ] `python -m pytest site/scripts/tests/ -v` — builder tests pass.
- [ ] `cd library && npm test` — frontend util tests pass.
- [ ] Manual dispatch the Action → green; catalog reflects current runs.
- [ ] Gate blocks anonymous (Task 10 Step 3) — **evidence captured**.
- [ ] Authenticated load: table sorts/filters; every run's detail shows its SOP chart.
- [ ] No moat artifact committed: `git status` clean of `*.db`, `catalog.json`, `*.png` under `library/public/data`.

### Task 12: Docs + finish branch
- Update `docs/plans/2026-06-05-ventis-data-library-design.md` open-questions (host = Cloudflare, cadence = hourly).
- Update vault `Data/Data Library — Design.md` status → built.
- Use superpowers:finishing-a-development-branch to open the PR / merge.

---

## Notes
- DRY: reuse `sheet_source`/`sqlite_sync`/`archive_runs`/`plot_ventis_run` — the builder only adds the catalog contract + series.
- YAGNI: no compare/annotations/upload/query in v1 (series JSON is emitted so compare is data-ready later).
- B graduation: load `ventis.db` → Postgres `runs` (= `catalog.json` schema), point the same frontend at Supabase + auth.
