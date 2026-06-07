# Web Consent Gathering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A web form that records verifiable, de-identified opt-in consent into Supabase, reconciled to runs and surfaced as `verified` in the catalog.

**Architecture:** Public form (`site/`) → Vercel serverless function (server-side DB credential, Data API stays off) → `consent_submissions` table → Python reconcile step (condition + nearest-start-time match) upserts into the existing `consent` table → `build_catalog` (unchanged) shows `verified`.

**Tech Stack:** React/Vite (site), Vercel serverless function (Node + `pg`), Supabase Postgres, Python reconcile (psycopg, pytest), vitest for the TS validator.

**Spec:** `docs/superpowers/specs/2026-06-07-web-consent-gathering-design.md`

---

## Prerequisites (Diego — manual, one-time)

These are not code tasks; the implementer cannot do them. Note them and verify before Task 8.

- [ ] **Create the table** in Supabase SQL Editor (Run-and-enable-RLS). DDL is in Task 1 (also added to `supabase_schema.sql`).
- [ ] **Set `SUPABASE_DB_URL`** in Vercel → Project Settings → Environment Variables → the **Session-pooler** URI (same value as the GitHub secret). Redeploy after setting.

---

## Task 1: Add the `consent_submissions` table to the schema

**Files:**
- Modify: `site/scripts/supabase_schema.sql`

- [ ] **Step 1: Append the table definition**

Add to the end of `site/scripts/supabase_schema.sql`:

```sql

-- Raw web consent intake (occupant self-serve + cofounder-assisted). Deployment-code
-- keyed; reconciled to a run (-> the consent table) by reconcile_consent.py. No PII.
create table if not exists consent_submissions (
  id                 bigint generated always as identity primary key,
  deployment_code    text not null,
  condition          text,
  consent_method     text not null,          -- opt_in_form | opt_in_verbal
  attested_by        text,                    -- 'occupant' or founder pseudonym; never a name
  terms_version      text,
  agreed_at          timestamptz default now(),
  notes              text,
  reconciled_run_key text                     -- set once matched to a run (audit)
);
create index if not exists idx_consent_sub_code on consent_submissions(deployment_code);
```

- [ ] **Step 2: Commit**

```bash
git add site/scripts/supabase_schema.sql
git commit -m "feat(consent): consent_submissions table in schema"
```

---

## Task 2: Reconcile match logic (pure functions, TDD)

**Files:**
- Create: `site/scripts/reconcile_consent.py`
- Test: `site/scripts/tests/test_reconcile_consent.py`

- [ ] **Step 1: Write the failing tests**

`site/scripts/tests/test_reconcile_consent.py`:

```python
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from reconcile_consent import match_run, plan_reconcile

RUNS = [
    {"run_key": "k_fahey", "run_id": "r1", "condition": "fahey_window_1person",
     "start": "2026-06-01 21:00:00"},
    {"run_key": "k_judge", "run_id": "r2", "condition": "judge_baseline_2person",
     "start": "2026-06-04 18:25:00"},
]


def test_match_run_exact_condition_nearest_time():
    sub = {"condition": "fahey_window_1person", "agreed_at": "2026-06-01 20:30:00"}
    assert match_run(sub, RUNS)["run_key"] == "k_fahey"


def test_match_run_outside_tolerance_returns_none():
    sub = {"condition": "fahey_window_1person", "agreed_at": "2026-05-01 09:00:00"}
    assert match_run(sub, RUNS, tolerance_h=36) is None


def test_match_run_no_condition_match_returns_none():
    sub = {"condition": "nonexistent_x_1person", "agreed_at": "2026-06-01 21:00:00"}
    assert match_run(sub, RUNS) is None


def test_match_run_picks_nearest_among_same_condition():
    runs = [
        {"run_key": "a", "condition": "x_y_1person", "start": "2026-06-01 08:00:00"},
        {"run_key": "b", "condition": "x_y_1person", "start": "2026-06-03 08:00:00"},
    ]
    sub = {"condition": "x_y_1person", "agreed_at": "2026-06-03 07:30:00"}
    assert match_run(sub, runs)["run_key"] == "b"


def test_plan_reconcile_builds_upserts_and_marks():
    subs = [
        {"id": 1, "deployment_code": "VEN-1", "condition": "fahey_window_1person",
         "consent_method": "opt_in_form", "attested_by": "occupant",
         "terms_version": "v1", "agreed_at": "2026-06-01 20:30:00", "notes": "",
         "reconciled_run_key": None},
        {"id": 2, "deployment_code": "VEN-2", "condition": "no_such_condition",
         "consent_method": "opt_in_form", "agreed_at": "2026-06-01 20:30:00",
         "reconciled_run_key": None},
    ]
    upserts, marks = plan_reconcile(subs, RUNS)
    assert len(upserts) == 1
    assert upserts[0]["run_key"] == "k_fahey"
    assert upserts[0]["consent_method"] == "opt_in_form"
    assert upserts[0]["consent_date"] == "2026-06-01"
    assert upserts[0]["recorded_by"] == "occupant"
    assert marks == [(1, "k_fahey")]   # only the matched submission is marked


def test_plan_reconcile_skips_already_reconciled():
    subs = [{"id": 9, "condition": "fahey_window_1person",
             "consent_method": "opt_in_form", "agreed_at": "2026-06-01 20:30:00",
             "reconciled_run_key": "k_fahey"}]
    upserts, marks = plan_reconcile(subs, RUNS)
    assert upserts == [] and marks == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest site/scripts/tests/test_reconcile_consent.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'reconcile_consent'`

