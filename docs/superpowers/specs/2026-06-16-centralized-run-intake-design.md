# Centralized Run Intake — "Run Launcher" Design

**Date:** 2026-06-16
**Status:** Approved design (brainstorming → spec)
**Owner:** Diego (remote) / cofounder (on-campus operator)

## Problem

Starting a data-collection run today touches several disconnected surfaces:

1. The **condition label** is set on the device (telemetry `run`/`condition`) **and** typed again into the **consent** submission — independently.
2. `reconcile_consent.py` fuzzy-matches the two by `canonical(condition)` + nearest start time (±36 h).
3. When the two labels diverge (post-brownout restart re-typed a glued `oneperson`, etc.) the match fails → **orphaned consent**, the exact bug class fixed in PRs #15 and #25.

The operator also hops between the Google Sheet, the consent form, and manual run notes. We want **one gated submission** that records consent, sets the run condition, starts the device, and captures run notes — with the condition **single-sourced** so divergence is structurally impossible.

## Goals

- One cofounder-facing, gated action starts a fully-described, consented run.
- The condition label is composed once from structured fields and used for **both** the device control tab and the consent row → identical by construction → deterministic reconcile.
- A **preflight checkpoint gate** blocks a run when starting it would create a problem, but allows an **audited override** for problems that are safe to fix after the run (orphaned/deferred consent being the canonical case).
- Firmware is **unchanged** — it already polls the Apps Script control tab.

## Non-Goals

