import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { loadCatalog, type Run } from "../lib/catalog";

export default function RunDetail() {
  const { run_id } = useParams<{ run_id: string }>();
  const [run, setRun] = useState<Run | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    loadCatalog()
      .then((runs) => {
        const found = runs.find((r) => (r.run_id || r.run_key) === run_id);
        if (found) setRun(found);
        else setNotFound(true);
      })
      .catch(() => setNotFound(true));
  }, [run_id]);

  if (notFound)
    return (
      <div style={wrap}>
        <Link to="/">← back</Link>
        <p style={{ marginTop: 16 }}>Run not found: {run_id}</p>
      </div>
    );
  if (!run) return <div style={wrap}>Loading…</div>;

  const stats: [string, React.ReactNode][] = [
    ["Building", run.building || "—"],
    ["Condition", run.condition || "—"],
    ["Occupancy", run.occupancy ?? "—"],
    ["Window", run.window_state || "—"],
    ["Start", run.start || "—"],
    ["End", run.end || "—"],
    ["Duration (h)", run.duration_h ?? "—"],
    ["Readings", run.n_rows ?? "—"],
    ["CO₂ mean (ppm)", run.co2_mean ?? "—"],
    [
      "CO₂ peak (ppm)",
      <>
        {run.co2_peak ?? "—"}
        {run.ashrae_exceed && <span style={badge}>ASHRAE &gt; 1000</span>}
      </>,
    ],
    ["Consent", run.consent || "—"],
    ["Run ID", run.run_id || run.run_key],
  ];

  return (
    <div style={wrap}>
      <Link to="/">← back to catalog</Link>
      <h1 style={{ fontSize: 22, margin: "12px 0 4px" }}>
        {run.building || run.condition || "Run"}
      </h1>
      <p style={{ color: "var(--muted)", marginBottom: 12 }}>{run.date}</p>

      <a
        href={`/data/csv/${run.csv}`}
        download={run.csv}
        style={{
          display: "inline-block",
          marginBottom: 20,
          padding: "6px 14px",
          borderRadius: 6,
          border: "1px solid var(--green)",
          color: "var(--green)",
          fontSize: 14,
        }}
      >
        ⬇ Download raw CSV
      </a>

      <img
        src={`/data/charts/${run.chart}`}
        alt={`CO₂ chart for ${run.condition}`}
        style={{
          maxWidth: "100%",
          borderRadius: 8,
          boxShadow: "var(--shadow)",
          background: "var(--tile)",
          marginBottom: 24,
        }}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "max-content 1fr",
          gap: "8px 20px",
          background: "var(--tile)",
          padding: 20,
          borderRadius: 8,
          boxShadow: "var(--shadow)",
        }}
      >
        {stats.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <div style={{ color: "var(--muted)" }}>{k}</div>
            <div>{v}</div>
          </div>
        ))}
      </div>

      {run.notes && (
        <div style={{ marginTop: 20, lineHeight: 1.5 }}>
          <h2 style={{ fontSize: 16, marginBottom: 6, color: "var(--green)" }}>
            Notes
          </h2>
          <p>{run.notes}</p>
        </div>
      )}
    </div>
  );
}

const wrap: React.CSSProperties = { maxWidth: 820, margin: "0 auto", padding: 24 };
const badge: React.CSSProperties = {
  marginLeft: 8,
  fontSize: 11,
  padding: "2px 6px",
  borderRadius: 4,
  background: "var(--red-light)",
  color: "var(--red)",
};