- [ ] **Step 3: Write the pure functions**

`site/scripts/reconcile_consent.py`:

```python
"""Reconcile web consent submissions to runs and upsert into the consent table.

Web opt-ins land in consent_submissions (deployment-code keyed). A run's identity
(run_key) doesn't exist at submission time, so we match a submission to its run by
CONDITION + nearest start time (the cofounder uses the same condition label for the
deployment and the run). Matched submissions are upserted into the existing `consent`
table (run_key keyed) — which build_catalog reads unchanged — and stamped reconciled.

Runs in CI after supabase_sync (runs exist) and before build_catalog. Idempotent.

Env: SUPABASE_DB_URL (Session-pooler URI). Dry-run if unset.
"""
import os
import sys
from datetime import datetime

TOLERANCE_H = 36


def _parse_ts(s):
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(str(s)[:19], fmt)
        except (ValueError, TypeError):
            pass
    return None


def match_run(submission, runs, tolerance_h=TOLERANCE_H):
    """Run whose condition matches and start is nearest agreed_at within tolerance, else None."""
    sub_t = _parse_ts(submission.get("agreed_at"))
    cond = str(submission.get("condition") or "").strip().lower()
    if sub_t is None or not cond:
        return None
    cands = [r for r in runs if str(r.get("condition") or "").strip().lower() == cond]

    def dist(r):
        rt = _parse_ts(r.get("start"))
        return abs((rt - sub_t).total_seconds()) if rt else float("inf")

    if not cands:
        return None
    best = min(cands, key=dist)
    return best if dist(best) <= tolerance_h * 3600 else None


def plan_reconcile(submissions, runs, tolerance_h=TOLERANCE_H):
    """Pure planner -> (upserts: [consent rec dict], marks: [(submission_id, run_key)]).
    Only unreconciled submissions that match a run are included."""
    upserts, marks = [], []
    for s in submissions:
        if s.get("reconciled_run_key"):
            continue
        run = match_run(s, runs, tolerance_h)
        if not run:
            continue
        upserts.append({
            "run_key": run["run_key"],
            "run_id": run.get("run_id", ""),
            "consent_method": s.get("consent_method", ""),
            "consent_date": str(s.get("agreed_at", ""))[:10],
            "terms_version": s.get("terms_version", ""),
            "recorded_by": s.get("attested_by", ""),
            "notes": s.get("notes", ""),
        })
        marks.append((s["id"], run["run_key"]))
    return upserts, marks
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest site/scripts/tests/test_reconcile_consent.py -q`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add site/scripts/reconcile_consent.py site/scripts/tests/test_reconcile_consent.py
git commit -m "feat(consent): reconcile match + planner (pure, TDD)"
```

---

## Task 3: Reconcile DB orchestration + CI wiring

**Files:**
- Modify: `site/scripts/reconcile_consent.py`
- Modify: `.github/workflows/data-library.yml`

- [ ] **Step 1: Add the DB orchestration (reuses consent_ledger._upsert_pg, DRY)**

Append to `site/scripts/reconcile_consent.py`:

```python
def _fetch(db_url):
    """-> (submissions, runs) from Supabase."""
    import psycopg
    from psycopg.rows import dict_row
    with psycopg.connect(db_url) as con, con.cursor(row_factory=dict_row) as cur:
        cur.execute("select id, deployment_code, condition, consent_method, attested_by, "
                    "terms_version, to_char(agreed_at,'YYYY-MM-DD HH24:MI:SS') as agreed_at, "
                    "notes, reconciled_run_key from consent_submissions")
        subs = cur.fetchall()
        cur.execute("select run_key, run_id, condition, "
                    "to_char(start_ts,'YYYY-MM-DD HH24:MI:SS') as start from runs")
        runs = cur.fetchall()
    return subs, runs


