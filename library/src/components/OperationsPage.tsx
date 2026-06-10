import { Link } from "react-router-dom";

export default function OperationsPage() {
  return (
    <main className="lib-main">
      <div className="wrap" style={{ maxWidth: 820 }}>
        <Link to="/" className="back-link"><span className="arr">←</span> back to catalog</Link>
        <div className="eyebrow">Runbook</div>
        <h1 className="page-title">Operations &amp; SOPs</h1>
        <p className="page-lede">
          The single shared runbook for deploying loggers and capturing runs. Both founders;
          always current. (Quick field version lives in the Sheet <code className="code">guide</code> tab.)
        </p>

        <div className="prose">
          <div className="callout red">
            <strong>Cardinal rule — anonymization.</strong> Condition labels are{" "}
            <code>building_condition_occupancy</code>, lowercase, no spaces. <strong>NEVER</strong> a
            person's name or room number. The dataset's promise, and its legal footing, is that it
            contains no identifying information. The Sheet enforces the safe shape on ingest, but the
            operator must never type a name in the first place.
          </div>

          <h2>Solo collection — the weekly loop</h2>
          <div className="doc-card">
            <p>
              Collection runs on campus without Diego (remote for the term). The data lands durably on
              its own. Your job ends at <strong>"device logging to the Sheet, with consent recorded."</strong>{" "}
              Everything after that (system of record, catalog, backup) is automatic.
            </p>
            <ol>
              <li><strong>Place</strong> a logger at breathing height, out of direct draft/breath.</li>
              <li><strong>Consent first</strong>: occupant scans the deploy QR and opts in. No run counts until consent exists.</li>
              <li><strong>Start</strong> the run (device, or <code>control</code> row 2, bump <code>seq</code>). Label = <code>building_condition_occupancy</code>.</li>
              <li><strong>Run ≥ overnight</strong>; it auto-resumes through reboots/Wi-Fi drops.</li>
              <li><strong>Stop</strong> cleanly; send Diego the label + context (window/door/occupancy/placement).</li>
            </ol>
            <p>
              Target <strong>1–2 clean runs/week</strong>. Priority gaps: replicate the hero conditions in a
              new building; a clean negative control; a continuous multi-night run; an occupancy gradient
              (1 vs 2 vs 3 people, room held constant). Always capture temp + RH, not CO₂ alone.
            </p>
            <p>
              <strong>Ping Diego</strong> if: a device won't flash / new Wi-Fi, no rows landing after start,
              you're unsure a label or consent is valid, catalog login breaks, or a new building / staff
              contact appears (that's a lead, not just a run).
            </p>
          </div>

          <h2>Logger deployment SOP</h2>
          <div className="doc-card">
            <ol>
              <li><strong>Prep:</strong> device charged/powered; confirm it joins the network (or its own AP).</li>
              <li><strong>Place:</strong> on a surface ~desk height, away from direct breath/vents/windows.</li>
              <li><strong>Consent:</strong> get the occupant's opt-in (see below) <em>before</em> logging. Record it in the consent ledger.</li>
              <li>
                <strong>Deployment code + QR:</strong> generate the consent link and QR on the{" "}
                <Link to="/deploy">Deployment QR generator</Link> (pick a <code>VEN-####</code> code, type
                the condition label). The link is{" "}
                <code>{"ventis.vercel.app/consent?code=VEN-####&c=<condition_label>"}</code>. Show the
                occupant the QR for self-serve, or open it on your phone for the assisted opt-in.{" "}
                <strong>Use the exact same condition label here and in the <code>control</code> tab below</strong>;
                that match is what links the opt-in to this run during reconciliation.
              </li>
              <li>
                <strong>Start / stop — the <code>control</code> tab is a single-row register, ONLY row 2 matters:</strong>
                <ul>
                  <li><code>A2</code> = logging → <code>TRUE</code> to start, <code>FALSE</code> to stop</li>
                  <li><code>B2</code> = the condition label</li>
                  <li><code>C2</code> = <code>seq</code> → <strong>bump to a NEW higher number every command</strong> (the device only acts when seq increases; survives reflash)</li>
                </ul>
                Nothing happening? You edited the wrong row, or didn't bump <code>seq</code>.
              </li>
              <li><strong>Handoff:</strong> after a run, run <code>/ventis-backup</code> (refreshes the dataset + off-machine backup).</li>
            </ol>
          </div>

          <h2>Consent SOP</h2>
          <div className="doc-card">
            <p>
              Every run must have a recorded consent basis <em>before</em> it counts as part of the dataset.
              Anonymization protects privacy; the <strong>consent ledger</strong> makes consent <em>verifiable</em>.
            </p>
            <p><strong>Accepted methods</strong> (record one per run):</p>
            <ul>
              <li><code>occupant_self</code>: your own room.</li>
              <li><code>opt_in_verbal</code>: occupant verbally agreed, informed it's anonymized + opt-out-able.</li>
              <li><code>opt_in_written</code> / <code>opt_in_form</code>: signed/checkbox.</li>
              <li><code>building_program</code>: collected under an institution-approved opt-in program (e.g. ResLife).</li>
            </ul>
            <p><strong>Record it</strong> (keyed by the run, never the person):</p>
            <pre className="pre">{`python site/scripts/consent_ledger.py --set <run_key> \\
  --method opt_in_verbal --date 2026-05-21 --terms v1-2026-06 --by diego`}</pre>
            <p>
              Verify the whole dataset before publishing/diligence:{" "}
              <code>python site/scripts/consent_ledger.py --validate</code> (exits non-zero if any run is
              unverified). The ledger lives with the dataset (off the public site) and graduates to the
              Supabase <code>consent</code> table.
            </p>
          </div>

          <h2>Data plotting SOP</h2>
          <div className="doc-card">
            <p style={{ margin: 0 }}>
              Standard chart = stacked CO₂ / temp / RH on a shared time-of-day axis. CO₂ panel shows ASHRAE
              1000 + 1400 ppm lines and a ±50 ppm error band; fan-ON spans shaded; −1 readings → null (not
              zero). Generated by <code>plot_ventis_run.py</code>. Column definitions: see the{" "}
              <Link to="/about">data dictionary</Link>.
            </p>
          </div>

          <h2>Annotating runs</h2>
          <div className="doc-card">
            <p>Add a note or quality flag to a run (e.g. a hardware hiccup, or "exclude from figures"):</p>
            <pre className="pre">{`python site/scripts/annotate.py --set <run_key> --note "fan died ~2am" --flag caution --by diego`}</pre>
            <p style={{ marginBottom: 0 }}>
              Flags: <code>good</code> / <code>caution</code> / <code>exclude</code>. Shows on the run detail
              + table at the next catalog build.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
