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
