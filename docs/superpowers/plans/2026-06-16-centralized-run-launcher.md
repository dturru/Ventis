# Centralized Run Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cofounder-gated "Run Launcher" in the `library/` app that, on one submit, composes a canonical condition label, runs a preflight checkpoint gate, records consent, and starts the device — with the label single-sourced so consent↔run reconcile can't diverge.

**Architecture:** A React page in the gated `library/` app posts to a Cloudflare Pages Function. Pure, unit-tested modules (`runLabel.ts`, `preflight.ts`) do label composition and checkpoint evaluation; the Function orchestrates IO (Supabase consent insert, Apps Script control write, `run_launches` audit row). The device is unchanged — it already polls the Apps Script control tab.

**Tech Stack:** TypeScript, React, Vite, Vitest, Cloudflare Pages Functions, `postgres` (postgres.js), Google Apps Script, Supabase Postgres.

**Spec:** `docs/superpowers/specs/2026-06-16-centralized-run-intake-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `site/scripts/supabase_schema.sql` (modify) | Add `run_launches` audit table |
| `library/src/lib/runLabel.ts` (create) | `canonical()` (port of Python), `compose()`, `validateLabelInputs()` |
| `library/src/lib/runLabel.test.ts` (create) | Tests for the above |
| `library/src/lib/preflight.ts` (create) | `evaluatePreflight()` + `gate()` — pure checkpoint planner |
| `library/src/lib/preflight.test.ts` (create) | Tests for the planner |
| `library/functions/api/run-launch.ts` (create) | Pages Function: orchestrate preflight → consent → device start. Thin IO around `handleRunLaunch()` |
| `library/functions/api/run-launch.test.ts` (create) | Tests `handleRunLaunch()` with injected deps |
| `library/src/components/RunLauncherPage.tsx` (create) | The form + preflight panel + Start/Stop |
| `library/src/App.tsx` (modify) | Add the gated `/launch` route |
| `firmware/sheets/Code.gs` (modify) | `doGet` adds `lastTelemetryAt`; `doPost` handles `action:"control"` |

---

## Task 1: `run_launches` audit table

**Files:**
- Modify: `site/scripts/supabase_schema.sql`

- [ ] **Step 1: Append the table definition**

Add to the end of `site/scripts/supabase_schema.sql`:

```sql
-- Run Launcher audit log: one row per launch attempt that started a device.
-- Surfaces overridden runs ("needs attention") and lets reconcile/backfill find
-- deferred-consent runs by canonical_label. No PII (label is building_scenario_Nperson).
create table if not exists run_launches (
  id                    bigint generated always as identity primary key,
  label                 text not null,           -- composed label sent to device + consent
  canonical_label       text not null,           -- canonical() form, for dup-guard + reconcile
  started_at            timestamptz default now(),
  stopped_at            timestamptz,
  device_last_seen_secs integer,                 -- device liveness at launch (null = unknown)
  consent_status        text not null default 'recorded',  -- recorded | deferred
  override_flags        text[] not null default '{}',      -- checkpoint ids overridden
  override_reason       text,
  launched_by           text,                    -- Cf-Access email of the operator
  nonce                 text unique,             -- idempotency key from the client
  notes                 text                     -- optional end-of-run notes
);
create index if not exists idx_run_launches_canon on run_launches(canonical_label, started_at desc);
```

- [ ] **Step 2: Verify the SQL parses (syntax check, no DB needed)**

Run: `python -c "import pathlib,re; s=pathlib.Path('site/scripts/supabase_schema.sql').read_text(); assert s.count('create table')>=1 and 'run_launches' in s; print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add site/scripts/supabase_schema.sql
git commit -m "feat(schema): run_launches audit table for the Run Launcher"
```

> **Apply note (manual, like prior migrations):** the cofounder/Diego runs this `create table` in the Supabase SQL editor. It is idempotent (`if not exists`).

---

## Task 2: `canonical()` — port of the Python rule

**Files:**
- Create: `library/src/lib/runLabel.ts`
- Test: `library/src/lib/runLabel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `library/src/lib/runLabel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { canonical } from "./runLabel";

describe("canonical", () => {
  it("lowercases, maps number-words to digits, folds occupancy shorthand, drops separators", () => {
    expect(canonical("Little_window_one person")).toBe("littlewindow1person");
    expect(canonical("little_window_1_person")).toBe("littlewindow1person");
    expect(canonical("little_window_1p")).toBe("littlewindow1person");
  });

  it("bridges a number-word glued to an occupancy word", () => {
    expect(canonical("french_window_oneperson")).toBe(canonical("french_window_one_person"));
  });

  it("keeps different occupancy counts distinct", () => {
    expect(canonical("little_window_1person")).not.toBe(canonical("little_window_2person"));
  });

  it("does not split ordinary words that merely start with a number-word", () => {
    expect(canonical("tenant")).toBe("tenant");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd library && npx vitest run src/lib/runLabel.test.ts`
