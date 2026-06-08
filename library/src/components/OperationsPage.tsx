import { Link } from "react-router-dom";

const h2: React.CSSProperties = { fontSize: 17, color: "var(--green)", margin: "26px 0 8px" };
const card: React.CSSProperties = {
  background: "var(--tile)", border: "1px solid var(--border)", borderRadius: 8, padding: 18,
};
const code: React.CSSProperties = { fontFamily: "monospace", background: "var(--tile-alt)", padding: "1px 5px", borderRadius: 4 };

export default function OperationsPage() {
  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: 24, lineHeight: 1.55 }}>
      <Link to="/">← back to catalog</Link>
      <h1 style={{ fontSize: 22, margin: "12px 0 4px" }}>Operations & SOPs</h1>
      <p style={{ color: "var(--muted)", marginBottom: 12 }}>
        The single shared runbook for deploying loggers and capturing runs. Both founders;
        always current. (Quick field version lives in the Sheet <code style={code}>guide</code> tab.)
      </p>

      <div style={{ ...card, borderColor: "var(--red)", background: "var(--red-light)" }}>
        <strong style={{ color: "var(--red)" }}>Cardinal rule — anonymization.</strong> Condition labels are{" "}
        <code style={code}>building_condition_occupancy</code>, lowercase, no spaces. <strong>NEVER</strong> a
        person's name or room number. The dataset's promise — and its legal footing — is that it
        contains no identifying information. The Sheet enforces the safe shape on ingest, but the
        operator must never type a name in the first place.
      </div>

      <h2 style={h2}>Logger deployment SOP</h2>
      <div style={card}>
        <ol style={{ paddingLeft: 20, margin: 0 }}>
          <li><strong>Prep:</strong> device charged/powered; confirm it joins the network (or its own AP).</li>
          <li><strong>Place:</strong> on a surface ~desk height, away from direct breath/vents/windows.</li>
          <li><strong>Consent:</strong> get the occupant's opt-in (see below) <em>before</em> logging. Record it in the consent ledger.</li>
          <li><strong>Deployment code + QR:</strong> generate the consent link and QR on the{" "}
            <Link to="/deploy">Deployment QR generator</Link> (pick a <code style={code}>VEN-####</code>
            code, type the condition label). The link is{" "}
            <code style={code}>ventis.vercel.app/consent?code=VEN-####&c=&lt;condition_label&gt;</code>.
            Show the occupant the QR for self-serve, or open it on your phone for the assisted opt-in.
            <strong> Use the exact same condition label here and in the <code style={code}>control</code>
            tab below</strong> — that match is what links the opt-in to this run during reconciliation.</li>
          <li><strong>Start / stop — the <code style={code}>control</code> tab is a single-row register, ONLY row 2 matters:</strong>
            <ul style={{ paddingLeft: 18 }}>
              <li><code style={code}>A2</code> = logging → <code style={code}>TRUE</code> to start, <code style={code}>FALSE</code> to stop</li>
              <li><code style={code}>B2</code> = the condition label</li>
              <li><code style={code}>C2</code> = <code style={code}>seq</code> → <strong>bump to a NEW higher number every command</strong> (the device only acts when seq increases; survives reflash)</li>
            </ul>
            Nothing happening? You edited the wrong row, or didn't bump <code style={code}>seq</code>.
          </li>
          <li><strong>Handoff:</strong> after a run, run <code style={code}>/ventis-backup</code> (refreshes the dataset + off-machine backup).</li>
        </ol>
      </div>

      <h2 style={h2}>Consent SOP</h2>
      <div style={card}>
        <p style={{ marginTop: 0 }}>
          Every run must have a recorded consent basis <em>before</em> it counts as part of the dataset.
          Anonymization protects privacy; the <strong>consent ledger</strong> makes consent <em>verifiable</em>.
        </p>
        <p><strong>Accepted methods</strong> (record one per run):</p>
        <ul style={{ paddingLeft: 20 }}>
          <li><code style={code}>occupant_self</code> — your own room.</li>
          <li><code style={code}>opt_in_verbal</code> — occupant verbally agreed, informed it's anonymized + opt-out-able.</li>
          <li><code style={code}>opt_in_written</code> / <code style={code}>opt_in_form</code> — signed/checkbox.</li>
          <li><code style={code}>building_program</code> — collected under an institution-approved opt-in program (e.g. ResLife).</li>
        </ul>
        <p><strong>Record it</strong> (keyed by the run, never the person):</p>
        <pre style={{ ...code, display: "block", padding: 12, whiteSpace: "pre-wrap" }}>
python site/scripts/consent_ledger.py --set &lt;run_key&gt; \
  --method opt_in_verbal --date 2026-05-21 --terms v1-2026-06 --by diego
        </pre>
        <p>
          Verify the whole dataset before publishing/diligence:{" "}
          <code style={code}>python site/scripts/consent_ledger.py --validate</code> (exits non-zero if any run is unverified).
          The ledger lives with the dataset (off the public site) and graduates to the Supabase{" "}
          <code style={code}>consent</code> table.
        </p>
      </div>

      <h2 style={h2}>Data plotting SOP</h2>
      <div style={card}>
        Standard chart = stacked CO₂ / temp / RH on a shared time-of-day axis. CO₂ panel shows ASHRAE
        1000 + 1400 ppm lines and a ±50 ppm error band; fan-ON spans shaded; −1 readings → null (not zero).
        Generated by <code style={code}>plot_ventis_run.py</code>. Column definitions: see the{" "}
        <Link to="/about">data dictionary</Link>.
      </div>

      <h2 style={h2}>Annotating runs</h2>
      <div style={card}>
        Add a note or quality flag to a run (e.g. a hardware hiccup, or "exclude from figures"):
        <pre style={{ ...code, display: "block", padding: 12, whiteSpace: "pre-wrap" }}>
python site/scripts/annotate.py --set &lt;run_key&gt; --note "fan died ~2am" --flag caution --by diego
        </pre>
        Flags: <code style={code}>good</code> / <code style={code}>caution</code> /{" "}
        <code style={code}>exclude</code>. Shows on the run detail + table at the next catalog build.
      </div>
    </div>
  );
}