- Occupant self-serve / public form (operator is cofounder-only, behind Cloudflare Access).
- Changing how the device polls or how telemetry is written.
- Replacing `reconcile_consent.py` (it stays; it just stops failing because labels can't diverge).

## Architecture (Approach A — page in the gated `library/` app)

The Run Launcher lives in `library/`, which is already behind Cloudflare Access and already has Pages Functions talking to Supabase (`functions/api/annotate.ts`). No new deploy target or Access config.

```
[Cofounder phone]
  RunLauncherPage.tsx  (gated by Cloudflare Access)
        │ POST /api/run-launch  {fields, action, nonce, overrides[]}
        ▼
  functions/api/run-launch.ts  (Pages Function; holds secrets)
        │  1. compose canonical label (label.ts)
        │  2. preflight(...)  → verdicts (pure: preflight.ts)
        │  3. gate: hard-block abort | soft-block needs override | proceed
        │  4. insert consent  → Supabase (postgres.js)        [S3]
        │  5. start device    → Apps Script control doPost     (token)
        │  6. persist launch record (override flags + reason)
        ▼                                   ▼
  Supabase  consent_submissions      Google Sheet `control` tab
  + run_launches                      (logging, label, seq++)
                                            ▼ device polls doGet (existing)
                                      Device starts run, telemetry tagged
                                      with the SAME canonical label
```

### Components

| Component | Path | Responsibility |
|---|---|---|
| `RunLauncherPage.tsx` | `library/src/components/` | Form + live preflight checklist + Start/Stop. Visual/UX — see open questions. |
| `run-launch.ts` | `library/functions/api/` | Orchestrator: compose → preflight → gate → consent insert → device start → launch record. Holds `SUPABASE_DB_URL` + `CONTROL_TOKEN`. |
| `preflight.ts` | `library/functions/api/` | **Pure planner** (mirrors `plan_reconcile`): inputs → per-checkpoint verdicts + tier. Independently unit-tested. |
| `label.ts` | `library/src/lib/` + shared | Compose structured fields → canonical label; reject invalid combos. Mirrors `reconcile_consent.canonical()` rules so output is canonical by construction. |
| Apps Script control write | `firmware/sheets/Code.gs` | Extend `doPost` with `action:"control"`: token-auth (reuse `SHEETS_TOKEN`), set `control` tab `logging`/`label`, bump `seq`. Only genuinely new backend piece. |
| `run_launches` table | `site/scripts/supabase_schema.sql` | Audit row per launch: label, times, consent status, override flags + reason. The "needs attention" surface. |

## Canonical label (the divergence killer)

Structured fields → one string, used everywhere:

- **building** — dropdown of known buildings (`fahey`, `choates`, `little`, `east_wheelock`, …). Closed set.
- **scenario** — dropdown (`window`, `windowclosed`, `fan`, `baseline`, `negcontrol`, …). Closed set.
- **occupancy** — stepper emitting a **digit** (`1`, `2`, …) → `Nperson`. Never a spelled-out word.

Composed: `building_scenario_Nperson` (e.g. `fahey_window_1person`). The composed string must round-trip through the shared `canonical()` unchanged (a hard checkpoint). Because the *same* string is written to the control tab (→ device telemetry `condition`) and to `consent_submissions.condition`, `canonical()` of both is trivially equal and `match_run` is deterministic. The occupancy-as-digit rule encodes the convention from PR #25's follow-up directly into the UI.

## Preflight checkpoint gate

Run server-side in `preflight.ts`. Two tiers.

### Hard blocks — never overridable (cheap to fix, root-cause preventers)

- **H1 Authenticated** — `Cf-Access-Authenticated-User-Email` present (verified founder, as in `annotate.ts`).
- **H2 Valid canonical label** — building ∈ set, scenario ∈ set, occupancy is a positive integer; composed label round-trips through `canonical()` unchanged.
- **H3 Consent captured** — `attested_by`, `consent_method`, `terms_version` present (the *act* of consent is recorded; whether it *persists* is S3).

If any hard block fails: **abort with no mutation**, return what to fix. Start stays disabled.

### Soft blocks — overridable with explicit reason (logged, flags run for follow-up)

- **S1 Device online** — device posted telemetry within `DEVICE_FRESH_WINDOW` (default 90 s ≈ 3× the ~30 s cadence). Stale → telemetry may orphan. Override: device may catch the `seq` on reconnect.
- **S2 No active run** — control tab `logging` already true / a `run_id` active. Override: intentional restart (the post-brownout case).
- **S3 Consent persisted** — the Supabase insert succeeded. Failure (pooler timeout — LESSON (a)) → override "defer consent": start the run, flag consent pending, backfill later. **Reconcile links it automatically by the identical canonical label + time.** This is the override the user explicitly asked for.
- **S4 Duplicate guard** — identical canonical label launched within `DUP_WINDOW_H` (default 6 h). Override: legitimate repeat.

Override mechanics: each soft block surfaces in the form; the operator types a **reason** and confirms "Override & start." Every overridden run writes a `run_launches` row with the overridden checks + reason + timestamp, so it surfaces in a "needs attention" view (Curate/Coverage). **An override is a tracked follow-up, never a silent bypass.**

## Data flow & sequencing (orphan-safe)

1. Compose canonical label.
2. Run non-mutating checks: H1–H3, S1, S2, S4.
3. Attempt consent insert → result feeds S3.
4. **Gate:** any HARD fail → abort, no device start. Only SOFT fails and not overridden → abort, offer override. Clean or fully-overridden → proceed.
5. Start device: Apps Script control `doPost` (`logging=true`, `label`, `seq++`).
6. Persist `run_launches` record (label, started_at, device_last_seen, consent_status, override_flags, reason, nonce).

**Self-healing:** device-condition and consent-condition are the same canonical string, so `reconcile_consent` links them deterministically. Even a deferred-consent (S3 override) run reconciles automatically once consent is backfilled with that label. The divergence bug class is structurally impossible.

**Idempotency:** the client sends a launch `nonce`. Apps Script dedupes a repeated nonce (no double `seq` bump); consent insert dedupes on `(deployment_code, condition, recent agreed_at)`. Protects against double-submit / retries.

## Error handling

- **Apps Script start fails** (network/timeout): run NOT started; report to operator. If consent was already inserted it simply stays unreconciled until a matching run appears (or the operator retries) — harmless, self-heals. No orphan.
- **Supabase insert fails**: S3 soft block → defer-consent override path.
- **Partial failure** (consent ok, control fails): no orphan — consent without a run is an expected unreconciled row that links when the run later starts with the same label.
- **Apps Script control token invalid**: 401 from the endpoint; surfaced as a hard failure (misconfiguration), run not started.

## Security

- Form gated by Cloudflare Access; identity from `Cf-Access-Authenticated-User-Email`.
- Apps Script control write is token-authed with the existing `SHEETS_TOKEN` Script Property; the token lives only in the Pages Function env (`CONTROL_TOKEN`) — never shipped to the browser.
- No occupant PII: `attested_by` stays `occupant` or a founder pseudonym, per existing convention.

## Testing (TDD)

- **`preflight.ts`** (core): table of input states → expected verdicts + tiers (each hard/soft block, override resolution).
- **`label.ts`**: fields → canonical label; reject unknown building/scenario; enforce digit occupancy; assert round-trip equals `canonical()`.
- **`run-launch.ts`** (mock Supabase + Apps Script): clean start; hard-block abort (no mutation); soft-block-without-override abort; override path writes flags; partial-failure no-orphan; idempotent double-submit (same nonce).
- **Apps Script `doPost` control**: token reject; `seq` bump; start/stop set `logging` + `label`.
- Parity check: `label.ts` canonical output matches `reconcile_consent.canonical()` on a shared fixture set (prevents the TS and Python rules drifting).

## UX decisions (resolved 2026-06-16)

1. **Preflight panel** — hard blocks render **red** and disable Start; soft blocks render **amber** with an inline reason field + "Override & start."
2. **Start flow** — a single **Start run** button runs preflight, then either starts or reveals blocks/overrides inline (no separate preflight click).
3. **Stop-run notes** — Stop ends the run immediately; an **optional** notes field captures door/placement notes when available (appended via the existing annotate path). Never blocks ending a run.
4. **Dropdown contents** (editable defaults; `other` always falls back to a free-text field that must pass `canonical()` validation):
   - **building:** `fahey`, `choates`, `little`, `east_wheelock`, `mid_mass`, `summit`, `apt`, `other`
   - **scenario:** `baseline`, `window`, `windowclosed`, `fan`, `fan_window`, `negcontrol`, `other`
   - **occupancy:** stepper, integer ≥ 0, emitted as `Nperson`

## Rollout

- Additive only; firmware untouched. Ships when the `library/` app redeploys (Cloudflare Pages).
- Sequence: schema (`run_launches`) → Apps Script control `doPost` + Script Property/env wiring → `label.ts`/`preflight.ts` (pure, TDD) → `run-launch.ts` → `RunLauncherPage.tsx` → manual end-to-end with a real device.