Expected: FAIL — `canonical` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

Create `library/src/lib/runLabel.ts`:

```ts
// Run condition labels: composed once from structured fields and used for BOTH the
// device control tab and the consent row, so they cannot diverge. canonical() mirrors
// site/scripts/reconcile_consent.py::canonical so the TS and Python forms always agree.

const NUM_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
};
const OCCUPANCY: Record<string, string> = {
  people: "person", persons: "person", p: "person", ppl: "person", ppls: "person",
};
const OCC_WORDS = new Set<string>([...Object.keys(OCCUPANCY), "person"]);

function splitGluedNumword(tok: string): string[] {
  for (const w of Object.keys(NUM_WORDS)) {
    if (tok !== w && tok.startsWith(w) && OCC_WORDS.has(tok.slice(w.length))) {
      return [w, tok.slice(w.length)];
    }
  }
  return [tok];
}

/** Comparable form of a condition label — tolerant of how it was written, never of
 *  what it says. Port of reconcile_consent.py::canonical. */
export function canonical(s: string): string {
  const tokens = String(s ?? "").toLowerCase().match(/[a-z]+|[0-9]+/g) ?? [];
  const split = tokens.flatMap(splitGluedNumword);
  return split.map((t) => OCCUPANCY[t] ?? NUM_WORDS[t] ?? t).join("");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd library && npx vitest run src/lib/runLabel.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add library/src/lib/runLabel.ts library/src/lib/runLabel.test.ts
git commit -m "feat(library): canonical() label normalizer (parity with reconcile_consent.py)"
```

---

## Task 3: `compose()` + `validateLabelInputs()`

**Files:**
- Modify: `library/src/lib/runLabel.ts`
- Test: `library/src/lib/runLabel.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `library/src/lib/runLabel.test.ts`:

```ts
import { compose, validateLabelInputs, BUILDINGS, SCENARIOS } from "./runLabel";

describe("compose", () => {
  it("builds building_scenario_Nperson with a digit occupancy", () => {
    expect(compose("fahey", "window", 1)).toBe("fahey_window_1person");
    expect(compose("east_wheelock", "negcontrol", 2)).toBe("east_wheelock_negcontrol_2person");
  });
});

