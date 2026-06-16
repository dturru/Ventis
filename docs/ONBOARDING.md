# Ventis — Onboarding Guide

> Auto-generated from the project knowledge graph (`/understand`), commit `2e7051dc`, 2026-06-16.
> 342 nodes · 493 edges · 8 architecture layers · 14-step guided tour.

## 1. Project Overview

**Ventis** is a smart window-ventilation device for dorm rooms. An **ESP32** reads CO₂, temperature, and humidity from an **SCD40** sensor, runs a ventilation control loop, and serves a phone-facing dashboard over its **own WiFi access point** — showing live air quality, trends, and a first-person AI mascot (**"Dodi"**) that explains what the device is doing.

The device *is* the product. Everything else in this monorepo exists to **support, prove, or analyze** what the firmware does.

- **Core languages:** C++ (firmware), TypeScript/React (3 web apps), Python (data pipeline), SQL (Supabase schema), plus Apps Script, HTML/CSS, YAML.
- **Frameworks/tooling:** React · Vite · Vitest · Arduino · PlatformIO · Recharts · Cloudflare Pages · Wrangler · Vercel · GitHub Actions.
- **Repo shape:** ESP32/PlatformIO firmware + outdoor sensor node + three React+Vite+TS web apps (public site, gated data library, on-device dashboard) + a Python ETL pipeline feeding a Supabase system-of-record.

> ⚠️ 189 source files — when running incremental analysis or focused work, scope to a subdirectory.

## 2. Architecture Layers

The repo has **no common source prefix** — top-level directories are the module seams, and each is largely self-contained (intra-module imports only). The 8 layers:

| Layer | Dir(s) | What it is |
|-------|--------|-----------|
| **Embedded Firmware** | `firmware/`, `outdoor-node/` | ESP32/ESP32-C3 Arduino firmware: sensor reads, control loop, LittleFS-served UI, Apps Script telemetry bridge. |
| **On-Device Dashboard App** | `app/` | React/Vite phone dashboard served by the device over its WiFi AP. Compiles down to the firmware's LittleFS bundle. |
| **Marketing & Proof Site** | `site/src`, `site/api`, `site/functions` | Public React site telling the Ventis story to institutional contacts + beta students; serverless consent capture. |
| **Gated Data Library** | `library/` | Gated React app (Cloudflare Access) to browse/compare/export collected run datasets. |
| **Data Pipeline & Schema** | `site/scripts/`, root `*.py` | Python ETL (Sheet → Supabase → catalog) + the Supabase SQL schema = the data moat. |
| **Infrastructure & CI/CD** | `.github/workflows`, root config | GitHub Actions jobs that run the whole data path hourly; Cloudflare/Wrangler deploy config. |
| **Documentation** | `docs/`, READMEs | Design docs, phased implementation plans, specs, marketing artifacts. |
| **CAD & Dev Tooling** | `cad/`, `dev/` | Fusion 360 enclosure scripts + the local dev harness that mocks the device so UI work needs no hardware. |

## 3. Key Concepts & Design Decisions

- **The device is self-contained.** The firmware serves its own dashboard from LittleFS so a phone connects directly to the device's AP with **no internet**. The React `app/` is authored separately and *compiled down* into the firmware's embedded `data/` bundle.
- **One dashboard, two homes.** `dev/index.html` is a standalone browser copy of the firmware's embedded UI. **They must stay in sync** — the dev harness mirrors `INDEX_HTML` in `firmware/src/main.cpp`. This is a recurring footgun; see `dev/README.md`.
- **Data flows strictly outward:** device → Apps Script → locked Google Sheet → Python ETL → Supabase (system-of-record) → catalog.json → gated library. The public site only *writes back* consent.
- **The dataset is the moat.** Supabase is the durable system-of-record; consent is enforced at the schema level (`consent` / `consent_submissions`) so every logging run is auditable and opt-in.
- **Types-first UI.** `app/src/types.ts` and `library/src/lib/catalog.ts` are the highest-fan-in modules in their apps — read them first to learn the vocabulary the rest of the code speaks.
- **Dodi is a first-class feature**, not decoration — the mascot's mood/pose states are wired through the live view to explain air quality in plain language.

## 4. Guided Tour (recommended reading order)

Follow the firmware outward — the data flow is the spine of the project.

