import { datasetStats } from "../lib/stats";
import type { Run } from "../lib/catalog";

export default function StatsBar({ runs }: { runs: Run[] }) {
  const s = datasetStats(runs);
  const tiles: [string, string][] = [
    ["Runs", String(s.nRuns)],
    ["Buildings", String(s.nBuildings)],
    ["Readings", s.totalRows.toLocaleString()],
    ["Device-hours", String(s.deviceHours)],
    ["ASHRAE-exceed", `${Math.round(s.ashraeExceedRate * 100)}%`],
    ["Peak CO₂", s.co2PeakMax != null ? `${s.co2PeakMax} ppm` : "—"],
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
        gap: 10,
        marginBottom: 20,
      }}
    >
      {tiles.map(([label, val]) => (
        <div
          key={label}
          style={{
            background: "var(--tile)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "12px 14px",
            boxShadow: "var(--shadow)",
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 600, color: "var(--green)" }}>{val}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
        </div>
      ))}
    </div>
  );
}
