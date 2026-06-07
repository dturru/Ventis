import { useState } from "react";
import { useSearchParams } from "react-router-dom";

const TERMS_VERSION = "v1-2026-06";

export default function Consent() {
  const [params] = useSearchParams();
  const code = (params.get("code") || "").trim();
  // condition rides in the QR the cofounder generates (anonymized label, safe in a URL).
  // It is what reconcile_consent matches a submission to its run on.
  const condition = (params.get("c") || params.get("condition") || "").trim();
  const [mode, setMode] = useState<"occupant" | "assisted">("occupant");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [err, setErr] = useState("");

  const valid = /^VEN-\w{3,8}$/.test(code);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending"); setErr("");
    const method = mode === "occupant" ? "opt_in_form" : "opt_in_verbal";
    const attested_by = mode === "occupant" ? "occupant" : "founder";
    try {
      const r = await fetch("/api/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, condition, method, attested_by, terms_version: TERMS_VERSION }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "failed");
      setState("done");
    } catch (e: any) { setErr(e.message || "Something went wrong"); setState("error"); }
  }

  if (!valid) {
    return (
      <main className="page wrap" style={{ maxWidth: 620 }}>
        <p className="eyebrow">Consent</p>
        <h1 className="section-title">This link needs a deployment code</h1>
        <p className="lede">Please use the link or QR code provided with the Ventis logger in
          your room. If you reached this page by mistake, you can close it.</p>
      </main>
    );
  }

  if (state === "done") {
    return (
      <main className="page wrap" style={{ maxWidth: 620 }}>
        <p className="eyebrow">Consent recorded</p>
        <h1 className="section-title">Thank you</h1>
        <p className="lede">Your opt-in is recorded for deployment <strong>{code}</strong>.
          Ventis measures CO&#x2082;, temperature, and humidity only. No names, rooms, or identifying
          information are stored. To opt out at any time, email us and we will remove the run.</p>
      </main>
    );
  }

  return (
    <main className="page wrap" style={{ maxWidth: 620 }}>
      <p className="eyebrow">Consent · {code}</p>
      <h1 className="section-title">Join the Ventis air-quality study</h1>
      <p className="lede">A Ventis logger in this room measures <strong>CO&#x2082;, temperature, and
        humidity</strong> over a few days. We store <strong>no names, no room numbers, and no
        identifying information</strong>. The data is anonymized and you can opt out at any time.</p>

      <div className="card" style={{ marginTop: 16 }}>
        <div role="radiogroup" aria-label="Who is confirming consent"
             style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button type="button" className={mode === "occupant" ? "btn btn-primary" : "btn btn-ghost"}
                  aria-pressed={mode === "occupant"} onClick={() => setMode("occupant")}>
            I live here
          </button>
          <button type="button" className={mode === "assisted" ? "btn btn-primary" : "btn btn-ghost"}
                  aria-pressed={mode === "assisted"} onClick={() => setMode("assisted")}>
            Ventis team (assisted)
          </button>
        </div>
        <form onSubmit={submit}>
          {/* honeypot: real people leave this empty; hidden from view + AT */}
          <input type="text" name="website" tabIndex={-1} autoComplete="off"
                 aria-hidden="true" style={{ display: "none" }} />
          <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 14 }}>
            {mode === "occupant"
              ? "By tapping Agree, you opt in to anonymized data collection in this room."
              : "Confirm the occupant was informed and verbally agreed before submitting."}
          </p>
          <button type="submit" className="btn btn-primary" disabled={state === "sending"}>
            {state === "sending" ? "Recording…" : "I agree"}
          </button>
          {state === "error" && (
            <p role="alert" style={{ color: "var(--red)", marginTop: 12 }}>
              {err}. Please try again, or contact the Ventis team.
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
