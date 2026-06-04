# Ventis — Landing Site

Public marketing + data site for Ventis. React + Vite + TypeScript + React Router,
Recharts for the data charts. Built from `docs/superpowers/specs/2026-06-03-ventis-landing-site-design.md` (v1, ship-fast).

Lives in `site/` alongside the device dashboard in `app/`. Reuses the dashboard's
design tokens and the Dodi sprite.

## Develop

```bash
cd site
npm install
npm run dev      # http://localhost:5173
```

## Build

```bash
npm run build    # tsc type-check + vite build -> dist/
npm run preview  # serve the production build locally
```

## The data

`/data` renders four real measured overnight runs. The chart series live in
`src/data/runs.json`, generated from the source CSVs by:

```bash
npm run extract-data   # python scripts/extract_runs.py
```

Sources (real measured data — never fabricate values):
- **Fahey** (hero, window experiment) — `Ventis.v1 Logger - telemetry.csv`
- **East Wheelock** (negative control) — `Ventis.v1 Logger - 1RDouble - EW.csv`
- **Choates/Little** + **2-person apt** — vault `…/Ventis/Data/ventis_data.csv`

Lines are 5-minute averages; `peakLabel` carries the documented absolute single-sample peak.

## Config — swap before/after launch

Edit `src/site.config.ts`:
- `BETA_FORM_URL` — the live "Ventis — Early Access" Google Form URL (Residents CTA).
- `CONTACT_EMAIL` — Diego's Dartmouth email (mailto fallback + footer).
- `WEB3FORMS_KEY` — free access key for the `/contact` form. Empty for now → the
  form falls back to composing a pre-filled email in the visitor's mail app. To get
  real async delivery (submissions land in your inbox, no mail-client popup):
  grab a free key at https://web3forms.com (enter your email → they email you a key),
  paste it here, rebuild. No account/backend needed.

The Institutions CTA points to the `/contact` page (name / email / message form),
not a raw mailto.

## Deploy (Vercel)

1. Import the Ventis repo in Vercel.
2. **Set Root Directory = `site`.**
3. Framework preset: Vite. Build `npm run build`, output `dist`.
4. `vercel.json` already handles SPA route rewrites (so `/data` etc. deep-link).

Free subdomain (e.g. `ventis.vercel.app`) now; custom domain is a later 10-min add.

## Roadmap (not in v1)

- `/demo` is a placeholder. Phase 2 = embed the `app/` dashboard on a canned replay.
- Live "hosted dashboard": add `fetchLiveRun()` in `src/data/runs.ts` reading a
  Sheets-backed JSON endpoint. The page/chart don't change — only the data source.
