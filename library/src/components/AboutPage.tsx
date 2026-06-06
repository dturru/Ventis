import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { loadCatalog, type Run } from "../lib/catalog";
import { downloadDataset } from "../lib/exportDataset";

const COLS: [string, string][] = [
  ["timestamp", "Local time, YYYY-MM-DD HH:MM:SS"],
  ["co2_ppm", "CO₂ in ppm — Sensirion SCD4x, ±50 ppm"],
  ["temp_c", "Indoor temperature (°C)"],
  ["humidity_pct", "Relative humidity (%)"],
  ["fan_duty", "Device fan duty, 0–100 (%)"],
  ["window_state", "open / closed / blank if not logged"],
  ["condition", "building_condition_occupancy (anonymized — never names/room numbers)"],
];

export default function AboutPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadCatalog().then(setRuns).catch(() => {});
  }, []);

  async function onExport() {
    setBusy(true);
    try {
      await downloadDataset(runs);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: 24, lineHeight: 1.55 }}>
      <Link to="/">← back to catalog</Link>
      <h1 style={{ fontSize: 22, margin: "12px 0 8px" }}>About this dataset</h1>
      <p style={{ color: "var(--muted)", marginBottom: 20 }}>
        Each run is one continuous logging session in a single room and condition. Labels
        are anonymized as <code>building_condition_occupancy</code> — never names or room numbers.
      </p>

      <h2 style={h2}>Methodology</h2>
      <p>
        Readings are sampled on-device (~30 s cadence) and streamed to a private Google Sheet,
        then synced into a durable SQLite system of record and charted with a standard
        3-panel SOP (CO₂ with ASHRAE 1000 / 1400 ppm reference lines and a ±50 ppm error band,
        indoor temperature, and relative humidity, on a shared time-of-day axis). Missing-channel
        readings are stored as null, not zero.
      </p>

      <h2 style={h2}>Data dictionary (CSV columns)</h2>
      <div style={{ background: "var(--tile)", border: "1px solid var(--border)", borderRadius: 8, padding: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {COLS.map(([c, d]) => (
              <tr key={c}>
                <td style={{ padding: "6px 12px 6px 0", color: "var(--green)", whiteSpace: "nowrap", verticalAlign: "top", fontFamily: "monospace" }}>{c}</td>
                <td style={{ padding: "6px 0", color: "var(--fg)" }}>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={h2}>Reference levels</h2>
      <ul style={{ paddingLeft: 20 }}>
        <li><strong>ASHRAE ~1000 ppm</strong> — indoor CO₂ ventilation guidance.</li>
        <li><strong>~1400 ppm</strong> — cognitive-impairment threshold (decision-making).</li>
      </ul>

      <h2 style={h2}>Export</h2>
      <p style={{ marginBottom: 12 }}>
        Download the full dataset — <code>catalog.json</code>, every run's raw CSV, and this dictionary — as one zip.
      </p>
      <button
        onClick={onExport}
        disabled={busy || !runs.length}
        style={{
          padding: "8px 16px",
          borderRadius: 6,
          border: "none",
          background: "var(--green)",
          color: "#fff",
          fontSize: 14,
          opacity: busy || !runs.length ? 0.6 : 1,
        }}
      >
        {busy ? "Packaging…" : `⬇ Download full dataset (${runs.length} runs)`}
      </button>
    </div>
  );
}

const h2: React.CSSProperties = { fontSize: 16, color: "var(--green)", margin: "22px 0 6px" };
