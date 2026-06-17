import { useState } from "react";
import { BUILDINGS, SCENARIOS, compose, parseOccupancy } from "../lib/runLabel";
import { CHECKPOINT_HELP, type Verdict } from "../lib/preflight";
import { buildEndFields, type EndCapture } from "../lib/endFields";

type Status = "idle" | "blocked" | "needs_override" | "started" | "stopped" | "duplicate_nonce" | "error";

export default function RunLauncherPage() {
  const [building, setBuilding] = useState<string>(BUILDINGS[0]);
  const [scenario, setScenario] = useState<string>(SCENARIOS[0]);
  const [occupancyInput, setOccupancyInput] = useState<string>("1");
  const [method, setMethod] = useState("opt_in_verbal");
  const [attestedBy, setAttestedBy] = useState("occupant");
  const [terms, setTerms] = useState("v1-2026-06");
  const [reason, setReason] = useState("");
  const [overrides, setOverrides] = useState<string[]>([]);
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [busy, setBusy] = useState(false);

  // End-of-run capture (shown behind the "End run" confirmation checkpoint).
  const [ending, setEnding] = useState(false);
  const [endWindow, setEndWindow] = useState("open");
  const [endDoor, setEndDoor] = useState("closed");
  const [endVisitors, setEndVisitors] = useState(false);
  const [endPlacement, setEndPlacement] = useState("breathing");
  const [endPower, setEndPower] = useState("usb");
  const [endDeviation, setEndDeviation] = useState(false);
  const [endQuality, setEndQuality] = useState("good");
  const [endNote, setEndNote] = useState("");
  const [endStage, setEndStage] = useState<"conditions" | "review">("conditions");

  const occupancy = parseOccupancy(occupancyInput); // number | null (accepts "2" or "two")
  const label = occupancy != null ? compose(building, scenario, occupancy) : null;

  function currentCapture(): EndCapture {
    return {
      window: endWindow, door: endDoor, occupancy: occupancy ?? -1, visitors: endVisitors,
      placement: endPlacement, power: endPower, deviation: endDeviation, quality: endQuality, note: endNote,
    };
  }
  // The exact categorization that will be written — same function the backend runs.
  const endPreview = buildEndFields(currentCapture());

  function openEnd() { setEnding(true); setEndStage("conditions"); }
  function cancelEnd() { setEnding(false); setEndStage("conditions"); }

  async function submit(action: "start" | "stop", endCapture?: EndCapture) {
    setBusy(true);
    const res = await fetch("/api/run-launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action, building, scenario, occupancy: occupancy ?? -1,
        consent: { consent_method: method, attested_by: attestedBy, terms_version: terms, notes: "" },
        nonce: crypto.randomUUID(), overrides, override_reason: reason, endCapture,
      }),
    });
    const j = (await res.json()) as { status: Status; verdicts: Verdict[] };
    setStatus(j.status);
    setVerdicts(j.verdicts ?? []);
    setBusy(false);
    if (action === "stop") { setEnding(false); setEndStage("conditions"); }
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
        <input
          type="text"
          inputMode="numeric"
          value={occupancyInput}
          placeholder="e.g. 2 or two"
          onChange={(e) => setOccupancyInput(e.target.value)}
        />
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

      <p className="label-preview">
        {label != null
          ? <>Label: <code>{label}</code></>
          : <span className="hard">Enter occupancy as a number or word (e.g. 2 or two)</span>}
      </p>

      {verdicts.length > 0 && (
        <ul className="preflight">
          {verdicts.map((v) => (
            <li key={v.id} className={v.pass ? "ok" : v.tier === "hard" ? "hard" : "soft"}>
              <strong>{v.id}</strong>: {v.pass ? "✓" : "✗"} {v.detail}
              {!v.pass && CHECKPOINT_HELP[v.id] && (
                <p className="checkpoint-help">
                  {CHECKPOINT_HELP[v.id].what} <em>How to fix:</em> {CHECKPOINT_HELP[v.id].fix}
                </p>
              )}
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
        <button disabled={busy || occupancy == null || (status === "needs_override" && softFailures.length > 0 && !reason)} onClick={() => submit("start")}>
          {status === "needs_override" ? "Override & start" : "Start run"}
        </button>
        <button className="end-run-btn" disabled={busy || ending} onClick={openEnd}>End run…</button>
      </div>

      {ending && endStage === "conditions" && (
        <fieldset className="end-run">
          <legend>End run — step 1 of 2: conditions</legend>
          <p className="hard">
            This will stop logging on <code>{label ?? "(set the run above)"}</code>. First record the
            run's final conditions — next you'll review exactly how they categorize the run before anything is written.
          </p>
          <label>Window (final / during run)
            <select value={endWindow} onChange={(e) => setEndWindow(e.target.value)}>
              <option value="open">open</option>
              <option value="closed">closed</option>
              <option value="changed">changed mid-run</option>
            </select>
          </label>
          <label>Door
            <select value={endDoor} onChange={(e) => setEndDoor(e.target.value)}>
              <option value="closed">closed</option>
              <option value="open">open</option>
            </select>
          </label>
          <label>Sensor placement
            <select value={endPlacement} onChange={(e) => setEndPlacement(e.target.value)}>
              <option value="breathing">breathing height</option>
              <option value="floor">floor</option>
              <option value="desk">desk</option>
              <option value="near_window">near window</option>
            </select>
          </label>
          <label>Power source
            <select value={endPower} onChange={(e) => setEndPower(e.target.value)}>
              <option value="usb">clean USB</option>
              <option value="12v">12V supply</option>
              <option value="ext_cord">extension cord</option>
            </select>
          </label>
          <label>Quality
            <select value={endQuality} onChange={(e) => setEndQuality(e.target.value)}>
              <option value="good">good</option>
              <option value="caution">caution (soft upper bound)</option>
              <option value="exclude">exclude</option>
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={endVisitors} onChange={(e) => setEndVisitors(e.target.checked)} /> daytime visitors observed</label>
          <label className="check"><input type="checkbox" checked={endDeviation} onChange={(e) => setEndDeviation(e.target.checked)} /> other SOP deviation</label>
          <label>Notes
            <input value={endNote} onChange={(e) => setEndNote(e.target.value)} placeholder="anything else worth recording" />
          </label>
          <div className="actions">
            <button className="cancel" disabled={busy} onClick={cancelEnd}>Cancel</button>
            <button disabled={busy || occupancy == null} onClick={() => setEndStage("review")}>Review categorization →</button>
          </div>
        </fieldset>
      )}

      {ending && endStage === "review" && (
        <fieldset className="end-run">
          <legend>End run — step 2 of 2: review categorization</legend>
          <p className="hard">
            Ending <code>{label}</code> will stop logging and write this categorization to the catalog.
            Check it's right — go back to fix any input.
          </p>
          <dl className="end-review">
            <div><dt>Quality flag</dt><dd>{endPreview.quality_flag || <em>none</em>}</dd></div>
            <div><dt>Window</dt><dd>{endPreview.window}</dd></div>
            <div><dt>Occupancy</dt><dd>{endPreview.occupancy >= 0 ? endPreview.occupancy : <em>not set</em>}</dd></div>
            <div><dt>Tags</dt><dd className="tag-row">{endPreview.tags.split(",").map((t) => <span key={t} className="tag">{t}</span>)}</dd></div>
            <div><dt>Note</dt><dd>{endPreview.note}</dd></div>
          </dl>
          <div className="actions">
            <button className="cancel" disabled={busy} onClick={() => setEndStage("conditions")}>← Back to conditions</button>
            <button disabled={busy} onClick={() => submit("stop", currentCapture())}>Confirm &amp; end run</button>
          </div>
        </fieldset>
      )}

      {status === "started" && <p className="ok">Run started — device will pick it up within its poll interval.</p>}
      {status === "stopped" && <p className="ok">Run ended — logging stopped and the end-of-run capture was recorded for categorization.</p>}
      {status === "blocked" && <p className="hard">Blocked. Fix the red checks above.</p>}
      {status === "duplicate_nonce" && <p>Already submitted — ignored a duplicate.</p>}
    </div>
  );
}
