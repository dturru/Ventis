import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { loadCatalog, type Run } from "../lib/catalog";
import { downloadDataset } from "../lib/exportDataset";

const COLS: [string, string][] = [
  ["timestamp", "Local time, YYYY-MM-DD HH:MM:SS"],
  ["co2_ppm", "CO₂ in ppm. Sensirion SCD4x, ±50 ppm"],
  ["temp_c", "Indoor temperature (°C)"],
  ["humidity_pct", "Relative humidity (%)"],
  ["fan_duty", "Device fan duty, 0–100 (%)"],
  ["window_state", "open / closed / blank if not logged"],
  ["condition", "building_condition_occupancy (anonymized, never names or room numbers)"],
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
    <main className="lib-main">
      <div className="wrap" style={{ maxWidth: 760 }}>
        <Link to="/" className="back-link"><span className="arr">←</span> back to catalog</Link>
        <div className="eyebrow">Dataset</div>
        <h1 className="page-title">About this dataset</h1>

        <div className="prose">
          <p>
            Each run is one continuous logging session in a single room and condition. Labels are
            anonymized as <code>building_condition_occupancy</code>, never names or room numbers.
          </p>

          <h2>Methodology</h2>
          <p>
            Readings are sampled on-device (~30 s cadence) and streamed to a private Google Sheet,
            then synced into a durable SQLite system of record and charted with a standard 3-panel
            SOP (CO₂ with ASHRAE 1000 / 1400 ppm reference lines and a ±50 ppm error band, indoor
            temperature, and relative humidity, on a shared time-of-day axis). Missing-channel
            readings are stored as null, not zero.
          </p>

          <h2>Data dictionary</h2>
        </div>

        <div className="doc-card">
          <table className="data-dict">
            <tbody>
              {COLS.map(([c, d]) => (
                <tr key={c}>
                  <td className="k">{c}</td>
                  <td className="d">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="prose">
          <h2>Reference levels</h2>
          <ul>
            <li><strong>ASHRAE ~1000 ppm</strong>: indoor CO₂ ventilation guidance.</li>
            <li><strong>~1400 ppm</strong>: cognitive-impairment threshold (decision-making).</li>
          </ul>

          <h2>Export</h2>
          <p>
            Download the full dataset (<code>catalog.json</code>, every run's raw CSV, and this
            dictionary) as one zip.
          </p>
        </div>

        <button className="btn btn-primary" onClick={onExport} disabled={busy || !runs.length}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M12 3v12" strokeLinecap="round" />
            <path d="M7 11l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5 21h14" strokeLinecap="round" />
          </svg>
          {busy ? "Packaging…" : `Download full dataset (${runs.length} runs)`}
        </button>
      </div>
    </main>
  );
}
