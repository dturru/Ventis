import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { loadCatalog, type Run } from "../lib/catalog";
import { FLAG_OPTIONS, postAnnotation, unannotatedFirst } from "../lib/annotate";

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
  background: "var(--tile-alt)", color: "inherit", fontSize: 14, cursor: "pointer",
};

export default function CuratePage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState("");
  const [note, setNote] = useState("");
  const [flag, setFlag] = useState("");
  const [tags, setTags] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [err, setErr] = useState("");

  useEffect(() => {
    loadCatalog().then((rs) => setRuns(unannotatedFirst(rs))).catch(() => setRuns([]));
  }, []);

  const current = useMemo(
    () => runs.find((r) => r.run_key === selected),
    [runs, selected],
  );

  // When a run is picked, prefill the form from its existing annotation.
  useEffect(() => {
    if (!current) return;
    setNote(current.note ?? "");
    setFlag(current.quality_flag ?? "");
    setTags(current.tags ?? "");
    setState("idle"); setErr("");
  }, [current]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setState("saving"); setErr("");
    try {
      await postAnnotation({ run_key: selected, note, quality_flag: flag, tags });
      setState("done");
    } catch (e: any) {
      setErr(e.message || "Something went wrong"); setState("error");
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: 24, lineHeight: 1.55 }}>
      <Link to="/">← back to catalog</Link>
      <h1 style={{ fontSize: 22, margin: "12px 0 4px" }}>Curate run annotations</h1>
      <p style={{ color: "var(--muted)", marginBottom: 12 }}>
        Set a quality flag and note on a run. Saves immediately; the flag appears in the
        catalog on the next hourly build. Runs without a flag are listed first.
      </p>

      <div style={{ ...card, background: "var(--tile-alt)", marginBottom: 16, fontSize: 13,
                    color: "var(--muted)" }}>
        <strong style={{ color: "inherit" }}>Saving here is paused.</strong> The database write needs the
        Cloudflare Workers Paid plan (the free tier's per-request limit blocks it). Until we upgrade,
        curate in the <strong>Supabase Table Editor</strong> → <code>annotations</code> table — it lands in
        the same place and shows in the catalog on the next hourly build. This page is built and ready;
        it goes live the day we upgrade.
      </div>

      <form onSubmit={submit} style={card}>
        <label style={label} htmlFor="run">Run</label>
        <select id="run" style={input} value={selected}
                onChange={(e) => setSelected(e.target.value)}>
          <option value="">— pick a run —</option>
          {runs.map((r) => (
            <option key={r.run_key} value={r.run_key}>
              {r.quality_flag ? `[${r.quality_flag}] ` : "[ — ] "}{r.condition} · {r.date}
            </option>
          ))}
        </select>

        <label style={label} htmlFor="flag">Quality flag</label>
        <select id="flag" style={input} value={flag}
                onChange={(e) => setFlag(e.target.value)} disabled={!selected}>
          {FLAG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <label style={label} htmlFor="note">Note</label>
        <textarea id="note" style={{ ...input, minHeight: 80, resize: "vertical" }}
                  placeholder="e.g. window cracked open ~2am; fan ran all night"
                  value={note} onChange={(e) => setNote(e.target.value)} disabled={!selected} />

        <label style={label} htmlFor="tags">Tags (comma-separated, optional)</label>
        <input id="tags" style={input} placeholder="hardware, window-experiment"
               value={tags} onChange={(e) => setTags(e.target.value)} disabled={!selected} />

        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <button type="submit" style={btn} disabled={!selected || state === "saving"}>
            {state === "saving" ? "Saving…" : "Save annotation"}
          </button>
          {state === "done" && (
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              Saved — appears in the catalog within the hour.
            </span>
          )}
          {state === "error" && (
            <span role="alert" style={{ color: "var(--red)", fontSize: 13 }}>{err}</span>
          )}
        </div>
      </form>
    </div>
  );
}
