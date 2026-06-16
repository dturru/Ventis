# Run Launcher — Deploy Runbook (Task 8)

This is the manual gate before merging PR #27. All code (Tasks 1–7) is on `feat-run-launcher`.
Do these four steps in order, on a machine with the device reachable.

## 1. Apply the database migration

The launcher writes an audit row per launch. Create the table in Supabase.

- Open the Supabase project → **SQL editor** → paste and run the `run_launches` block from
  `site/scripts/supabase_schema.sql` (the last `create table if not exists run_launches (...)`
  plus its `create index`). It is idempotent — safe to re-run.
- Verify: `select * from run_launches limit 1;` returns no error (0 rows is fine).

## 2. Deploy the updated Apps Script

The launcher starts/stops the device by POSTing to the Apps Script control endpoint, and
reads device liveness from it.

- Open the Apps Script project bound to the telemetry Sheet.
- Sync the updated `firmware/sheets/Code.gs` (paste it in, or `clasp push` if configured).
- **Deploy → Manage deployments → edit the active deployment → New version → Deploy.**
  Keep the SAME `/exec` URL (no firmware reflash needed).
- Verify GET (liveness):
  `curl -s "<EXEC_URL>"` → JSON includes `lastTelemetryAt` (an ISO timestamp or null).
- Verify the token is set: in the Apps Script project, **Project Settings → Script properties**
  must contain `SHEETS_TOKEN`. If unset, set it now (any strong random string) — note the value
  for step 3.
- Verify control write (replace TOKEN + URL):
  `curl -s -X POST "<EXEC_URL>" -H 'Content-Type: application/json' -d '{"token":"<SHEETS_TOKEN>","action":"control","logging":false,"label":"test_window_1person"}'`
  → `{"ok":true,"seq":<n>}` and the Sheet's `control` tab row updates. A wrong token returns
  `{"ok":false,"error":"unauthorized"}`.

## 3. Set Cloudflare Pages environment variables

The `run-launch` Pages Function needs three secrets (Production environment of the
`ventis-data-library` Pages project → Settings → Environment variables):

| Variable | Value |
|---|---|
| `CONTROL_URL` | the Apps Script `/exec` URL from step 2 |
| `CONTROL_TOKEN` | the **same** value as the Apps Script `SHEETS_TOKEN` script property |
| `SUPABASE_DB_URL` | already set — **confirm it is the 6543 transaction-pooler URL**, not 5432 (5432 times out from Cloudflare) |

Redeploy the Pages project (or it picks the vars up on the next deploy from the merged branch).

## 4. Real-device dry run

With the device powered and online, open `/launch` (behind Cloudflare Access) and walk:

1. **Clean start** — pick building/scenario/occupancy (try a word like `two` to confirm it
   parses), fill consent, click **Start run** → status "started". Within the device poll
   interval, confirm telemetry rows appear tagged with the exact label (e.g. `fahey_window_2person`).
2. **Stop** — click **Stop run** → device stops logging.
3. **Soft-block override** — power the device off, **Start run** again → amber `device_online`
   check with its explanation; tick override + type a reason → "Override & start" succeeds and
   writes a `run_launches` row with `override_flags = {device_online}` and your reason.
4. **Defer consent** (optional, on a preview deploy) — point `SUPABASE_DB_URL` at a bad value,
   Start → amber `consent_persisted`; override → run starts with `consent_status = deferred`;
   restore the env and confirm `reconcile_consent.py` links it once consent is backfilled (same
   `canonical_label`).
5. **Reconcile parity** — `cd site/scripts && python -m pytest tests/ -q` → all pass.

## Done

When steps 1–4 pass, the launcher is live end-to-end. Merge PR #27.

> Notes: firmware is unchanged (it already polls the control tab). `.understand-anything/`
> and `dist/` stay gitignored. The control token never reaches the browser — it lives only in
> the Apps Script script property and the Cloudflare Function env.
