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

export interface CheckpointHelp {
  what: string; // plain-language meaning of the failure
  fix: string;  // how the operator resolves it
}

// Operator-facing help for each checkpoint, shown in the form when a check fails.
// Every id that evaluatePreflight can emit MUST have an entry here (guarded by a test).
export const CHECKPOINT_HELP: Record<string, CheckpointHelp> = {
  auth: {
    what: "You are not signed in through Cloudflare Access.",
    fix: "Open the data-library URL and sign in with your authorized team account (not a direct or incognito link that bypasses Access), then reload.",
  },
  label: {
    what: "The run label is not well-formed.",
    fix: "Choose a building and scenario, and enter occupancy as a number or word. The label preview should read like `fahey_window_1person` — lowercase letters, numbers, and underscores only.",
  },
  consent_captured: {
    what: "The consent details are incomplete.",
    fix: "Fill the Consent section: method (verbal or form), who attested (occupant or your pseudonym), and the terms version.",
  },
  device_online: {
    what: "The device has not reported telemetry recently, so it may be offline.",
    fix: "Power it on, confirm Wi-Fi, and wait ~30–90s for it to report, then retry. If you know it is about to come online, override with a reason — it will pick up the start command on its next poll.",
  },
  no_active_run: {
    what: "A run is already logging on the device.",
    fix: "Stop the current run first (Stop run), or override with a reason if this is an intentional restart (e.g. after a brownout).",
  },
  not_duplicate: {
    what: "An identical label was launched in the last 6 hours (usually a double-submit).",
    fix: "Confirm this is not a repeat. If it is a legitimate repeat run, override with a reason.",
  },
  consent_persisted: {
    what: "The consent record failed to save to the database (often a brief pooler timeout).",
    fix: "Retry in a moment. If it keeps failing, override to defer — the run starts now and the consent backfills and reconciles later by the matching label.",
  },
};