1. **Project Overview** — `README.md`. The mental model: device-as-product, dashboard over its own AP.
2. **Firmware Entry Point** — `firmware/src/main.cpp`. The heart: SCD40 reads, control loop, web server, embedded dashboard. High fan-in.
3. **Hardware Config & Build** — `firmware/include/config.h` (pins + thresholds), `firmware/platformio.ini` (real ESP32 over COM6 + Wokwi sim env, pinned sensor libs).
4. **The Embedded Dashboard** — `firmware/data/index.html`. The built UI baked into LittleFS; what the user actually sees.
5. **Dashboard Source: Shell & Types** — `app/src/App.tsx` (hooks + bottom-nav + Dodi across Live/Trends/Controls), `app/src/types.ts` (most-depended-upon module).
6. **API & Hooks** — `app/src/api.ts` (live data/history/insight + mock fallback), `useSensorData`, `useTier`. The bridge between control loop and UI.
7. **Live View & Dodi** — `app/src/views/LiveView.tsx` (highest fan-out), `app/src/components/DodiMascot.tsx`.
8. **The Dev Harness** — `dev/serve.py` (mocks `/data`, `/history`, `/insight`), `dev/README.md`. Where day-to-day UI work happens.
9. **Telemetry Bridge** — `firmware/sheets/Code.gs` (device POSTs → locked Sheet), `docs/ventis-sheet-guide.md`.
10. **The Data Pipeline (ETL)** — `site/scripts/sheet_source.py` → `supabase_sync.py` → `build_catalog.py`.
11. **The Database Schema** — `site/scripts/supabase_schema.sql`: `readings`, `runs`, `consent`/`consent_submissions`.
12. **The Gated Data Library** — `library/src/App.tsx`, `library/src/lib/catalog.ts` (repo's single highest-fan-in module), `RunTable.tsx`.
13. **The Marketing & Proof Site** — `site/src/App.tsx`, `site/src/pages/Proof.tsx`, `site/api/consent.ts`.
14. **CI/CD Capstone** — `.github/workflows/data-library.yml`: hourly pull → sync → reconcile consent → rebuild catalog → deploy library.

## 5. File Map (key files by layer)

**Embedded Firmware**
- `firmware/src/main.cpp` — primary firmware: sensors, fan control, Sheets telemetry, web UI, control polling.
- `firmware/src/main_sim.cpp` — sim build driving synthetic readings through the same control/web paths.
- `firmware/sheets/Code.gs` — Apps Script web-app receiving device POSTs into the locked Sheet.
- `firmware/data/index.html` + `data/assets/*` — built React UI served from LittleFS.
- `outdoor-node/src/main.cpp` — battery outdoor temp node (wake → read DS18B20 → report → sleep).

**On-Device Dashboard App** (`app/`)
- `App.tsx` (complex) — shell wiring hooks, routing, mascot.
- `types.ts` — shared sensor/history/control payload shapes (highest fan-in).
- `api.ts` + `hooks/useSensorData.ts` + `hooks/useTier.ts` — device API bridge.
- `views/LiveView.tsx`, `TrendsView.tsx`, `ControlsView.tsx` — the three screens.
- `components/DodiMascot.tsx`, `DormPicker.tsx`, `TourOverlay.tsx` — mascot + UI.

**Marketing & Proof Site** (`site/`)
- `src/App.tsx` — route table; `src/pages/Proof.tsx` — flagship CO₂ run + chart.
- `api/consent.ts` — serverless consent capture (feeds `consent_submissions`).
- `src/components/DeviceDemo.tsx` (complex) — interactive recorded-run playback.
- `DESIGN.md` — brand/voice/motion design canon.

**Gated Data Library** (`library/`)
- `src/lib/catalog.ts` — core data layer; load/filter/search/sort (repo-wide highest fan-in).
- `src/components/RunTable.tsx`, `ComparePage.tsx`, `CoveragePage.tsx`, `CuratePage.tsx` — the pages.
- `src/lib/coverage.ts` — occupancy/building coverage analytics + collection priorities.
- `functions/api/annotate.ts` — Cloudflare Pages function for run annotations.

**Data Pipeline & Schema** (`site/scripts/`)
- `build_catalog.py` (complex) — fetch runs (Supabase/SQLite), parse condition labels, merge consent → `catalog.json`.
- `extract_runs.py` / `archive_runs.py` — ingest + bucketize raw readings into runs.
- `annotate.py`, `reconcile_consent.py`, `supabase_sync.py`, `sheet_source.py` — the ETL + governance tools.
- `supabase_schema.sql` — the system-of-record schema.
- `tests/test_build_catalog.py` — label-parse + catalog emission tests.

**Infrastructure & CI/CD**
- `.github/workflows/data-library.yml` — the hourly pipeline (pull → sync → reconcile → catalog → deploy).

**CAD & Dev Tooling**
- `dev/serve.py`, `dev/index.html`, `dev/generate_mocks.py` — the no-hardware UI dev loop.
- `cad/split_enclosure.py` — Fusion 360 enclosure split for printing.

## 6. Complexity Hotspots — approach carefully

| File | Why |
|------|-----|
| `firmware/src/main.cpp` | Does everything on-device (sensors + control + telemetry + web server). Central; changes ripple. |
| `app/src/App.tsx` & `views/LiveView.tsx` | Highest fan-in/fan-out in the dashboard; the composition hub. |
| `app/src/components/DodiMascot.tsx` | Stateful animated SVG with mood/pose logic used everywhere. |
| `library/src/lib/catalog.ts` & `coverage.ts` | The library's data + analytics core; every page depends on it. |
| `library/src/components/RunTable.tsx` / `CoveragePage.tsx` | Heavy filtering/sorting/visualization. |
| `site/scripts/build_catalog.py` | Label parsing + multi-source merge + consent join; the ETL keystone (well-tested — lean on the tests). |
| `site/src/components/DeviceDemo.tsx` | Time-driven animation state machine. |
| `dev/index.html` ↔ `firmware/src/main.cpp` `INDEX_HTML` | Must stay in sync by hand — easy to drift. |

## 7. Getting Started

- **UI work?** Start in `dev/` — `python dev/serve.py` mocks the device endpoints so you never need to flash hardware. Keep `dev/index.html` in sync with the firmware's embedded UI.
- **Firmware?** PlatformIO; two envs in `firmware/platformio.ini` (real ESP32 over COM6, Wokwi sim). Copy `include/secrets.h.example` → `secrets.h` (never commit it).
- **Data/pipeline?** `site/scripts/` Python; run the tests first to understand label parsing. Supabase is the source of record.
- **Explore interactively:** run `/understand-dashboard` to open the graph visualizer.
