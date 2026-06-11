# Catalog Annotation UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a founder set run annotations (note + quality flag + tags) from the gated catalog in the browser, replacing the `annotate.py` CLI, by adding a `/curate` page + a Cloudflare Pages Function that upserts into Supabase `annotations`.

**Architecture:** UI and write endpoint both live in `library/` (the catalog, Cloudflare Pages, already behind Cloudflare Access). A Pages Function (`functions/api/annotate.ts`) reaches Supabase the same way the Python scripts do — a direct Postgres connection to the Session-pooler — but from the Workers runtime via `postgres.js`. The Supabase Data API (PostgREST) stays OFF (the moat). `build_catalog` already reads the `annotations` table, so the read side is done; annotations appear in the catalog on the next hourly build.

**Tech Stack:** Cloudflare Pages Functions (Workers runtime, `nodejs_compat`), `postgres` (postgres.js) v3, React 19 + react-router-dom 7, Vite 8, Vitest 4, Wrangler.

**Reference design:** `docs/plans/2026-06-10-catalog-annotation-ui-design.md`

**Closest analogs to mirror:**
- Founder page idiom: `library/src/components/DeployPage.tsx`
- Validator + tests: `site/api/_validate.ts` + `site/api/_validate.test.ts`
- Upsert semantics: `site/scripts/annotate.py::_upsert_pg`
- Run data shape: `library/src/lib/catalog.ts` (`Run`, `loadCatalog`)
- annotations DDL: `site/scripts/supabase_schema.sql` (run_key PK; note, quality_flag, tags, updated_by, updated_at)

---

## Task 1: postgres.js-on-Workers connection spike

Prove `postgres.js` can connect to the Supabase Session-pooler from the local Workers runtime (`wrangler pages dev`) **before** building anything on top of it. This is the one real risk in the plan.

**Files:**
- Modify: `library/package.json` (add `postgres` dep, `wrangler` devDep)
- Create: `library/wrangler.toml`
- Create: `library/functions/api/annotate.ts` (temporary GET probe — replaced in Task 4)
- Create: `library/.dev.vars` (gitignored — local secret)
- Modify: `library/.gitignore` (or repo `.gitignore`) — ignore `.dev.vars` and `.wrangler/`

- [ ] **Step 1: Add dependencies**

In `library/`, run:

```bash
cd library
npm install postgres@^3.4.5
npm install -D wrangler@^3.90.0
```

Expected: `postgres` appears under `dependencies`, `wrangler` under `devDependencies` in `library/package.json`.

- [ ] **Step 2: Create `library/wrangler.toml`**

Pages Functions need `nodejs_compat` for `postgres.js` to open TCP via `cloudflare:sockets`.

```toml
name = "ventis-data-library"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = "dist"
```

- [ ] **Step 3: Gitignore the local secret + wrangler cache**

Append to `library/.gitignore` (create if missing):

```
.dev.vars
.wrangler/
```

- [ ] **Step 4: Create `library/.dev.vars` with the pooler URL**

This file is gitignored. Paste the Supabase **Session-pooler** URI (same value the Python scripts read as `SUPABASE_DB_URL`):

```
SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

> Diego provides this value. It is the Session-pooler (IPv4) connection string from Supabase → Project Settings → Database → Connection string → "Session pooler".

- [ ] **Step 5: Write the temporary connection probe**

Create `library/functions/api/annotate.ts`:

```ts
import postgres from "postgres";

interface Env { SUPABASE_DB_URL: string }

// TEMPORARY probe — proves postgres.js connects to the Supabase pooler from the
// Workers runtime. Replaced by the real POST handler in Task 4.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = context.env.SUPABASE_DB_URL;
  if (!url) return Response.json({ error: "not configured" }, { status: 500 });
  const sql = postgres(url, { ssl: "require", prepare: false, fetch_types: false });
  try {
    const rows = await sql`select 1 as probe`;
    return Response.json({ ok: true, probe: rows[0].probe });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  } finally {
    context.waitUntil(sql.end());
  }
};
```

- [ ] **Step 6: Build the catalog and run the local Workers runtime**

```bash
cd library
npm run build
npx wrangler pages dev dist
```

Wrangler prints a local URL (e.g. `http://localhost:8788`). In a second terminal:

