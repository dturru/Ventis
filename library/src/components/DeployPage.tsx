import { useState } from "react";
import { Link } from "react-router-dom";
import { buildConsentUrl, normalizeCondition, randomCode } from "../lib/deploy";

const card: React.CSSProperties = {
  background: "var(--tile)", border: "1px solid var(--border)", borderRadius: 8, padding: 18,
};
const label: React.CSSProperties = {
  display: "block", fontSize: 13, color: "var(--muted)", margin: "12px 0 4px",
};
const input: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)",
  background: "var(--tile-alt)", color: "inherit", fontSize: 14, boxSizing: "border-box",
};
const btn: React.CSSProperties = {
  padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border)",
  background: "var(--tile-alt)", color: "inherit", fontSize: 14, cursor: "pointer", whiteSpace: "nowrap",
};
const code: React.CSSProperties = {
  fontFamily: "monospace", background: "var(--tile-alt)", padding: "1px 5px", borderRadius: 4,
};

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
    <div style={{ maxWidth: 760, margin: "0 auto", padding: 24, lineHeight: 1.55 }}>
      <Link to="/">← back to catalog</Link>
      <h1 style={{ fontSize: 22, margin: "12px 0 4px" }}>Deployment QR generator</h1>
      <p style={{ color: "var(--muted)", marginBottom: 12 }}>
        Make the consent link and QR for a logger placement. The occupant scans it to opt in;
        the same link also covers the assisted mode (the form has a toggle).
      </p>

      <div style={{ ...card, borderColor: "var(--red)", background: "var(--red-light)", marginBottom: 14 }}>
        <strong style={{ color: "var(--red)" }}>The condition must match the run.</strong> Use the
        SAME condition label here and in the Sheet <code style={code}>control</code> tab. Format is{" "}
        <code style={code}>building_condition_occupancy</code>, lowercase, no names or room numbers.
        A mismatch means the opt-in never links to the run.
      </div>

      <div style={card}>
        <label style={label}>Deployment code</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input style={input} value={dcode} onChange={(e) => setDcode(e.target.value)} />
          <button style={btn} onClick={() => setDcode(randomCode())}>New code</button>
        </div>

        <label style={label}>Condition label</label>
        <input
          style={input}
          placeholder="fahey_window_1person"
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
        />
        {condition.trim() && (
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>
            will be sent as <code style={code}>{norm || "(none)"}</code>
          </p>
        )}

        <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "16px 0" }} />

        {norm ? (
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
            <img
              src={qr}
              width={200}
              height={200}
              alt={`Consent QR for ${dcode}`}
              style={{ background: "#fff", borderRadius: 8, padding: 8 }}
            />
            <div style={{ flex: "1 1 260px", minWidth: 240 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Consent link</div>
              <code style={{ ...code, display: "block", padding: 10, wordBreak: "break-all", fontSize: 13 }}>
                {url}
              </code>
              <button style={{ ...btn, marginTop: 10 }} onClick={copy}>
                {copied ? "Copied" : "Copy link"}
              </button>
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
                Print or show the QR at the placement, and start the run in the Sheet with code{" "}
                <code style={code}>{dcode}</code> and condition <code style={code}>{norm}</code>.
              </p>
            </div>
          </div>
        ) : (
          <p style={{ color: "var(--muted)" }}>Enter a condition label to generate the QR.</p>
        )}
      </div>
    </div>
  );
}
