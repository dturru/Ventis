# Cloud connection & deploy notes

Hard-won gotchas for connecting the Ventis stack to Supabase from the cloud, and
for deploying the gated catalog. Read this before debugging a "can't reach the
database" or "my Pages change didn't show up" problem — most of them are here.

> Origin: a long 2026-06-10 debugging session. Each item below cost real time;
> they're documented so they cost zero next time.

---

## 1. Supabase pooler: use port **6543** (transaction) from the cloud, not 5432

Supabase exposes two pooler ports on the same host
(`...pooler.supabase.com`):

| Port | Pooler | Use for |
|---|---|---|
| **5432** | Session pooler | persistent / long-lived connections (a laptop, a server) |
| **6543** | Transaction pooler | **serverless / ephemeral** — GitHub Actions, Cloudflare Workers, any cloud function |

**The trap:** 5432 connects instantly from a residential/dev machine but
**silently times out from cloud datacenters** (GitHub Actions runners, Cloudflare's
edge). It connects locally, so it looks fine — then every CI run and every edge
request hangs with `connection timeout expired`. Because residential works, the
problem hides.

**Rule:** every `SUPABASE_DB_URL` consumed by a cloud/serverless process uses
**`:6543`**. That means the **GitHub Actions secret**, the **Cloudflare Pages env
var**, and `library/.dev.vars`. A laptop running the Python scripts can use
either, but standardize on 6543 to avoid confusion.

This was a latent bug: the hourly `data-library` pipeline's Supabase steps
(`supabase_sync`, `reconcile_consent`, `build_catalog`) were timing out on 5432
until the switch to 6543.

---

## 2. Cloudflare Pages env vars bind only on a **fresh deploy**

Changing an environment variable in the Pages dashboard does **not** affect the
currently-running deployment. A dashboard "retry/redeploy" may not re-read it
either. To bind a new/changed var, trigger a **fresh `wrangler pages deploy`**
(re-run the `data-library` workflow). Symptom of a stale bind: the Function
returns "not configured" (an unset var) even though you just set it.

Also: the var **name must match exactly**. The Function reads
`context.env.SUPABASE_DB_URL` — a typo in the dashboard name (e.g. `SUBAPASE_DB_URL`)
reads as undefined → "not configured."

---

## 3. The deploy must run from `library/` so Pages Functions ship

`functions/` is a Pages Functions directory. `wrangler pages deploy` only picks
it up (and `wrangler.toml`'s `nodejs_compat` + `pages_build_output_dir`) when run
from **inside `library/`**. The workflow uses `workingDirectory: library` +
`command: pages deploy`. Deploying `library/dist` from the repo root silently
omits the Functions.

---

## 4. `nodejs_compat` is required for postgres.js

`postgres` (postgres.js) uses Node APIs, so the Pages Function needs the
`nodejs_compat` compatibility flag. It's set in `library/wrangler.toml`; also set
it in the dashboard (Settings → Runtime → Compatibility flags, Production) as a
belt-and-suspenders. Without it the Function errors at runtime.

---

## 5. SPA fallback: `library/public/_redirects`

The catalog is a single-page app. Without `_redirects`, a **direct load or
refresh** of a client route (`/curate`, `/operations`, …) **404s** because Pages
looks for a matching file. `public/_redirects` with `/*  /index.html  200`
serves the app for all routes; `/api/*` is still handled by the Functions.

---

## 6. Cloudflare Workers **Free plan = 50 subrequests/invocation**

A Worker (incl. a Pages Function) on the **Free** plan can make at most **50
subrequests** per request; **Paid** allows 1000. A postgres.js connection
handshake to the pooler exceeds 50 → `Too many subrequests by single Worker
invocation`.

**Consequence:** the `/curate` annotation page's database write does **not** work
on the Free plan. It is built, deployed, and proven correct — it lights up the
day the account moves to **Workers Paid** ($5/mo). Free alternatives if needed:
Cloudflare **Hyperdrive** (also Paid), or the Supabase **REST/Data API** (1 fetch,
but that reverses the "Data API OFF = moat" decision).

**Until then:** curate annotations in the **Supabase Table Editor** (`annotations`
table) — any browser, free, moat intact. `build_catalog` reads it on the hourly
cron.

---

## Quick reference

- Cloud DB URL → **port 6543**.
- Changed a Pages env var → **redeploy** (don't trust a dashboard retry).
- New Pages Function not deploying → deploy from **`library/`**.
- Function 500 "not configured" → env var **name/typo** or **unbound** (redeploy).
- Direct URL to `/curate` 404s → check `public/_redirects`.
- "Too many subrequests" → Free-plan ceiling; use Table Editor or go Paid.
