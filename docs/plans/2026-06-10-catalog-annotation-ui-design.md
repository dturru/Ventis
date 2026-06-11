# Catalog Annotation UI — Design

**Date:** 2026-06-10
**Status:** Approved (brainstorm), pending implementation plan
**Goal:** Set run annotations (note + quality flag + tags) from any browser, behind the existing founders gate, instead of the `annotate.py` CLI on Diego's machine.

## Problem

Run annotations — the qualitative `note` + `quality_flag` (`good`/`caution`/`exclude`) + `tags` layer on top of the measured data — can currently only be set two ways:

1. `python annotate.py --set <run_key> --note … --flag …` on Diego's machine, or
2. Raw SQL / Table Editor in the Supabase dashboard.

Both require Diego specifically. Consent, by contrast, is already fully self-serve off-machine (occupant QR → `/consent` web form → `api/consent.ts` inserts to Supabase `consent_submissions` → `reconcile_consent.py` upserts to `consent` in CI). Annotations are the remaining "tacky command" gap.

This is **not** a consent problem — consent for new runs is solved. Scope is annotations only.

## Decision: annotation UI lives in the catalog

The UI and its write endpoint live in `library/` (the gated catalog on Cloudflare Pages), **not** on the Vercel marketing site.

Rationale:
- The catalog is already behind **Cloudflare Access (founders allowlist)** → zero new auth to build or secure. The marketing site is public and would need a new gate.
- Annotations are displayed in the catalog; the editor belongs on the same surface.
- `build_catalog` already reads the `annotations` table — the read side is done.

## Architecture

```
library/  (Cloudflare Pages, Access-gated)
  src/pages/Curate.tsx        founder UI — run worklist + flag/note/tags form
  functions/api/annotate.ts   Pages Function — upsert into Supabase `annotations`
```

**Flow:** Founder opens `…pages.dev/curate` (behind Access) → picks a run → sets flag + note + tags → `POST /api/annotate` → upsert into Supabase `annotations` → `build_catalog` reads it on the next hourly cron → flag appears in the catalog. Same instant-write / shows-next-build cadence as consent.

**Auth = the existing Access gate.** Cloudflare Access blocks every non-founder at the edge before the function runs. The function reads the `Cf-Access-Authenticated-User-Email` request header and stamps `updated_by` automatically (no manual `--by`).

## Key technical constraint (why this is not a copy of consent.ts)

`api/consent.ts` runs on **Vercel/Node** with the `pg` driver. Cloudflare Pages Functions run on the **Workers runtime**, where:

- `pg` (raw Node TCP) does not run, and
- the Supabase **Data API (PostgREST) is intentionally OFF** — the moat — so the REST API is not an option.

The function must therefore reach Supabase the same way the Python scripts do: a **direct Postgres connection to the Session-pooler**, but from the Workers runtime. Plan: **`postgres.js` (postgres v3) over Cloudflare's socket API**, running the identical `insert … on conflict (run_key) do update` that `annotate.py::_upsert_pg` performs. The moat is preserved (direct DB connection, not REST); only the driver differs from `pg`.

**Risk / first step:** verify a `postgres.js`-on-Workers connection to the Supabase Session-pooler with a tiny spike before building the page on top of it. Fallback if flaky: host the endpoint on Vercel and forward the Cloudflare Access JWT for verification. Not expected to be needed.

## Page UX

- The catalog already ships the run list (run_key, condition, existing flag/note/tags) as static build data — the Curate page reads that. **No new read endpoint.**
- Runs shown as a worklist with **unannotated runs surfaced first**; re-editing a run pre-fills existing values.
- Success state: "Saved — appears in the catalog within the hour."
- Client + server validation mirrors `_validate.ts`: `run_key` must exist; `quality_flag` ∈ {`good`, `caution`, `exclude`}; note/tags length-bounded.

## Data model

No schema change. Reuses the existing `annotations` table (`run_key`, `note`, `quality_flag`, `tags`, `updated_by`, `updated_at`) that `annotate.py` and `build_catalog` already use.

## Testing

- Unit-test the payload validator (valid/invalid flag, missing run_key, oversize fields), mirroring `_validate.test.ts`.
- Unit-test the upsert SQL shape / parameter binding, mirroring `test_consent_ledger`.
- Manual: set a flag via `/curate`, confirm the row in Supabase, confirm it renders after a `build_catalog` run.

## Out of scope

- **New-run consent** — already self-serve (QR → form → CI).
- **6 legacy PENDING consent rows** — a separate one-time browser cleanup via Supabase Table Editor straight into the `consent` table (they predate the web form and have no deployment code to reconcile). Steps handed off separately.
- **In-catalog editing of anything other than annotations.**

## Compatibility

`annotate.py` stays as-is — the CLI and the web UI write to the same table via the same upsert semantics, so they coexist. Nothing about the existing CLI / CI path changes.

## Deployment notes (one-time, Diego)

Code is built, unit-tested, and committed on `Ventis/feat-annotation-ui`. The remaining steps need the Supabase secret + dashboard access, so they're Diego's:

1. **Local end-to-end (verifies the postgres.js-on-Workers path):**
   - Paste the Session-pooler URI into `library/.dev.vars` (gitignored) — replace the `__PASTE_SESSION_POOLER_URI_HERE__` placeholder.
   - `cd library && npm run build && npx wrangler pages dev dist`
   - Open `/curate`, set a flag on a real run, Save → expect "Saved…". Confirm the row in Supabase Table Editor → `annotations`.
   - (Optional) `python site/scripts/build_catalog.py` then check the flag appears in `library/public/data/catalog.json`. Revert the test flag after.
2. **Cloudflare Pages → ventis-data-library → Settings → Environment variables:** add `SUPABASE_DB_URL` (Session-pooler URI) for Production **and** Preview.
3. **Settings → Functions → Compatibility flags:** add `nodejs_compat` for Production and Preview (also set in `library/wrangler.toml`; the dashboard setting is belt-and-suspenders).
4. **Cloudflare Access:** confirm the Founders access application covers the whole `ventis-data-library.pages.dev` host (default), so `/api/annotate` is gated — hit `/api/annotate` from a non-allowlisted browser and expect the Access wall, not a 200.
5. **Verify in production:** after deploy, open `/curate`, set a flag, confirm the Supabase row, confirm it renders after the hourly build.
