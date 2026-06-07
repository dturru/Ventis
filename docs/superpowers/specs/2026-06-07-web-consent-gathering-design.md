# Web Consent Gathering (v1) — Design Spec

**Date:** 2026-06-07
**Status:** Approved (brainstorming) → ready for implementation plan
**Branch:** `feat-consent-web`

## 1. Context & goal

Consent is currently recorded by hand by a founder via `consent_ledger.py --set`, which
writes to the Supabase `consent` table (graduated 2026-06-07, merged `09d7b6a`). That does
not scale to field collection and produces no occupant-attested artifact.

This feature adds a **web form** that captures **verifiable, de-identified opt-in consent**
and writes it into Supabase, so:

- consent collection scales beyond the manual CLI as the cofounder deploys loggers,
- the catalog reflects real `verified` consent status (it already reads the `consent` table),
- the dataset gains an occupant-attested provenance record (strengthens the ethics/diligence moat).

Unlocked by the move to Supabase (the web layer can now **write**, not just read static JSON).

## 2. Scope

**In scope (v1)**
- A consent form (new route in the public `site/` app).
- Two attestation modes: occupant self-serve and cofounder-assisted.
- Deployment-code linkage tying a submission to a run.
- A moat-safe server-side write path (Vercel serverless function).
- A `consent_submissions` table (raw intake) + a reconcile step that upserts matched
  submissions into the existing `consent` table.

**Out of scope (deferred)**
- Auth / logins / Supabase Auth (council-deferred until an institutional partner asks).
- Multi-tenant / per-user catalog.
- Re-enabling the public Data API.
- Exact `deploy_code`-on-run join via firmware/Code.gs (v1 uses a soft join; see §5).
- Editing/withdrawing consent through the web (withdrawal handled out-of-band for v1).

## 3. Architecture overview

```
Occupant phone / cofounder phone
        │  GET /consent?code=VEN-4827   (form, served by site/ on Vercel)
        │  POST {code, condition, method, attested_by, terms_version, notes}
        ▼
Vercel Serverless Function  site/api/consent
        │  validates payload, holds SUPABASE_DB_URL (Vercel env var)
        │  INSERT into consent_submissions   (Data API stays OFF)
        ▼
Supabase Postgres
   consent_submissions (raw intake, deployment-code keyed)
        │
        │  reconcile step (CI pipeline / scheduled): match submission → run
        ▼
   consent (existing, run_key keyed)  ← build_catalog reads this UNCHANGED
        ▼
   catalog.json consent_status = verified
```

Key property: **`build_catalog` is not modified.** It continues to read the `consent`
table by `run_key`; the reconcile step is what newly populates it from web opt-ins.

## 4. User flows

**Occupant self-serve**
1. Cofounder places a logger, has a deployment code `VEN-4827` (printed/QR).
2. Occupant scans the QR → `/consent?code=VEN-4827`.
3. Reads plain-language terms (what's collected, anonymized, opt-out-able).
4. Taps "I agree." → submission recorded `consent_method=opt_in_form`, `attested_by=occupant`.
5. Success state confirms; no account, no PII collected.

**Cofounder-assisted**
1. Cofounder opens `/consent?code=VEN-4827` on his own phone.
2. Confirms the occupant verbally agreed after being informed.
3. Submits → `consent_method=opt_in_verbal`, `attested_by=<founder pseudonym>`.

Both modes use the same form and endpoint; the difference is the `method`/`attested_by`
fields and a mode toggle on the form.

## 5. Deployment code & run linkage

- The **deployment code** (format `VEN-####`, human-readable) is generated/chosen by the
  cofounder at placement. It is the occupant-facing token (QR + form), never an identity.
- It is stored on every `consent_submissions` row.
- **v1 run linkage = soft join on `condition` + nearest start time.** The cofounder uses the
  **same condition label** for the deployment and the run (set in the Sheet `control` tab as
  today), so the reconcile step matches a submission to the run whose `condition` matches and
  whose `start_ts` is closest to the submission's `agreed_at` (within a tolerance window, e.g.
  ±36 h). Chosen because Diego is remote this summer (no firmware/Sheet schema change, no
  Apps Script redeploy, no reflash).
- **Hardening (deferred):** add a `deploy_code` field to the telemetry rows via a Code.gs
  control-tab column so runs carry the code for an exact join. Not needed at current volume.

## 6. Data model (Supabase)

New table (DDL run once in the SQL editor, added to `supabase_schema.sql`):

```sql
create table if not exists consent_submissions (
  id              bigint generated always as identity primary key,
  deployment_code text not null,
  condition       text,                  -- the run's condition label (for the soft join)
  consent_method  text not null,         -- opt_in_form (self) | opt_in_verbal (assisted)
  attested_by     text,                  -- 'occupant' or a founder pseudonym; never a name
  terms_version   text,
  agreed_at       timestamptz default now(),
  notes           text,
  reconciled_run_key text                 -- set by the reconcile step once matched (audit)
);
create index if not exists idx_consent_sub_code on consent_submissions(deployment_code);
```

