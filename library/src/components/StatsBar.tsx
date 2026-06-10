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
    ["Peak CO₂ (ppm)", s.co2PeakMax != null ? String(s.co2PeakMax) : "·"],
  ];
  return (
    <div className="stat-grid">
      {tiles.map(([label, val]) => (
        <div className="stat" key={label}>
          <div className="stat-k">{val}</div>
          <div className="stat-l">{label}</div>
        </div>
      ))}
    </div>
  );
}