```bash
curl http://localhost:8788/api/annotate
```

Expected: `{"ok":true,"probe":1}`

- [ ] **Step 7: If the probe fails, adjust driver options before proceeding**

Try, in order:
1. Confirm `nodejs_compat` is active (wrangler logs the flag at startup).
2. Add `{ ssl: "require", prepare: false, fetch_types: false, idle_timeout: 2 }`.
3. If TCP still fails on workerd, the fallback is **Cloudflare Hyperdrive** or hosting the endpoint on Vercel and forwarding the Access JWT — STOP and flag to Diego; do not silently switch hosts.

Do not continue until the probe returns `{"ok":true,"probe":1}`.

- [ ] **Step 8: Commit (spike infra, never the secret)**

```bash
git add library/package.json library/package-lock.json library/wrangler.toml library/.gitignore library/functions/api/annotate.ts
git status   # confirm library/.dev.vars is NOT staged
git commit -m "spike(ventis): postgres.js connects to Supabase pooler from Workers runtime"
```

---

## Task 2: Annotation payload validator + updated_by resolver (TDD)

Pure, DB-free logic: validate the POST body and resolve the founder identity from the Cloudflare Access header. Underscore-prefixed filename = treated by Pages as a shared module, not a route.

**Files:**
- Create: `library/functions/api/_annotate.ts`
- Test: `library/functions/api/_annotate.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `library/functions/api/_annotate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateAnnotationPayload, resolveUpdatedBy } from "./_annotate";

