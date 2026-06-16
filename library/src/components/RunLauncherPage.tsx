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
        nonce: crypto.randomUUID(), overrides, override_reason: reason,
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