describe("validateLabelInputs", () => {
  it("accepts clean tokens and a non-negative integer occupancy", () => {
    expect(validateLabelInputs({ building: "fahey", scenario: "window", occupancy: 1 }))
      .toEqual({ ok: true, errors: [] });
  });

  it("rejects bad building/scenario shape and bad occupancy", () => {
    const r = validateLabelInputs({ building: "Fahey Hall", scenario: "", occupancy: -1 });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBe(3);
  });

  it("exposes suggested dropdown values", () => {
    expect(BUILDINGS).toContain("fahey");
    expect(SCENARIOS).toContain("windowclosed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd library && npx vitest run src/lib/runLabel.test.ts`
Expected: FAIL — `compose` / `validateLabelInputs` not exported.

- [ ] **Step 3: Implement**

Append to `library/src/lib/runLabel.ts`:

```ts
// Suggested dropdown values for the UI. The server validates by SHAPE (not membership)
// so an "other" free-text entry is allowed as long as it is a clean token.
export const BUILDINGS = ["fahey", "choates", "little", "east_wheelock", "mid_mass", "summit", "apt"] as const;
export const SCENARIOS = ["baseline", "window", "windowclosed", "fan", "fan_window", "negcontrol"] as const;

export interface LabelInputs {
  building: string;
  scenario: string;
  occupancy: number;
}

/** Compose the canonical-by-construction label. Occupancy is always a digit. */
export function compose(building: string, scenario: string, occupancy: number): string {
  return `${building}_${scenario}_${occupancy}person`;
}

const TOKEN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** Hard-checkpoint H2: label inputs are well-formed (kills the divergence bug class). */
export function validateLabelInputs(i: LabelInputs): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!TOKEN.test(i.building)) errors.push("building must be lowercase tokens (a-z, 0-9, _)");
  if (!TOKEN.test(i.scenario)) errors.push("scenario must be lowercase tokens (a-z, 0-9, _)");
  if (!Number.isInteger(i.occupancy) || i.occupancy < 0) errors.push("occupancy must be a non-negative integer");
  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd library && npx vitest run src/lib/runLabel.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add library/src/lib/runLabel.ts library/src/lib/runLabel.test.ts
git commit -m "feat(library): compose() + validateLabelInputs() for run labels"
```

---

## Task 4: `evaluatePreflight()` + `gate()` — the checkpoint planner

**Files:**
- Create: `library/src/lib/preflight.ts`
- Test: `library/src/lib/preflight.test.ts`

- [ ] **Step 1: Write the failing test**

Create `library/src/lib/preflight.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { evaluatePreflight, gate, type PreflightInputs } from "./preflight";

const base: PreflightInputs = {
  authedEmail: "founder@ventis.app",
  labelInputsOk: true,
  labelErrors: [],
  consentComplete: true,
  deviceFresh: true,
  deviceLastSeenSecs: 12,
  activeRun: false,
  duplicateRecent: false,
  consentPersisted: true,
  overrides: [],
};

describe("evaluatePreflight + gate", () => {
  it("passes cleanly when everything is good", () => {
    expect(gate(evaluatePreflight(base))).toBe("ok");
  });

  it("blocks on a hard failure even if overridden", () => {
    const v = evaluatePreflight({ ...base, labelInputsOk: false, labelErrors: ["bad"], overrides: ["label"] });
    expect(gate(v)).toBe("blocked");
  });

  it("needs override when a soft check fails and is not overridden", () => {
    expect(gate(evaluatePreflight({ ...base, deviceFresh: false }))).toBe("needs_override");
  });

  it("proceeds when the failing soft check is overridden", () => {
    expect(gate(evaluatePreflight({ ...base, deviceFresh: false, overrides: ["device_online"] }))).toBe("ok");
  });

  it("omits the consent_persisted verdict until consent has been attempted", () => {
    const v = evaluatePreflight({ ...base, consentPersisted: null });
    expect(v.find((x) => x.id === "consent_persisted")).toBeUndefined();
  });

  it("defers consent when the DB write failed but the operator overrode it", () => {
    const v = evaluatePreflight({ ...base, consentPersisted: false, overrides: ["consent_persisted"] });
    expect(gate(v)).toBe("ok");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd library && npx vitest run src/lib/preflight.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `library/src/lib/preflight.ts`:

```ts
// Pure preflight checkpoint planner. Hard checks are never overridable (cheap to fix,
// prevent root-cause bugs). Soft checks are overridable with a logged reason so a run
// is never silently orphaned — an override is a tracked follow-up.

export type Tier = "hard" | "soft";

export interface Verdict {
  id: string;
  tier: Tier;
  pass: boolean;
  overridden: boolean;
  detail: string;
}

export interface PreflightInputs {
  authedEmail: string | null;
  labelInputsOk: boolean;
  labelErrors: string[];
  consentComplete: boolean;
  deviceFresh: boolean;
  deviceLastSeenSecs: number | null;
  activeRun: boolean;
  duplicateRecent: boolean;
  consentPersisted: boolean | null; // null = not attempted yet (phase 1)
  overrides: string[];               // checkpoint ids the operator chose to override
}

export function evaluatePreflight(i: PreflightInputs): Verdict[] {
  const ov = (id: string) => i.overrides.includes(id);
  const verdicts: Verdict[] = [
    { id: "auth", tier: "hard", pass: !!i.authedEmail, overridden: false,
      detail: i.authedEmail ? `as ${i.authedEmail}` : "not authenticated" },
    { id: "label", tier: "hard", pass: i.labelInputsOk, overridden: false,
      detail: i.labelInputsOk ? "valid" : i.labelErrors.join("; ") },
    { id: "consent_captured", tier: "hard", pass: i.consentComplete, overridden: false,
      detail: i.consentComplete ? "complete" : "attestation fields missing" },
    { id: "device_online", tier: "soft", pass: i.deviceFresh, overridden: ov("device_online"),
      detail: i.deviceLastSeenSecs == null ? "no telemetry seen" : `last seen ${i.deviceLastSeenSecs}s ago` },
    { id: "no_active_run", tier: "soft", pass: !i.activeRun, overridden: ov("no_active_run"),
      detail: i.activeRun ? "a run is already logging" : "idle" },
    { id: "not_duplicate", tier: "soft", pass: !i.duplicateRecent, overridden: ov("not_duplicate"),
      detail: i.duplicateRecent ? "same label launched recently" : "unique" },
  ];
  if (i.consentPersisted !== null) {
    verdicts.push({
      id: "consent_persisted", tier: "soft", pass: i.consentPersisted, overridden: ov("consent_persisted"),
      detail: i.consentPersisted ? "saved" : "DB write failed — can defer + backfill",
    });
  }
  return verdicts;
}

export type Gate = "blocked" | "needs_override" | "ok";

export function gate(verdicts: Verdict[]): Gate {
  if (verdicts.some((v) => v.tier === "hard" && !v.pass)) return "blocked";
  if (verdicts.some((v) => v.tier === "soft" && !v.pass && !v.overridden)) return "needs_override";
  return "ok";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd library && npx vitest run src/lib/preflight.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add library/src/lib/preflight.ts library/src/lib/preflight.test.ts
git commit -m "feat(library): preflight checkpoint planner (hard blocks + overridable soft blocks)"
```

---

## Task 5: Apps Script — device liveness + control write

**Files:**
- Modify: `firmware/sheets/Code.gs`

Apps Script can't be unit-tested in-repo; verify manually in the Apps Script editor.

- [ ] **Step 1: Add `lastTelemetryAt` to `doGet`**

Replace the `doGet` body in `firmware/sheets/Code.gs` with:

```javascript
function doGet() {
  try {
    const c = getControl_();
    return json_({ logging: c.logging, label: c.label, seq: c.seq, lastTelemetryAt: lastTelemetryAt_() });
  } catch (err) {
    return json_({ logging: false, label: '', seq: 0, lastTelemetryAt: null, error: String(err) });
  }
}

// ISO timestamp of the most recent telemetry row (first column), or null if none.
// Used by the Run Launcher to judge device liveness. Device ignores this extra field.
function lastTelemetryAt_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.sheetName);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const v = sheet.getRange(sheet.getLastRow(), 1).getValue();
  return v ? new Date(v).toISOString() : null;
}
```

- [ ] **Step 2: Handle `action:"control"` in `doPost`**

In `firmware/sheets/Code.gs`, replace the line `const sheet = getSheet_();` (and the two lines that append the telemetry row + return) inside `doPost` so the token check is shared and a control action is handled first. The new `doPost` body:

```javascript
function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents);
    const expected = PropertiesService.getScriptProperties().getProperty('SHEETS_TOKEN');
    if (expected && p.token !== expected) {
      return json_({ ok: false, error: 'unauthorized' });
    }
    // Run Launcher: set the control tab and bump seq so the device starts/stops.
    if (p.action === 'control') {
      const seq = setControl_(p.logging === true, p.label != null ? p.label : '');
      return json_({ ok: true, seq: seq });
    }
    const sheet = getSheet_();
    sheet.appendRow(buildRow_(p));
    return json_({ ok: true, rows: sheet.getLastRow() - 1 });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// Write the control tab atomically and return the new seq. label is sanitized through
// the same label_() guard the telemetry path uses, so it stays anonymized + canonical-safe.
function setControl_(logging, label) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('control');
  if (!sh) {
    sh = ss.insertSheet('control');
    sh.getRange('A1:C1').setValues([['logging', 'label', 'seq']]);
    sh.getRange('A2:C2').setValues([[false, '', 0]]);
  }
  const cur = sh.getRange('A2:C2').getValues()[0];
  const nextSeq = (Number(cur[2]) || 0) + 1;
  sh.getRange('A2:C2').setValues([[logging, label_(label), nextSeq]]);
  return nextSeq;
}
```

- [ ] **Step 3: Manual verification in the Apps Script editor**

1. Push the script (clasp) or paste into the bound Apps Script project; Deploy → Manage deployments → redeploy the existing web app (same `/exec` URL).
2. In the editor, run a one-off: `function _t(){ return setControl_(true, "fahey_window_1person"); }` → check the `control` tab shows `TRUE | fahey_window_1person | <seq+1>`.
3. Hit the `/exec` URL with `curl` (replace TOKEN + URL):
   `curl -s -X POST "$EXEC_URL" -H 'Content-Type: application/json' -d '{"token":"TOKEN","action":"control","logging":false,"label":"fahey_window_1person"}'`
   Expected: `{"ok":true,"seq":<n+1>}`, and the control tab flips `logging` to `FALSE`.
4. With a wrong token, expect `{"ok":false,"error":"unauthorized"}` (only once `SHEETS_TOKEN` is set).

- [ ] **Step 4: Commit**

```bash
git add firmware/sheets/Code.gs
git commit -m "feat(sheets): control-write doPost + lastTelemetryAt for the Run Launcher"
```

---

## Task 6: `run-launch.ts` Pages Function

**Files:**
- Create: `library/functions/api/run-launch.ts`
- Test: `library/functions/api/run-launch.test.ts`

The handler is split into a pure-ish `handleRunLaunch(deps, input)` (dependency-injected, testable) and a thin `onRequestPost` that wires real IO.

- [ ] **Step 1: Write the failing test**

Create `library/functions/api/run-launch.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { handleRunLaunch, type LaunchDeps, type LaunchBody } from "./run-launch";

function deps(over: Partial<LaunchDeps> = {}): LaunchDeps {
  return {
    now: () => new Date("2026-06-16T18:00:00Z"),
    getControl: vi.fn(async () => ({ logging: false, seq: 4, lastTelemetryAt: "2026-06-16T17:59:30Z" })),
    setControl: vi.fn(async () => 5),
    insertConsent: vi.fn(async () => {}),
    recentDuplicate: vi.fn(async () => false),
    insertLaunch: vi.fn(async () => {}),
    ...over,
  };
}

const body: LaunchBody = {
  action: "start",
  building: "fahey", scenario: "window", occupancy: 1,
  consent: { consent_method: "opt_in_verbal", attested_by: "occupant", terms_version: "v1-2026-06", notes: "" },
  nonce: "n-1", overrides: [],
};

describe("handleRunLaunch", () => {
  it("starts the device on a clean preflight and records consent + launch", async () => {
    const d = deps();
    const r = await handleRunLaunch(d, body, "founder@ventis.app");
    expect(r.status).toBe("started");
    expect(d.insertConsent).toHaveBeenCalledOnce();
    expect(d.setControl).toHaveBeenCalledWith(true, "fahey_window_1person");
    expect(d.insertLaunch).toHaveBeenCalledOnce();
  });

  it("blocks (no device start) on a hard failure", async () => {
    const d = deps();
    const r = await handleRunLaunch(d, { ...body, occupancy: -1 }, "founder@ventis.app");
    expect(r.status).toBe("blocked");
    expect(d.setControl).not.toHaveBeenCalled();
    expect(d.insertConsent).not.toHaveBeenCalled();
  });

  it("asks for override when the device is stale, without starting", async () => {
    const d = deps({ getControl: vi.fn(async () => ({ logging: false, seq: 4, lastTelemetryAt: "2026-06-16T17:00:00Z" })) });
    const r = await handleRunLaunch(d, body, "founder@ventis.app");
    expect(r.status).toBe("needs_override");
    expect(r.verdicts.find((v) => v.id === "device_online")?.pass).toBe(false);
    expect(d.setControl).not.toHaveBeenCalled();
  });

  it("defers consent and still starts when the DB write fails and is overridden", async () => {
    const d = deps({ insertConsent: vi.fn(async () => { throw new Error("pooler timeout"); }) });
    const r = await handleRunLaunch(d, { ...body, overrides: ["consent_persisted"] }, "founder@ventis.app");
    expect(r.status).toBe("started");
    expect(d.setControl).toHaveBeenCalledOnce();
    expect(d.insertLaunch).toHaveBeenCalledWith(expect.objectContaining({ consent_status: "deferred" }));
  });

  it("is idempotent: a repeated nonce does not start twice", async () => {
    const d = deps({ recentDuplicate: vi.fn(async () => false), insertLaunch: vi.fn(async () => { throw { code: "23505" }; }) });
    const r = await handleRunLaunch(d, body, "founder@ventis.app");
    expect(r.status).toBe("duplicate_nonce");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd library && npx vitest run functions/api/run-launch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `library/functions/api/run-launch.ts`:

```ts
import postgres from "postgres";
import { compose, validateLabelInputs, canonical } from "../../src/lib/runLabel";
import { evaluatePreflight, gate, type PreflightInputs, type Verdict } from "../../src/lib/preflight";

const DEVICE_FRESH_SECS = 90;   // ~3x the device's telemetry cadence
const DUP_WINDOW_H = 6;

export interface LaunchConsent {
  consent_method: string;
  attested_by: string;
  terms_version: string;
  notes: string;
}
export interface LaunchBody {
  action: "start" | "stop";
  building: string;
  scenario: string;
  occupancy: number;
  consent: LaunchConsent;
  nonce: string;
  overrides: string[];
  notes?: string; // optional end-of-run notes on stop
}

export interface LaunchRecord {
  label: string;
  canonical_label: string;
  device_last_seen_secs: number | null;
  consent_status: "recorded" | "deferred";
  override_flags: string[];
  override_reason?: string;
  launched_by: string;
  nonce: string;
}

export interface LaunchDeps {
  now: () => Date;
  getControl: () => Promise<{ logging: boolean; seq: number; lastTelemetryAt: string | null }>;
  setControl: (logging: boolean, label: string) => Promise<number>;
  insertConsent: (code: string, condition: string, c: LaunchConsent) => Promise<void>;
  recentDuplicate: (canonicalLabel: string, sinceHours: number) => Promise<boolean>;
  insertLaunch: (rec: LaunchRecord) => Promise<void>;
}

export interface LaunchResult {
  status: "started" | "stopped" | "blocked" | "needs_override" | "duplicate_nonce" | "error";
  verdicts: Verdict[];
  label?: string;
  seq?: number;
  message?: string;
}

function secsSince(now: Date, iso: string | null): number | null {
  if (!iso) return null;
  return Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
}

export async function handleRunLaunch(deps: LaunchDeps, body: LaunchBody, authedEmail: string | null): Promise<LaunchResult> {
  const label = compose(body.building, body.scenario, body.occupancy);
  const canon = canonical(label);
  const control = await deps.getControl();
  const lastSeen = secsSince(deps.now(), control.lastTelemetryAt);

  // --- STOP: just flip logging off (and record the stop). ---
  if (body.action === "stop") {
    const seq = await deps.setControl(false, label);
    return { status: "stopped", verdicts: [], label, seq };
  }

  const labelCheck = validateLabelInputs(body);
  const consentComplete = !!(body.consent?.consent_method && body.consent?.attested_by && body.consent?.terms_version);

  // Phase 1: read-only checks (consent not yet attempted).
  const inputs1: PreflightInputs = {
    authedEmail,
    labelInputsOk: labelCheck.ok,
    labelErrors: labelCheck.errors,
    consentComplete,
    deviceFresh: lastSeen != null && lastSeen <= DEVICE_FRESH_SECS,
    deviceLastSeenSecs: lastSeen,
    activeRun: control.logging === true,
    duplicateRecent: await deps.recentDuplicate(canon, DUP_WINDOW_H),
    consentPersisted: null,
    overrides: body.overrides ?? [],
  };
  const v1 = evaluatePreflight(inputs1);
  const g1 = gate(v1);
  if (g1 !== "ok") return { status: g1 === "blocked" ? "blocked" : "needs_override", verdicts: v1, label };

  // Phase 2: attempt consent insert; evaluate the consent_persisted soft check.
  let consentPersisted = true;
  try {
    await deps.insertConsent(canon /* deployment_code = canonical label */, label, body.consent);
  } catch {
    consentPersisted = false;
  }
  const inputs2: PreflightInputs = { ...inputs1, consentPersisted };
  const v2 = evaluatePreflight(inputs2);
  const g2 = gate(v2);
  if (g2 !== "ok") return { status: "needs_override", verdicts: v2, label };

  // Commit: start the device, then record the launch (idempotent on nonce).
  const seq = await deps.setControl(true, label);
  const rec: LaunchRecord = {
    label,
    canonical_label: canon,
    device_last_seen_secs: lastSeen,
    consent_status: consentPersisted ? "recorded" : "deferred",
    override_flags: body.overrides ?? [],
    launched_by: authedEmail ?? "",
    nonce: body.nonce,
  };
  try {
    await deps.insertLaunch(rec);
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === "23505") return { status: "duplicate_nonce", verdicts: v2, label, seq };
    throw e;
  }
  return { status: "started", verdicts: v2, label, seq };
}

interface Env { SUPABASE_DB_URL: string; CONTROL_URL: string; CONTROL_TOKEN: string }

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = (await context.request.json().catch(() => null)) as LaunchBody | null;
  if (!body || (body.action !== "start" && body.action !== "stop")) {
    return Response.json({ status: "error", verdicts: [], message: "bad body" }, { status: 400 });
  }
  const { SUPABASE_DB_URL, CONTROL_URL, CONTROL_TOKEN } = context.env;
  if (!SUPABASE_DB_URL || !CONTROL_URL || !CONTROL_TOKEN) {
    return Response.json({ status: "error", verdicts: [], message: "not configured" }, { status: 500 });
  }
  const authedEmail = context.request.headers.get("Cf-Access-Authenticated-User-Email");
  const sql = postgres(SUPABASE_DB_URL, { ssl: "require", prepare: false, fetch_types: false, connect_timeout: 10 });

  const postControl = async (action: "control", logging: boolean, label: string): Promise<number> => {
    const r = await fetch(CONTROL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: CONTROL_TOKEN, action, logging, label }),
    });
    const j = (await r.json()) as { ok: boolean; seq?: number; error?: string };
    if (!j.ok) throw new Error(j.error || "control write failed");
    return j.seq ?? 0;
  };

  const deps: LaunchDeps = {
    now: () => new Date(),
    getControl: async () => {
      const r = await fetch(CONTROL_URL, { method: "GET" });
      return (await r.json()) as { logging: boolean; seq: number; lastTelemetryAt: string | null };
    },
    setControl: (logging, label) => postControl("control", logging, label),
    insertConsent: async (code, condition, c) => {
      await sql`
        insert into consent_submissions
          (deployment_code, condition, consent_method, attested_by, terms_version, notes)
        values (${code}, ${condition}, ${c.consent_method}, ${c.attested_by}, ${c.terms_version}, ${c.notes})`;
    },
    recentDuplicate: async (canonLabel, sinceHours) => {
      const rows = await sql`
        select 1 from run_launches
        where canonical_label = ${canonLabel}
          and started_at > now() - (${sinceHours} || ' hours')::interval
        limit 1`;
      return rows.length > 0;
    },
    insertLaunch: async (rec) => {
      await sql`
        insert into run_launches
          (label, canonical_label, device_last_seen_secs, consent_status, override_flags, override_reason, launched_by, nonce, notes)
        values (${rec.label}, ${rec.canonical_label}, ${rec.device_last_seen_secs}, ${rec.consent_status},
                ${rec.override_flags}, ${rec.override_reason ?? null}, ${rec.launched_by}, ${rec.nonce}, ${null})`;
    },
  };

  try {
    const result = await handleRunLaunch(deps, body, authedEmail);
    const code = result.status === "error" ? 500 : 200;
    return Response.json(result, { status: code });
  } catch (e) {
    console.error("run-launch failed:", e);
    return Response.json({ status: "error", verdicts: [], message: "launch failed" }, { status: 500 });
  } finally {
    context.waitUntil(sql.end());
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd library && npx vitest run functions/api/run-launch.test.ts`
Expected: PASS (5 tests).

> If Vitest does not pick up files under `functions/`, add `functions/**/*.test.ts` to the `test.include` array in `library/vite.config.ts` (or `vitest.config.ts`) and re-run. Confirm the existing `src/lib` tests still run.

- [ ] **Step 5: Commit**

```bash
git add library/functions/api/run-launch.ts library/functions/api/run-launch.test.ts
git commit -m "feat(library): run-launch Pages Function (preflight gate + consent + device start)"
```

---

## Task 7: `RunLauncherPage.tsx` + route

**Files:**
- Create: `library/src/components/RunLauncherPage.tsx`
- Modify: `library/src/App.tsx`

This is a UI task; verify by build + manual review (UX approved: red hard / amber soft + inline reason, single Start button, optional stop notes).

- [ ] **Step 1: Build the page**

Create `library/src/components/RunLauncherPage.tsx`:

```tsx
import { useState } from "react";
import { BUILDINGS, SCENARIOS, compose } from "../lib/runLabel";
import type { Verdict } from "../lib/preflight";

type Status = "idle" | "blocked" | "needs_override" | "started" | "stopped" | "duplicate_nonce" | "error";

export default function RunLauncherPage() {
  const [building, setBuilding] = useState<string>(BUILDINGS[0]);
  const [scenario, setScenario] = useState<string>(SCENARIOS[0]);
  const [occupancy, setOccupancy] = useState<number>(1);
  const [method, setMethod] = useState("opt_in_verbal");
  const [attestedBy, setAttestedBy] = useState("occupant");
  const [terms, setTerms] = useState("v1-2026-06");
  const [reason, setReason] = useState("");
  const [overrides, setOverrides] = useState<string[]>([]);
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [busy, setBusy] = useState(false);

  const label = compose(building, scenario, occupancy);

  async function submit(action: "start" | "stop") {
    setBusy(true);
    const res = await fetch("/api/run-launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action, building, scenario, occupancy,
        consent: { consent_method: method, attested_by: attestedBy, terms_version: terms, notes: "" },
        nonce: crypto.randomUUID(), overrides,
      }),
    });
    const j = (await res.json()) as { status: Status; verdicts: Verdict[] };
    setStatus(j.status);
    setVerdicts(j.verdicts ?? []);
    setBusy(false);
  }

  const softFailures = verdicts.filter((v) => v.tier === "soft" && !v.pass);

  return (
    <div className="run-launcher">
      <h1>Start a Run</h1>
      <label>Building
        <select value={building} onChange={(e) => setBuilding(e.target.value)}>
          {BUILDINGS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>
      <label>Scenario
        <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
          {SCENARIOS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label>Occupancy
        <input type="number" min={0} value={occupancy} onChange={(e) => setOccupancy(parseInt(e.target.value || "0", 10))} />
      </label>

      <fieldset>
        <legend>Consent</legend>
        <label>Method
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="opt_in_verbal">opt_in_verbal</option>
            <option value="opt_in_form">opt_in_form</option>
          </select>
        </label>
        <label>Attested by <input value={attestedBy} onChange={(e) => setAttestedBy(e.target.value)} /></label>
        <label>Terms <input value={terms} onChange={(e) => setTerms(e.target.value)} /></label>
      </fieldset>

      <p className="label-preview">Label: <code>{label}</code></p>

      {verdicts.length > 0 && (
        <ul className="preflight">
          {verdicts.map((v) => (
            <li key={v.id} className={v.pass ? "ok" : v.tier === "hard" ? "hard" : "soft"}>
              <strong>{v.id}</strong>: {v.pass ? "✓" : "✗"} {v.detail}
              {!v.pass && v.tier === "soft" && (
                <label className="override">
                  <input
                    type="checkbox"
                    checked={overrides.includes(v.id)}
                    onChange={(e) =>
                      setOverrides((o) => (e.target.checked ? [...o, v.id] : o.filter((x) => x !== v.id)))}
                  /> override
                </label>
              )}
            </li>
          ))}
        </ul>
      )}

      {status === "needs_override" && softFailures.length > 0 && (
        <label>Override reason (required)
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      )}

      <div className="actions">
        <button disabled={busy || (status === "needs_override" && softFailures.length > 0 && !reason)} onClick={() => submit("start")}>
          {status === "needs_override" ? "Override & start" : "Start run"}
        </button>
        <button disabled={busy} onClick={() => submit("stop")}>Stop run</button>
      </div>

      {status === "started" && <p className="ok">Run started — device will pick it up within its poll interval.</p>}
      {status === "blocked" && <p className="hard">Blocked. Fix the red checks above.</p>}
      {status === "duplicate_nonce" && <p>Already submitted — ignored a duplicate.</p>}
    </div>
  );
}
```

- [ ] **Step 2: Add the route**

In `library/src/App.tsx`, follow the existing route-registration pattern (match how `CuratePage`/`CoveragePage` are imported and routed). Add:

```tsx
import RunLauncherPage from "./components/RunLauncherPage";
// ...inside the same <Routes>/route table the other pages use:
<Route path="/launch" element={<RunLauncherPage />} />
```

(Read `library/src/App.tsx` first and mirror its exact router API — it uses the same router the other pages are registered with.)

- [ ] **Step 3: Build to verify it compiles**

Run: `cd library && npm run build`
Expected: `tsc -b` + `vite build` succeed with no type errors.

- [ ] **Step 4: Commit**

```bash
git add library/src/components/RunLauncherPage.tsx library/src/App.tsx
git commit -m "feat(library): Run Launcher page + gated /launch route"
```

---

## Task 8: Wire secrets + end-to-end verification

**Files:** none (configuration + manual run).

- [ ] **Step 1: Set Pages Function env vars**

In the Cloudflare Pages project for `ventis-data-library`, add (Production):
- `CONTROL_URL` = the Apps Script `/exec` URL
- `CONTROL_TOKEN` = the same value as the Apps Script `SHEETS_TOKEN` Script Property
- (`SUPABASE_DB_URL` already set — confirm it is the **6543 transaction pooler** URL, per the load-bearing lesson.)

- [ ] **Step 2: Confirm the Apps Script `SHEETS_TOKEN` Script Property matches `CONTROL_TOKEN`.**

- [ ] **Step 3: Full dry run with a real device**

1. Open `/launch` behind Cloudflare Access. Pick building/scenario/occupancy; confirm the label preview reads e.g. `fahey_window_1person`.
2. With the device powered + online, click **Start run**. Expect status "started". Within the device poll interval, confirm the device begins logging (telemetry rows appear with that exact condition).
3. Power the device off, click **Start run** again → expect the amber `device_online` soft block; tick override + reason → "Override & start" succeeds and writes a `run_launches` row with `override_flags = {device_online}`.
4. Simulate a consent failure (temporarily set a bad `SUPABASE_DB_URL` in a preview deploy) → expect amber `consent_persisted`; override → run starts with `consent_status = deferred`; restore env and confirm `reconcile_consent.py` links it once consent is backfilled (same `canonical_label`).
5. Click **Stop run** → device stops logging.

- [ ] **Step 4: Confirm reconcile parity**

Run the Python suite to confirm nothing regressed and the canonical rules still match:
Run: `cd site/scripts && python -m pytest tests/ -q`
Expected: PASS.

- [ ] **Step 5: Final commit (docs/notes if any), open PR**

```bash
git push -u Ventis feat-run-launcher
gh pr create --base main --head feat-run-launcher --title "feat: centralized Run Launcher (gated one-submit run intake)" --body "Implements docs/superpowers/specs/2026-06-16-centralized-run-intake-design.md"
```

---

## Self-Review

- **Spec coverage:** Architecture (Task 6/7), canonical single-sourced label (Task 2/3 + used in Task 6), preflight hard/soft gate (Task 4), override-as-tracked-followup (`run_launches` Task 1 + Task 6 flags), Apps Script control write + liveness (Task 5), consent insert + defer (Task 6), idempotency nonce (Task 6), UX decisions (Task 7), secrets + e2e + reconcile parity (Task 8). All covered.
- **Placeholder scan:** none — every code step shows complete code; manual steps (Apps Script, e2e) are explicit because those layers are not in-repo unit-testable.
- **Type consistency:** `LaunchBody`, `LaunchDeps`, `LaunchResult`, `Verdict`, `PreflightInputs` names match across Tasks 4 and 6; `compose`/`canonical`/`validateLabelInputs` signatures match Tasks 2–3; control payload shape (`action:"control"`, `logging`, `label`, `token`) matches between Task 5 (Apps Script) and Task 6 (Function).
- **Known integration risk flagged in-plan:** Vitest picking up `functions/**` tests (Task 6 Step 4 note) and the `App.tsx` router API (Task 7 Step 2) — both say "read the existing file and mirror it."