def _apply(upserts, marks, db_url):
    import psycopg
    from consent_ledger import _upsert_pg          # reuse the proven consent upsert
    for rec in upserts:
        _upsert_pg(rec, db_url)
    with psycopg.connect(db_url) as con, con.cursor() as cur:
        for sub_id, run_key in marks:
            cur.execute("update consent_submissions set reconciled_run_key=%s where id=%s",
                        (run_key, sub_id))
        con.commit()


def reconcile(db_url=None):
    src = db_url if db_url is not None else os.environ.get("SUPABASE_DB_URL")
    if not src:
        print("(reconcile_consent: SUPABASE_DB_URL unset — skipped)")
        return 0
    subs, runs = _fetch(src)
    upserts, marks = plan_reconcile(subs, runs)
    if upserts:
        _apply(upserts, marks, src)
    print(f"reconcile_consent: {len(upserts)} submission(s) reconciled to runs "
          f"({len(subs)} total submissions, {len(runs)} runs)")
    return 0


def main(argv):
    return reconcile()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 2: Verify nothing broke (pure tests still pass)**

Run: `python -m pytest site/scripts/tests/test_reconcile_consent.py -q`
Expected: PASS (6 passed) — orchestration is import-guarded, no new failures.

- [ ] **Step 3: Add the reconcile step to the workflow**

In `.github/workflows/data-library.yml`, insert this step **between** the "Sync system-of-record to Supabase" step and the "Build catalog" step:

```yaml
      - name: Reconcile web consent submissions to runs
        # After sync (runs exist), before build_catalog (so catalog reflects new consent).
        # No-op if SUPABASE_DB_URL unset.
        env:
          SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}
        run: python site/scripts/reconcile_consent.py
```

- [ ] **Step 4: Commit**

```bash
git add site/scripts/reconcile_consent.py .github/workflows/data-library.yml
git commit -m "feat(consent): reconcile DB orchestration + CI step (after sync, before build)"
```

---

## Task 4: Add vitest + the consent payload validator (TDD)

**Files:**
- Modify: `site/package.json`
- Create: `site/api/_validate.ts`
- Test: `site/api/_validate.test.ts`

- [ ] **Step 1: Add vitest to the site**

In `site/package.json`, add to `scripts`: `"test": "vitest run"`, and to `devDependencies`: `"vitest": "^2.1.1"`. Then:

Run: `cd site && npm install`
Expected: vitest installed, no errors.

- [ ] **Step 2: Write the failing tests**

`site/api/_validate.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateConsentPayload } from "./_validate";

describe("validateConsentPayload", () => {
  const good = { code: "VEN-4827", method: "opt_in_form", condition: "fahey_window_1person",
                 attested_by: "occupant", terms_version: "v1", notes: "" };

  it("accepts a valid payload", () => {
    const r = validateConsentPayload(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.code).toBe("VEN-4827");
  });

  it("rejects a missing/invalid code", () => {
    expect(validateConsentPayload({ ...good, code: "nope" }).ok).toBe(false);
    expect(validateConsentPayload({ ...good, code: "" }).ok).toBe(false);
  });

  it("rejects an invalid method", () => {
    expect(validateConsentPayload({ ...good, method: "hacked" }).ok).toBe(false);
  });

  it("trips the honeypot", () => {
    expect(validateConsentPayload({ ...good, website: "spam" }).ok).toBe(false);
  });

  it("caps oversized notes", () => {
    const r = validateConsentPayload({ ...good, notes: "x".repeat(5000) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.notes.length).toBeLessThanOrEqual(500);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd site && npx vitest run api/_validate.test.ts`
