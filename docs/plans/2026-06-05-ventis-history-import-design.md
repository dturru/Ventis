# Ventis Data Library — Historical Import, Robust Labeling & Cofounder Guide (Design)

**Date:** 2026-06-05
**Builds on:** `2026-06-05-ventis-data-library-design.md` (the live catalog). This adds the *rest* of the runs + fixes building extraction + a cofounder guide.

## Problem
The live catalog (https://ventis-data-library.pages.dev) shows only **Fahey + Judge** — the two runs in the live Sheet. Two issues:
1. **Building mislabeled:** `parse_label` takes the first token as building, so the legacy `1RSingle - Fahey` shows building `1rsingle` instead of `fahey`.
2. **Missing runs:** the other historical runs (East Wheelock, Summit/apt, Little, Mid-Mass "T window fan") live as gitignored legacy CSVs. The repo is **public** and `archive/` is gitignored (the moat), so CI rebuilds the catalog from the **Sheet only** → those runs never reach the live site.

## Decisions
- **Single source = the live Sheet.** Import the historical runs into the Sheet so CI (and local) naturally include them forever. (Chosen over a separate private CI source or local-only.)
- **Write method = script-emits-CSV, paste manually.** The read-only service-account key is never widened (matches the storage spec's "separate write path"). The import script produces a telemetry-schema CSV; Diego pastes it into the Sheet. Guide-tab text pasted likewise.
- **Fix labels in code, not by editing 2,548 existing rows.** `parse_label` becomes robust (known-building scan + occupancy variants), so legacy labels render correctly without rewriting Sheet history.

## Canonical labels (`building_condition_occupancy`)
| Run | Raw label | Canonical | Occ |
|---|---|---|---|
| Fahey (in Sheet) | `1RSingle - Fahey` | `fahey_window_1person` | 1 |
| Judge (in Sheet) | `Judge_3RDouble` | `judge_baseline_2person` | 2 |
| East Wheelock | `eastwheelock_fan_closed_2ppl` | `eastwheelock_fanclosed_2person` | 2 |
| Summit on Juniper (apt) | `apt_bedroom_two_ppl` | `summit_bedroom_2person` | 2 |
| Little Hall | `dorm_baseline_occupied` | `little_baseline_1person` | 1 |
| Mid Mass Hall (was "T") | `T window fan` | `midmass_windowfan_3person` | 3 (2-room triple) |

Fahey/Judge stay as-is in the Sheet; the robust `parse_label` resolves their building. The 4 imported runs land with clean canonical labels.

## Components
1. **Robust `parse_label`** (`site/scripts/build_catalog.py`)
   - `KNOWN_BUILDINGS` registry: our data buildings (`fahey, judge, eastwheelock, summit, little, midmass`) + confident Dartmouth halls; trivially extensible.
   - Building = first `KNOWN_BUILDINGS` token found anywhere in the label; else first token (back-compat).
   - Occupancy = `(\d+)person` | `(\d+)ppl` | word-numbers (`one..six`). `occupied`/blank → None (but our relabels carry explicit `Nperson`).
   - Unit tests for: `1RSingle - Fahey`→fahey/1; `eastwheelock_fanclosed_2person`→eastwheelock/2; `midmass_windowfan_3person`→midmass/3; `summit_bedroom_2person`→summit/2; legacy fallback unchanged.

2. **`site/scripts/import_history.py`** (one-time, re-runnable)
   - Input: the 4 historical CSVs (from the OneDrive FULL-dataset backup / `archive/`).
   - Map legacy schema → telemetry schema (`run`→`condition`, `co2`→`co2_ppm`, `temp_in_c`→`temp_c`, `fan_on`→`fan_duty` 0/100, fill `humidity_pct`).
   - Relabel `condition` per the table; sanitize (anonymize: strip names/room numbers, force `device_id=ventis-01`, `consent=anon`).
   - Emit one telemetry-schema CSV (`archive/history_import.csv`) with the canonical `COLUMNS` order, ready to paste into the Sheet's `telemetry` tab.
   - Idempotent downstream: `sqlite_sync` dedups on `UNIQUE(device_id, timestamp)`, so a re-paste won't duplicate.

3. **`guide` tab content** (`docs/ventis-sheet-guide.md` → paste into a new Sheet tab)
   - Labeling convention `building_condition_occupancy` + examples.
   - The `KNOWN_BUILDINGS` slug list (consistent building names).
   - Start/stop steps + the control-tab **row-2 + bump `seq`** gotcha (from the Logger Deployment SOP).

## Data flow
historical CSVs → `import_history.py` (map + relabel + sanitize) → **paste into Sheet** → existing pipeline (`sqlite_sync` unions Sheet) → robust `build_catalog` → catalog.json → CI deploy → live catalog shows all 6 runs, correct buildings.

## Testing
- `parse_label` unit tests (above) — pytest.
- `import_history` test: a legacy-schema fixture row maps to the right telemetry columns + canonical label + sanitized device id.
- Verification: after paste + `sqlite_sync`, `runs` table has 6 rows with the canonical conditions; `build_catalog` → catalog.json has 6 records with correct `building`/`occupancy`; manual `workflow_dispatch` → live site shows all 6.

## Out of scope (YAGNI)
- No automated Sheet writes (manual paste). No editing existing Fahey/Judge rows. No exhaustive every-hall list now (seed + extend). Compare view still v1.1.
