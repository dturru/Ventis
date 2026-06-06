# Ventis Data Library — Design (v1)

**Date:** 2026-06-05
**Status:** Approved design (pre-implementation)
**Author:** Diego + Claude (brainstorm)

## Problem / vision
A continuously-updating, professional "data library" where every Ventis logging run is easy to sort through and view (data + SOP charts). It is the moat-dataset made browsable — and a credibility asset for the upcoming Dartmouth/College engagement. Must be private, reachable by both founders (Diego remote, cofounder on campus), and auto-populating.

## Decisions (from brainstorm)
| Question | Decision |
|---|---|
| Audience / access | **Internal, both founders, hosted + private** (login-gated) |
| Core capability | **Catalog & browse** — sortable/filterable run table → run detail |
| Data flow | **Automatic / scheduled** refresh |
| Direction | **Approach A (scheduled static + gated host), built B-ready** — graduate to Supabase/Postgres (Approach B) when the relationship justifies per-user logins / scale |
| Feature scope | Read-only features fit A; write/auth features → B (see Scope) |

### Why A-now / B-later
For a *first* College meeting you show data, not logins — a polished gated catalog (A) is sufficient and identical in the room. B's real value (per-user College access, governance, multi-building scale) lands at the *pilot* phase. A doesn't waste work: the pipeline, schema, SQLite (Postgres-shaped), and charts all port into B; only A's static frontend is replaced. A keeps the moat key **ephemeral** (CI-only) vs B's always-on key-holder.

## Architecture
```
ESP32 → Apps Script → Google Sheet (telemetry, ingest buffer)
                          │  read-only service-account key (CI secret, ephemeral)
        GitHub Action (cron, ~hourly)   ← the "scheduled backend", ephemeral
                          │
   sheet_source → sqlite_sync (ventis.db) → archive_runs (per-run CSV + manifest)
       → plot_ventis_run (SOP charts) → build_catalog.py
                          │  (catalog.json + per-run series JSON + chart PNGs)
        build static React/Vite catalog app → deploy
                          │
        Private host (Cloudflare Pages + Access, or Vercel Auth) — gate = both founders
                          │
   log in → sort/filter run table → click run → SOP chart + stats + context + notes
```
Nothing always-on holds the key; the deployed artifact is a static app + JSON + PNGs behind an edge access-gate.

## Components
1. **Pipeline (exists):** `sheet_source` → `sqlite_sync` → `archive_runs` → `plot_ventis_run` → `refresh_backup`. The Action invokes these.
2. **`build_catalog.py` (new):** reads `ventis.db` → emits:
   - `catalog.json` — one record per run (the B-ready contract, below).
   - `series/<run_id>.json` — **downsampled** per-run time-series (CO₂/temp/RH). Emitted in v1 so the **comparison** view (v1.1) is data-ready with no rework.
   - copies chart PNGs into the app's asset dir.
3. **Catalog frontend (new):** React/Vite app reusing existing site design tokens for a consistent professional look. Views:
   - **Run table** — sortable/filterable: building, condition, occupancy, window_state, date, duration, n_rows, co2_mean, co2_peak, ASHRAE-exceed, consent, run_id. Text search.
   - **Run detail** — SOP chart, full stats, context (window/door/occupancy/placement), analysis-note text.
4. **GitHub Action (new):** cron (~hourly) → run pipeline + `build_catalog.py` → deploy. SA key + deploy token = encrypted CI secrets.
5. **Host + auth:** Cloudflare Pages + Cloudflare Access (email allowlist for the two founders), or Vercel Authentication. Free tier.

## B-ready data contract (`catalog.json` record)
```
run_id, run_key, device_id, building, condition, occupancy, window_state,
date, start, end, duration_h, n_rows, co2_mean, co2_peak, ashrae_exceed,
consent, chart, csv, series, notes
```
This maps **1:1 to the future Postgres `runs` table**. `building` / `occupancy` parse from the `building_condition_occupancy` label (guaranteed by run_id + the structured-label rule). At graduation, the same frontend swaps its source from `catalog.json` → Supabase; schema + UI are unchanged.

## Security (moat-critical)
- Read-only SA key = encrypted **CI secret**, present only during the ~30s Action run.
- The deployed site **contains the dataset** (charts + catalog.json) → the **host access-gate is the privacy boundary.** Cloudflare Access / Vercel Auth gate at the edge *before any asset loads*.
- **Hard rule: never deploy ungated, not even once.** Verify the gate blocks anonymous requests before the first real deploy.
- Read-only catalog, no write/upload path → no injection surface.
- Moat data (db, CSVs, JSON, PNGs) are CI build artifacts, **never committed** (`library/` build output gitignored).

## Scope
**In (A v1):** catalog table + filter/sort + run detail; auto-refresh cron; private gate. `build_catalog.py` also emits per-run series JSON so comparison is data-ready.
**A v1.1 (first enhancement):** comparison / overlay view (read-only, client-side — architecturally free in A; the self-serve pitch-chart builder).
**Deferred to B (graduation):** annotations (needs persistent writes + auth), upload UI (needs writes; ingestion is already automatic), optional in-UI ad hoc query (CLI `sqlite_sync.py --sql` already covers this).

**Principle:** read-only features fit A (static); write/auth/state features require B. Bolting a write-backend onto A = half-building B → just graduate instead.

## Verification
- `build_catalog.py`: valid `catalog.json` shape; every referenced chart + series file exists; building/occupancy parsed correctly from labels.
- Frontend: renders from a sample `catalog.json`; filter/sort works; run detail loads chart + series.
- **Gate:** an unauthenticated request is blocked (test before first real deploy).
- Action: dry-runs clean on a branch before enabling the cron.

## Graduation path to B (Supabase)
Trigger: College wants a pilot / per-user logins / multi-building. Steps: stand up Supabase; load `ventis.db` → Postgres `runs` table (= `catalog.json` schema); point the same frontend at Supabase with auth + row-level security; issue read-only College accounts; add annotations + upload + optional UI query. Frontend + schema already match → low-friction.

## Open questions (resolve at planning)
- Host: Cloudflare Pages+Access vs Vercel Authentication (both free; pick on auth UX).
- Cron cadence (hourly vs a few times/day) — runs aren't real-time.
- Reuse existing `app/`/`site/` design tokens vs a fresh minimal theme.