Expected: FAIL — cannot find `./_validate`.

- [ ] **Step 4: Write the validator**

`site/api/_validate.ts`:

```typescript
export interface ConsentValue {
  code: string; method: string; condition: string;
  attested_by: string; terms_version: string; notes: string;
}
type Result = { ok: true; value: ConsentValue } | { ok: false; error: string };

const METHODS = new Set(["opt_in_form", "opt_in_verbal"]);
const CODE_RE = /^VEN-\w{3,8}$/;
const cap = (v: unknown, n: number) => String(v ?? "").slice(0, n);

export function validateConsentPayload(body: any): Result {
  if (!body || typeof body !== "object") return { ok: false, error: "bad request" };
  if (body.website) return { ok: false, error: "rejected" };          // honeypot
  const code = String(body.code ?? "").trim();
  if (!CODE_RE.test(code)) return { ok: false, error: "invalid deployment code" };
  const method = String(body.method ?? "");
  if (!METHODS.has(method)) return { ok: false, error: "invalid consent method" };
  return {
    ok: true,
    value: {
      code,
      method,
      condition: cap(body.condition, 120),
      attested_by: cap(body.attested_by, 60),
      terms_version: cap(body.terms_version, 40),
      notes: cap(body.notes, 500),
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd site && npx vitest run api/_validate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add site/package.json site/package-lock.json site/api/_validate.ts site/api/_validate.test.ts
git commit -m "feat(consent): payload validator + vitest (TDD)"
```

---

## Task 5: Vercel serverless function + route exclusion

**Files:**
- Create: `site/api/consent.ts`
- Modify: `site/vercel.json`
- Modify: `site/package.json`

- [ ] **Step 1: Add server deps**

In `site/package.json` add to `dependencies`: `"pg": "^8.13.1"`, and to `devDependencies`: `"@types/pg": "^8.11.10"`, `"@vercel/node": "^3.2.24"`. Then:

Run: `cd site && npm install`
Expected: installs cleanly.

- [ ] **Step 2: Exclude `/api` from the SPA rewrite**

Replace `site/vercel.json` contents with:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [{ "source": "/((?!api/).*)", "destination": "/index.html" }]
}
```

(Without this, the catch-all rewrite sends `/api/consent` to `index.html` and the function never runs.)

- [ ] **Step 3: Write the function**

`site/api/consent.ts`:

```typescript
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Client } from "pg";
import { validateConsentPayload } from "./_validate";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const v = validateConsentPayload(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });

  const url = process.env.SUPABASE_DB_URL;
  if (!url) return res.status(500).json({ error: "not configured" });

  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    await client.query(
      "insert into consent_submissions " +
      "(deployment_code, condition, consent_method, attested_by, terms_version, notes) " +
      "values ($1,$2,$3,$4,$5,$6)",
      [v.value.code, v.value.condition, v.value.method,
       v.value.attested_by, v.value.terms_version, v.value.notes],
    );
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "could not record consent" });
  } finally {
    await client.end().catch(() => {});
  }
}
```

- [ ] **Step 4: Verify the build typechecks**

Run: `cd site && npm run build`
Expected: PASS (tsc -noEmit + vite build, no type errors). Note: the function isn't bundled by vite; this just confirms the repo still typechecks. The `@vercel/node` types resolve the import.

- [ ] **Step 5: Commit**

```bash
git add site/api/consent.ts site/vercel.json site/package.json site/package-lock.json
git commit -m "feat(consent): Vercel function writes submissions (Data API stays off)"
```

---

## Task 6: The consent form page + route

**Files:**
- Create: `site/src/pages/Consent.tsx`
- Modify: `site/src/App.tsx`

- [ ] **Step 1: Build the form page**

`site/src/pages/Consent.tsx` (built to `DESIGN.md`: green palette, Outfit/serif, no em-dashes, no emoji, AA contrast, mobile-first, reduced-motion inherited). Reads `?code=`, offers a mode toggle, posts to `/api/consent`, handles missing-code / submitting / success / error:

```tsx
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

