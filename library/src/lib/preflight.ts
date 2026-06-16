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