Relationship to the existing `consent` table (unchanged schema): the **reconcile step**
reads unreconciled submissions, finds the matching run, and `upsert`s a row into `consent`
keyed by `run_key` (mapping submission → `run_id`, `consent_method`, `consent_date` =
`agreed_at::date`, `recorded_by` = `attested_by`, `notes`), then stamps
`consent_submissions.reconciled_run_key` so it is not re-processed.

`is_verified()` already treats `opt_in_form` / `opt_in_verbal` as valid → catalog flips to
`verified` automatically on the next catalog build.

## 7. Write path — Vercel serverless function

- New file `site/api/consent.ts` (Vercel function; the site already deploys on Vercel).
  Node/TypeScript runtime, so it uses a **Node Postgres client (`pg`)**, not psycopg
  (psycopg is Python and only used by the CI scripts).
- Reads `SUPABASE_DB_URL` from a **Vercel environment variable** (server-side only). Use the
  **Session-pooler** URL (pgBouncer) — serverless functions open many short-lived
  connections, which the pooler is built for.
- Accepts `POST` JSON: `{ code, condition, method, attested_by, terms_version, notes }`.
- Validates: `code` present and matches `^VEN-\w{3,8}$`; `method` ∈ {opt_in_form,
  opt_in_verbal}; rejects anything with obvious PII patterns in `notes` (best-effort) and
  caps field lengths. Basic rate limiting / honeypot field to deter abuse.
- Inserts one row into `consent_submissions`. Returns `{ ok: true }` or a 4xx with a safe
  message. No DB error detail leaked to the client.
- **Data API remains OFF**; the DB credential never reaches the browser.

*(Alternative considered and rejected for v1: re-enable the Supabase Data API with an
insert-only RLS policy + anon key. Rejected to avoid re-opening the API surface we closed.)*

## 8. The form (public `site/`)

- New route `/consent` reading `?code=` from the query string (route added to `App.tsx`;
  page `pages/Consent.tsx`).
- Built to `DESIGN.md`: Outfit/serif type, green palette, **no em-dashes**, no emoji icons,
  reduced-motion respected, AA contrast, **mobile-first** (it is scanned on a phone).
- Content: short plain-language terms — what is collected (CO₂, temperature, humidity),
  that **no identity/room is stored**, that it is anonymized, that they can opt out by
  contacting `CONTACT_EMAIL`. A mode toggle (occupant vs cofounder-assisted). Agree button.
- States: missing/invalid code, submitting, success, error. Dodi carries the warmth.
- If `code` is absent or malformed, the form explains it needs a valid deployment link.

## 9. Reconcile step

- New script `site/scripts/reconcile_consent.py` (reuses the Supabase connection pattern).
- Logic: for each `consent_submissions` row with null `reconciled_run_key`, find the run in
  `runs` with matching `condition` and `start_ts` nearest `agreed_at` within tolerance;
  if found, upsert into `consent` (run_key keyed) and stamp `reconciled_run_key`.
- Idempotent. Runs in CI in the data-library workflow, **after `supabase_sync`** (runs exist)
  and **before `build_catalog`** (so the catalog reflects newly-reconciled consent).
- If no run matches yet (consent arrived before the run was synced), it is left unreconciled
  and retried next run — non-fatal.

## 10. Cofounder SOP update

Add one step to the Logger Deployment SOP (vault + catalog Operations page): "Generate a
deployment code, use it as the run's condition label, and capture consent — show the QR for
occupant self-serve, or assist the opt-in on your phone."

## 11. Security / moat

- Data API stays OFF; only the Vercel function (server-side cred) can write.
- `consent_submissions` accepts only the consent fields; no identity captured by design.
- Validation + length caps + honeypot on the public endpoint; RLS on the table as defense
  in depth (insert path is the function using the postgres role, not anon).
- The deployment code is not a secret and carries no PII; it only links a submission to a run.

## 12. Testing

- Reconcile: unit tests for the match logic (exact condition+time match, tolerance boundary,
  no-match left unreconciled, idempotent re-run) with fixture rows — mirrors the existing
  pytest style; PG calls behind mockable helpers.
- Vercel function: validation unit tests (good payload, bad code, bad method, oversized
  fields, honeypot tripped).
- Form: `npm run build` (tsc) passes; render-verified at `/consent` desktop + ≤640px; the
  `DESIGN.md` pre-ship checklist (em-dash grep, contrast, focus, reduced-motion).
- End-to-end: a real submission via the deployed function lands in `consent_submissions`,
  reconcile links it to a run, next `build_catalog` shows `verified` (verified on branch CI
  the way the Supabase work was).

## 13. Open items (none blocking)

- Terms copy: draft to be reviewed against `DESIGN.md` voice before ship (no legal review at
  v1; plain-language opt-in only).
- Deployment-code generation: cofounder picks/format-validates manually in v1 (no generator
  UI yet); a small generator can come later if useful.