describe("validateAnnotationPayload", () => {
  const good = { run_key: "little_continuous_1p_20260610", note: "fan ran all night",
                 quality_flag: "caution", tags: "hardware" };

  it("accepts a valid payload", () => {
    const r = validateAnnotationPayload(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.run_key).toBe("little_continuous_1p_20260610");
  });

  it("accepts an empty flag (clears the flag)", () => {
    const r = validateAnnotationPayload({ ...good, quality_flag: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.quality_flag).toBe("");
  });

  it("rejects a missing run_key", () => {
    expect(validateAnnotationPayload({ ...good, run_key: "" }).ok).toBe(false);
    expect(validateAnnotationPayload({ ...good, run_key: "   " }).ok).toBe(false);
  });

  it("rejects an invalid flag", () => {
    expect(validateAnnotationPayload({ ...good, quality_flag: "bogus" }).ok).toBe(false);
  });

  it("rejects a non-object body", () => {
    expect(validateAnnotationPayload(null).ok).toBe(false);
    expect(validateAnnotationPayload("x").ok).toBe(false);
  });

  it("caps oversized note and tags", () => {
    const r = validateAnnotationPayload({ ...good, note: "x".repeat(5000), tags: "y".repeat(500) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.note.length).toBeLessThanOrEqual(1000);
      expect(r.value.tags.length).toBeLessThanOrEqual(200);
    }
  });
});

describe("resolveUpdatedBy", () => {
  it("uses the Access email when present", () => {
    expect(resolveUpdatedBy("diego@dartmouth.edu")).toBe("diego@dartmouth.edu");
  });
  it("falls back to 'founder' when the header is missing", () => {
    expect(resolveUpdatedBy(null)).toBe("founder");
    expect(resolveUpdatedBy("")).toBe("founder");
  });
  it("caps an oversized email", () => {
    expect(resolveUpdatedBy("a".repeat(300)).length).toBeLessThanOrEqual(120);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd library
npx vitest run functions/api/_annotate.test.ts
```

Expected: FAIL — `Cannot find module './_annotate'`.

- [ ] **Step 3: Write the validator + resolver**

Create `library/functions/api/_annotate.ts`:

```ts
export interface AnnotationValue {
  run_key: string; note: string; quality_flag: string; tags: string;
}
type Result = { ok: true; value: AnnotationValue } | { ok: false; error: string };

// Matches site/scripts/annotate.py VALID_FLAGS, plus "" to clear a flag.
export const VALID_FLAGS = new Set(["good", "caution", "exclude", ""]);
const cap = (v: unknown, n: number) => String(v ?? "").slice(0, n);

export function validateAnnotationPayload(body: any): Result {
  if (!body || typeof body !== "object") return { ok: false, error: "bad request" };
  const run_key = String(body.run_key ?? "").trim();
  if (!run_key) return { ok: false, error: "missing run_key" };
  const quality_flag = String(body.quality_flag ?? "").trim();
  if (!VALID_FLAGS.has(quality_flag)) return { ok: false, error: "invalid quality flag" };
  return {
    ok: true,
    value: { run_key, quality_flag, note: cap(body.note, 1000), tags: cap(body.tags, 200) },
  };
}

// Cloudflare Access guarantees this header on authenticated requests; "founder"
// is a defensive fallback (the route is unreachable without Access anyway).
export function resolveUpdatedBy(headerEmail: string | null): string {
  const e = String(headerEmail ?? "").trim();
  return e ? e.slice(0, 120) : "founder";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd library
npx vitest run functions/api/_annotate.test.ts
```

Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add library/functions/api/_annotate.ts library/functions/api/_annotate.test.ts
git commit -m "feat(ventis): annotation payload validator + Access identity resolver"
```

---

## Task 3: Client lib — run worklist sort + POST helper (TDD)

Pure helper for ordering unannotated runs first, plus the typed fetch wrapper the page uses.

**Files:**
- Create: `library/src/lib/annotate.ts`
- Test: `library/src/lib/annotate.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `library/src/lib/annotate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { unannotatedFirst, FLAG_OPTIONS } from "./annotate";
import type { Run } from "./catalog";

const runs = [
  { run_key: "a", condition: "fahey_window_1p", quality_flag: "caution" } as Run,
  { run_key: "b", condition: "little_baseline_1p", quality_flag: "" } as Run,
  { run_key: "c", condition: "ew_fan_2p" } as Run, // no flag field at all
];

describe("unannotatedFirst", () => {
  it("puts runs with no flag before flagged runs", () => {
    const ordered = unannotatedFirst(runs);
    expect(ordered.map((r) => r.run_key)).toEqual(["b", "c", "a"]);
  });
  it("does not mutate the input array", () => {
    const copy = [...runs];
    unannotatedFirst(runs);
    expect(runs).toEqual(copy);
  });
});

describe("FLAG_OPTIONS", () => {
  it("offers clear/good/caution/exclude", () => {
    expect(FLAG_OPTIONS.map((o) => o.value)).toEqual(["", "good", "caution", "exclude"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd library
npx vitest run src/lib/annotate.test.ts
```

Expected: FAIL — `Cannot find module './annotate'`.

- [ ] **Step 3: Write the client lib**

Create `library/src/lib/annotate.ts`:

```ts
import type { Run } from "./catalog";

export const FLAG_OPTIONS = [
  { value: "", label: "— no flag —" },
  { value: "good", label: "good" },
  { value: "caution", label: "caution" },
  { value: "exclude", label: "exclude" },
] as const;

export interface AnnotationForm {
  run_key: string; note: string; quality_flag: string; tags: string;
}

/** Runs lacking a quality_flag sorted before flagged ones; stable, non-mutating. */
export function unannotatedFirst(runs: Run[]): Run[] {
  const rank = (r: Run) => (r.quality_flag ? 1 : 0);
  return [...runs]
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map(({ r }) => r);
}

/** POST an annotation to the gated Pages Function. Throws on a non-ok response. */
export async function postAnnotation(form: AnnotationForm): Promise<void> {
  const res = await fetch("/api/annotate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(form),
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({}))).error || "could not save annotation";
    throw new Error(msg);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd library
npx vitest run src/lib/annotate.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add library/src/lib/annotate.ts library/src/lib/annotate.test.ts
git commit -m "feat(ventis): catalog client helpers for annotation worklist + POST"
```

---

## Task 4: Real POST handler in the Pages Function

Replace the Task 1 probe with the production upsert. DB I/O is verified by `wrangler pages dev` end-to-end (Task 7), mirroring how consent's DB path is verified — the pure logic it depends on is already unit-tested in Task 2.

**Files:**
- Modify: `library/functions/api/annotate.ts` (replace probe with POST handler)

- [ ] **Step 1: Replace the file contents**

Overwrite `library/functions/api/annotate.ts`:

```ts
import postgres from "postgres";
import { validateAnnotationPayload, resolveUpdatedBy } from "./_annotate";

interface Env { SUPABASE_DB_URL: string }

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const v = validateAnnotationPayload(await context.request.json().catch(() => null));
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });

  const url = context.env.SUPABASE_DB_URL;
  if (!url) return Response.json({ error: "not configured" }, { status: 500 });

  // Cloudflare Access has already authenticated the founder at the edge; this
  // header is the verified identity (never an occupant).
  const updatedBy = resolveUpdatedBy(
    context.request.headers.get("Cf-Access-Authenticated-User-Email"),
  );

  const sql = postgres(url, { ssl: "require", prepare: false, fetch_types: false });
  try {
    // Same upsert as site/scripts/annotate.py::_upsert_pg.
    await sql`
      insert into annotations (run_key, note, quality_flag, tags, updated_by, updated_at)
      values (${v.value.run_key}, ${v.value.note}, ${v.value.quality_flag},
              ${v.value.tags}, ${updatedBy}, now())
      on conflict (run_key) do update set
        note = excluded.note,
        quality_flag = excluded.quality_flag,
        tags = excluded.tags,
        updated_by = excluded.updated_by,
        updated_at = now()
    `;
    return Response.json({ ok: true });
  } catch (e) {
    console.error("annotation upsert failed:", e);
    return Response.json({ error: "could not save annotation" }, { status: 500 });
  } finally {
    context.waitUntil(sql.end());
  }
};
```

- [ ] **Step 2: Re-run the unit suite (handler imports the tested helpers)**

```bash
cd library
npx vitest run functions/api/_annotate.test.ts
```

Expected: PASS (unchanged — confirms the import surface still matches).

- [ ] **Step 3: Smoke the handler locally**

```bash
cd library
npm run build && npx wrangler pages dev dist
```

In another terminal, POST a throwaway annotation against a real run_key from `library/public/data/catalog.json`:

```bash
curl -s -X POST http://localhost:8788/api/annotate \
  -H "Content-Type: application/json" \
  -d '{"run_key":"<a-real-run_key>","note":"plan smoke test","quality_flag":"caution","tags":"test"}'
```

Expected: `{"ok":true}`. Also verify a bad flag is rejected:

```bash
curl -s -X POST http://localhost:8788/api/annotate -H "Content-Type: application/json" \
  -d '{"run_key":"x","quality_flag":"bogus"}'
```

Expected: `{"error":"invalid quality flag"}` with HTTP 400.

> Clean up the smoke row afterward (Supabase Table Editor → `annotations` → delete the test row), or overwrite it with the real flag later.

- [ ] **Step 4: Commit**

```bash
git add library/functions/api/annotate.ts
git commit -m "feat(ventis): POST /api/annotate upserts run annotation to Supabase"
```

---

## Task 5: Curate page

Founder UI: pick a run (unannotated first), see its current flag/note/tags, edit, submit. Mirrors `DeployPage.tsx` styling (inline styles + `var(--…)` theme tokens) so it matches the catalog.

**Files:**
- Create: `library/src/components/CuratePage.tsx`

- [ ] **Step 1: Write the page**

Create `library/src/components/CuratePage.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { loadCatalog, type Run } from "../lib/catalog";
import { FLAG_OPTIONS, postAnnotation, unannotatedFirst } from "../lib/annotate";

const card: React.CSSProperties = {
  background: "var(--tile)", border: "1px solid var(--border)", borderRadius: 8, padding: 18,
};
const label: React.CSSProperties = {
  display: "block", fontSize: 13, color: "var(--muted)", margin: "12px 0 4px",
};
const input: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)",
  background: "var(--tile-alt)", color: "inherit", fontSize: 14, boxSizing: "border-box",
};
const btn: React.CSSProperties = {
  padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border)",
  background: "var(--tile-alt)", color: "inherit", fontSize: 14, cursor: "pointer",
};

export default function CuratePage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState("");
  const [note, setNote] = useState("");
  const [flag, setFlag] = useState("");
  const [tags, setTags] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [err, setErr] = useState("");

  useEffect(() => {
    loadCatalog().then((rs) => setRuns(unannotatedFirst(rs))).catch(() => setRuns([]));
  }, []);

  const current = useMemo(
    () => runs.find((r) => r.run_key === selected),
    [runs, selected],
  );

  // When a run is picked, prefill the form from its existing annotation.
  useEffect(() => {
    if (!current) return;
    setNote(current.note ?? "");
    setFlag(current.quality_flag ?? "");
    setTags(current.tags ?? "");
    setState("idle"); setErr("");
  }, [current]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setState("saving"); setErr("");
    try {
      await postAnnotation({ run_key: selected, note, quality_flag: flag, tags });
      setState("done");
    } catch (e: any) {
      setErr(e.message || "Something went wrong"); setState("error");
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: 24, lineHeight: 1.55 }}>
      <Link to="/">← back to catalog</Link>
      <h1 style={{ fontSize: 22, margin: "12px 0 4px" }}>Curate run annotations</h1>
      <p style={{ color: "var(--muted)", marginBottom: 12 }}>
        Set a quality flag and note on a run. Saves immediately; the flag appears in the
        catalog on the next hourly build. Runs without a flag are listed first.
      </p>

      <form onSubmit={submit} style={card}>
        <label style={label} htmlFor="run">Run</label>
        <select id="run" style={input} value={selected}
                onChange={(e) => setSelected(e.target.value)}>
          <option value="">— pick a run —</option>
          {runs.map((r) => (
            <option key={r.run_key} value={r.run_key}>
              {r.quality_flag ? `[${r.quality_flag}] ` : "[ — ] "}{r.condition} · {r.date}
            </option>
          ))}
        </select>

        <label style={label} htmlFor="flag">Quality flag</label>
        <select id="flag" style={input} value={flag}
                onChange={(e) => setFlag(e.target.value)} disabled={!selected}>
          {FLAG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <label style={label} htmlFor="note">Note</label>
        <textarea id="note" style={{ ...input, minHeight: 80, resize: "vertical" }}
                  placeholder="e.g. window cracked open ~2am; fan ran all night"
                  value={note} onChange={(e) => setNote(e.target.value)} disabled={!selected} />

        <label style={label} htmlFor="tags">Tags (comma-separated, optional)</label>
        <input id="tags" style={input} placeholder="hardware, window-experiment"
               value={tags} onChange={(e) => setTags(e.target.value)} disabled={!selected} />

        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <button type="submit" style={btn} disabled={!selected || state === "saving"}>
            {state === "saving" ? "Saving…" : "Save annotation"}
          </button>
          {state === "done" && (
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              Saved — appears in the catalog within the hour.
            </span>
          )}
          {state === "error" && (
            <span role="alert" style={{ color: "var(--red)", fontSize: 13 }}>{err}</span>
          )}
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Type-check the page**

```bash
cd library
npx tsc -b --noEmit
```

Expected: no errors (confirms `Run` has the `note`/`quality_flag`/`tags` fields the page reads — it does, per `catalog.ts`).

- [ ] **Step 3: Commit**

```bash
git add library/src/components/CuratePage.tsx
git commit -m "feat(ventis): /curate page — pick a run, set flag/note/tags"
```

---

## Task 6: Route + navigation

Wire `/curate` into the router and link to it from the Operations page (the founder/SOP surface).

**Files:**
- Modify: `library/src/App.tsx`
- Modify: `library/src/components/OperationsPage.tsx`

- [ ] **Step 1: Add the route**

In `library/src/App.tsx`, add the import and route (mirroring the `/deploy` line):

```tsx
import CuratePage from "./components/CuratePage";
```

```tsx
        <Route path="/deploy" element={<DeployPage />} />
        <Route path="/curate" element={<CuratePage />} />
```

- [ ] **Step 2: Add a link from Operations**

Open `library/src/components/OperationsPage.tsx`, find an existing internal `Link` (e.g. to `/deploy`), and add alongside it:

```tsx
<Link to="/curate">Curate annotations</Link>
```

Match the surrounding markup/styling of the existing link. If `Link` is not yet imported there, add `import { Link } from "react-router-dom";`.

- [ ] **Step 3: Type-check + run the full unit suite**

```bash
cd library
npx tsc -b --noEmit && npm run test
```

Expected: type-check clean; all vitest suites PASS (existing + the two new ones).

- [ ] **Step 4: Commit**

```bash
git add library/src/App.tsx library/src/components/OperationsPage.tsx
git commit -m "feat(ventis): route + Operations link for /curate"
```

---

## Task 7: End-to-end verification + production ops

Prove the whole loop locally, then record the production steps Diego must do (they require dashboard access).

**Files:**
- Modify: `docs/plans/2026-06-10-catalog-annotation-ui-design.md` (append a "Deployment notes" section)

- [ ] **Step 1: Full local end-to-end**

```bash
cd library
npm run build && npx wrangler pages dev dist
```

In the browser at the wrangler URL:
1. Go to `/curate`.
2. Pick a real run, set flag = `caution`, note = "e2e test", Save.
3. Expect "Saved — appears in the catalog within the hour."
4. In Supabase Table Editor → `annotations`, confirm the row (run_key, quality_flag=caution, updated_by present).

- [ ] **Step 2: Confirm the catalog read path**

From the repo root, regenerate the catalog from Supabase and confirm the flag lands in the built data:

```bash
python site/scripts/build_catalog.py   # reads annotations table; requires SUPABASE_DB_URL in env/.env
grep -i "quality_flag" library/public/data/catalog.json | head
```

Expected: the test run's `quality_flag` now reads `caution` in `catalog.json`. Then revert the test annotation (set flag back to its real value in `/curate`, or delete the row in Table Editor).

- [ ] **Step 3: Record production ops (Diego, one-time)**

Append to `docs/plans/2026-06-10-catalog-annotation-ui-design.md`:

```markdown
## Deployment notes (one-time, Diego)

1. **Cloudflare Pages → ventis-data-library → Settings → Environment variables:**
   add `SUPABASE_DB_URL` (Session-pooler URI) for Production **and** Preview.
2. **Settings → Functions → Compatibility flags:** add `nodejs_compat` for
   Production and Preview (also set via `library/wrangler.toml`; the dashboard
   setting is the belt-and-suspenders).
3. **Cloudflare Access:** confirm the existing Founders access application
   covers the whole `ventis-data-library.pages.dev` host (it does by default),
   so `/api/annotate` is gated — test by hitting `/api/annotate` from an
   un-allowlisted browser and expecting the Access login wall, not a 200.
4. **Verify in production:** after the next deploy, open `/curate`, set a flag,
   confirm the Supabase row, and confirm it renders after the hourly build.
```

- [ ] **Step 4: Commit**

```bash
git add docs/plans/2026-06-10-catalog-annotation-ui-design.md
git commit -m "docs(ventis): deployment notes for the annotation UI"
```

---

## Self-review notes

- **Spec coverage:** UI in catalog (Task 5/6) ✓; Pages Function upsert (Task 4) ✓; postgres.js-on-Workers + Data-API-off moat (Task 1) ✓; auth via existing Access + `updated_by` from header (Task 2/4) ✓; run worklist from static catalog data, no new read endpoint (Task 3/5) ✓; validation + tests mirroring `_validate.test.ts` / consent ledger (Task 2/3) ✓; consent + legacy backfill out of scope (design doc) ✓.
- **No schema change:** reuses the existing `annotations` table.
- **Type consistency:** `validateAnnotationPayload`/`resolveUpdatedBy`/`AnnotationValue`/`AnnotationForm`/`FLAG_OPTIONS`/`unannotatedFirst`/`postAnnotation` names are used identically across tasks; `Run.note`/`quality_flag`/`tags` already exist in `catalog.ts`.
- **`postgres.js` connection is the only real risk** — gated behind the Task 1 spike with an explicit STOP-and-flag fallback.
```
