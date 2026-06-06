# START HERE — Ventis Data Library (cold-start kickoff)

**You are starting fresh. This note orients you in ~60 seconds, then you execute the plan.**

## What this is
Build a private, auto-updating web **catalog** of every Ventis logging run (sort/filter a table → run detail with SOP chart + stats + notes). Approach A: a cron GitHub Action runs the existing data pipeline → `build_catalog.py` → a static React/Vite app → a gated host. Built B-ready (graduates to Supabase/Postgres later).

## Read these first (in order)
1. **Design (the "why"):** `docs/plans/2026-06-05-ventis-data-library-design.md`
2. **Implementation plan (the "how", task-by-task):** `docs/plans/2026-06-05-ventis-data-library.md`
3. Vault context (optional): `Projects/Ventis/Data/Data Library — Design.md`, `Data Storage — run_id + Archival + Scaling Spec.md`.

## How to execute
- **Branch:** `feat-data-library` (already checked out / `git checkout feat-data-library`).
- **Use the `superpowers:executing-plans` skill** to work the plan task-by-task (TDD, commit per task).
- Repo root: `C:\Users\turru\Projects\ventis`. Python: `python` on PATH; pio not needed. Node: `npm`.

## State of the world (already true — do NOT redo)
- ✅ The data pipeline exists and works: `site/scripts/sheet_source.py`, `sqlite_sync.py`, `archive_runs.py`, `refresh_backup.py`; canonical plotter `plot_ventis_run.py`.
- ✅ `site/scripts/archive/ventis.db` exists (2 runs currently) — Phase 1's smoke test (Task 4) will work immediately.
- ✅ `requirements.txt` has gspread, google-auth, pandas, matplotlib.
- ✅ `archive/` is gitignored (moat). The library build output `library/public/data/` must ALSO be gitignored (plan Task 4).
- ❌ `library/` does NOT exist yet — plan Task 5 scaffolds it.
- ❌ `build_catalog.py` does NOT exist yet — plan Phase 1 creates it (TDD).

## Execute Phases 1–2 now; Phases 3–4 need Diego
- **Phases 1–2 (builder + frontend)** can be done end-to-end now → yields a working local catalog (`cd library && npm run dev`).
- **Phase 3 (hosting/CI) + Phase 4 (gate proof) need Diego's manual setup** — pause and ask him for:
  - Cloudflare Pages project `ventis-data-library` + an **Access** policy (email allowlist: Diego + cofounder).
  - Repo **secrets**: `VENTIS_SA_JSON` (service-account key contents), `VENTIS_SHEET_ID`, `CF_API_TOKEN`, `CF_ACCOUNT_ID`.
  - 🔴 **Never deploy the site ungated** — the host gate is the moat boundary. Phase 4 must PROVE an anonymous request is blocked before the cron stays on.

## Definition of done (v1)
Authenticated users see a sortable/filterable run table; each run's detail shows its SOP chart + stats; the cron refresh works; an anonymous request is provably blocked; no moat artifact (`*.db`, `catalog.json`, `*.png`) is committed.