const TERMS_VERSION = "v1-2026-06";

export default function Consent() {
  const [params] = useSearchParams();
  const code = (params.get("code") || "").trim();
  // condition rides in the QR the cofounder generates (anonymized label, safe in a URL).
  // It is what reconcile_consent matches a submission to its run on.
  const condition = (params.get("c") || params.get("condition") || "").trim();
  const [mode, setMode] = useState<"occupant" | "assisted">("occupant");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [err, setErr] = useState("");

  const valid = /^VEN-\w{3,8}$/.test(code);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending"); setErr("");
    const method = mode === "occupant" ? "opt_in_form" : "opt_in_verbal";
    const attested_by = mode === "occupant" ? "occupant" : "founder";
    try {
      const r = await fetch("/api/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, condition, method, attested_by, terms_version: TERMS_VERSION }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "failed");
      setState("done");
    } catch (e: any) { setErr(e.message || "Something went wrong"); setState("error"); }
  }

  if (!valid) {
    return (
      <main className="page wrap" style={{ maxWidth: 620 }}>
        <p className="eyebrow">Consent</p>
        <h1 className="section-title">This link needs a deployment code</h1>
        <p className="lede">Please use the link or QR code provided with the Ventis logger in
          your room. If you reached this page by mistake, you can close it.</p>
      </main>
    );
  }

  if (state === "done") {
    return (
      <main className="page wrap" style={{ maxWidth: 620 }}>
        <p className="eyebrow">Consent recorded</p>
        <h1 className="section-title">Thank you</h1>
        <p className="lede">Your opt-in is recorded for deployment <strong>{code}</strong>.
          Ventis measures CO₂, temperature, and humidity only. No names, rooms, or identifying
          information are stored. To opt out at any time, email us and we will remove the run.</p>
      </main>
    );
  }

  return (
    <main className="page wrap" style={{ maxWidth: 620 }}>
      <p className="eyebrow">Consent · {code}</p>
      <h1 className="section-title">Join the Ventis air-quality study</h1>
      <p className="lede">A Ventis logger in this room measures <strong>CO₂, temperature, and
        humidity</strong> over a few days. We store <strong>no names, no room numbers, and no
        identifying information</strong>. The data is anonymized and you can opt out at any time.</p>

      <div className="card" style={{ marginTop: 16 }}>
        <div role="radiogroup" aria-label="Who is confirming consent"
             style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button type="button" className={mode === "occupant" ? "btn btn-primary" : "btn btn-ghost"}
                  aria-pressed={mode === "occupant"} onClick={() => setMode("occupant")}>
            I live here
          </button>
          <button type="button" className={mode === "assisted" ? "btn btn-primary" : "btn btn-ghost"}
                  aria-pressed={mode === "assisted"} onClick={() => setMode("assisted")}>
            Ventis team (assisted)
          </button>
        </div>
        <form onSubmit={submit}>
          {/* honeypot: real people leave this empty; hidden from view + AT */}
          <input type="text" name="website" tabIndex={-1} autoComplete="off"
                 aria-hidden="true" style={{ display: "none" }} />
          <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 14 }}>
            {mode === "occupant"
              ? "By tapping Agree, you opt in to anonymized data collection in this room."
              : "Confirm the occupant was informed and verbally agreed before submitting."}
          </p>
          <button type="submit" className="btn btn-primary" disabled={state === "sending"}>
            {state === "sending" ? "Recording…" : "I agree"}
          </button>
          {state === "error" && (
            <p role="alert" style={{ color: "var(--red)", marginTop: 12 }}>
              {err}. Please try again, or contact the Ventis team.
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Add the route**

In `site/src/App.tsx`: add `import Consent from "./pages/Consent";` with the other page imports, and add `<Route path="/consent" element={<Consent />} />` alongside the existing routes.

- [ ] **Step 3: Verify the build typechecks**

Run: `cd site && npm run build`
Expected: PASS (no type errors).

- [ ] **Step 4: Render-verify locally**

Run: `cd site && npm run dev`, open `http://localhost:5173/consent?code=VEN-4827`.
Expected: form renders with both mode buttons; open `/consent` with no code → the "needs a deployment code" state. Check at ≤640px width. (The POST will 404 in `vite dev` since the function only exists on Vercel — that is expected locally; full submit is verified in Task 8.)

- [ ] **Step 5: Em-dash + checklist gate (DESIGN.md)**

Run: `grep -rn "—" site/src/pages/Consent.tsx`
Expected: no output (zero em-dashes).

- [ ] **Step 6: Commit**

```bash
git add site/src/pages/Consent.tsx site/src/App.tsx
git commit -m "feat(consent): consent form page + /consent route"
```

---

## Task 7: Add the consent-code step to the in-repo Operations SOP

**Files:**
- Modify: `library/src/components/OperationsPage.tsx`

- [ ] **Step 1: Add the deployment-code step to the Logger Deployment SOP**

In `library/src/components/OperationsPage.tsx`, in the "Logger deployment SOP" ordered list, add a step after the existing Consent step:

```tsx
          <li><strong>Deployment code:</strong> pick a code (format <code style={code}>VEN-####</code>)
            and use the same condition label for this run. Capture consent via a QR/link that
            encodes both: <code style={code}>/consent?code=VEN-####&c=&lt;condition_label&gt;</code>
            (e.g. <code style={code}>?code=VEN-4827&c=fahey_window_1person</code>). Show the
            occupant the QR for self-serve, or open it on your phone for the assisted opt-in. The
            condition links their consent to this run during reconciliation.</li>
```

- [ ] **Step 2: Verify the catalog app builds**

Run: `cd library && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add library/src/components/OperationsPage.tsx
git commit -m "docs(consent): deployment-code + web-consent step in Operations SOP"
```

> Note (not a code step): also update the vault `Projects/Ventis/Data/Logger Deployment SOP.md`
> with the same step. The vault is outside this repo — do it by hand or via the filesystem tools.

---

## Task 8: End-to-end verification + PR

**Files:** none (verification).

- [ ] **Step 1: Confirm Diego prerequisites are done**

`consent_submissions` table exists in Supabase; `SUPABASE_DB_URL` is set in Vercel env and the site has been redeployed.

- [ ] **Step 2: Full test sweep**

Run: `python -m pytest site/scripts/tests/ -q` (expect all green incl. reconcile)
Run: `cd site && npm run build && npx vitest run` (expect build + validator green)

- [ ] **Step 3: Live submission**

After the branch is deployed to a Vercel preview (or merged), open the deployed
`/consent?code=VEN-TEST1&c=zztest_x_1person`, tap "I agree" → expect the success state.
In Supabase Table Editor, confirm one row in `consent_submissions` (code `VEN-TEST1`,
condition `zztest_x_1person`, method `opt_in_form`, `reconciled_run_key` null — it won't match
any real run, which is correct).

- [ ] **Step 4: Reconcile + catalog (real run)**

To see a verified flip end-to-end: open `/consent?code=VEN-REAL&c=<an existing run's exact
condition>` (e.g. `fahey_window_1person`) and submit, then trigger the data-library workflow
(`workflow_dispatch`). Confirm the log shows `reconcile_consent: 1 submission(s) reconciled to
runs` and that run's `consent_status` is `verified` in the rebuilt catalog. Clean up the test
rows in `consent_submissions` afterward.

- [ ] **Step 5: Open the PR**

```bash
git push -u Ventis feat-consent-web
```
Open a PR to `main`, summarize the feature, and merge after verification.

---

## Self-review notes

- **Spec coverage:** form (T6), both modes (T6 toggle), deployment code + soft-join linkage
  (T2 match_run), Vercel write path / Data API off (T5), consent_submissions + reconcile into
  existing consent table (T1/T2/T3), CI ordering after sync before build (T3), SOP (T7),
  build_catalog unchanged (no task touches it — by design). All covered.
- **Out of scope preserved:** no auth/logins, no Data-API re-enable, no firmware/Sheet change.
- **Type/name consistency:** `validateConsentPayload`/`ConsentValue` (T4) used by the function
  (T5); `match_run`/`plan_reconcile` (T2) used by `reconcile` (T3); consent rec keys
  (`run_key`/`consent_method`/`consent_date`/`recorded_by`) match `consent_ledger._upsert_pg`'s
  expected dict (reused in T3).
