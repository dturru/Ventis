import { useState } from "react";
import { Link } from "react-router-dom";
import { buildConsentUrl, normalizeCondition, randomCode } from "../lib/deploy";

export default function DeployPage() {
  const [dcode, setDcode] = useState(randomCode());
  const [condition, setCondition] = useState("");
  const [copied, setCopied] = useState(false);

  const norm = normalizeCondition(condition);
  const url = buildConsentUrl(dcode, condition);
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=8&data=${encodeURIComponent(url)}`;

  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <main className="lib-main">
      <div className="wrap" style={{ maxWidth: 760 }}>
        <Link to="/" className="back-link"><span className="arr">←</span> back to catalog</Link>
        <div className="eyebrow">Founders</div>
        <h1 className="page-title">Deployment QR generator</h1>
        <p className="page-lede">
          Make the consent link and QR for a logger placement. The occupant scans it to opt in;
          the same link also covers the assisted mode (the form has a toggle).
        </p>

        <div className="callout red" style={{ marginTop: 18 }}>
          <strong>The condition must match the run.</strong> Use the SAME condition label here and in
          the Sheet <code className="code">control</code> tab. Format is{" "}
          <code className="code">building_condition_occupancy</code>, lowercase, no names or room
          numbers. A mismatch means the opt-in never links to the run.
        </div>

        <div className="doc-card">
          <label className="form-label">Deployment code</label>
          <div className="form-row">
            <input className="lib-input" value={dcode} onChange={(e) => setDcode(e.target.value)} />
            <button className="btn btn-ghost" onClick={() => setDcode(randomCode())}>New code</button>
          </div>

          <label className="form-label">Condition label</label>
          <input
            className="lib-input"
            placeholder="fahey_window_1person"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
          />
          {condition.trim() && (
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "5px 0 0" }}>
              will be sent as <code className="code">{norm || "(none)"}</code>
            </p>
          )}

          <hr className="rule" />

          {norm ? (
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
              <img
                src={qr}
                width={200}
                height={200}
                alt={`Consent QR for ${dcode}`}
                style={{ background: "#fff", borderRadius: 12, padding: 8, boxShadow: "var(--shadow)" }}
              />
              <div style={{ flex: "1 1 260px", minWidth: 240 }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 5 }}>Consent link</div>
                <code className="code" style={{ display: "block", padding: 10, wordBreak: "break-all", fontSize: 13 }}>
                  {url}
                </code>
                <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={copy}>
                  {copied ? "Copied" : "Copy link"}
                </button>
                <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
                  Print or show the QR at the placement, and start the run in the Sheet with code{" "}
                  <code className="code">{dcode}</code> and condition <code className="code">{norm}</code>.
                </p>
              </div>
            </div>
          ) : (
            <p style={{ color: "var(--muted)" }}>Enter a condition label to generate the QR.</p>
          )}
        </div>
      </div>
    </main>
  );
}
