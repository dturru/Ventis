import type { Run } from "./catalog";

export interface DatasetStats {
  nRuns: number;
  nBuildings: number;
  buildings: string[];
  totalRows: number;
  deviceHours: number;
  ashraeExceedRate: number; // fraction of runs whose CO2 peak > 1000
  co2PeakMax: number | null;
  dateRange: [string, string] | null;
}

/** Aggregate headline stats across the catalog — "the moat at a glance". */
export function datasetStats(runs: Run[]): DatasetStats {
  const buildings = Array.from(
    new Set(runs.map((r) => r.building).filter(Boolean))
  ).sort();
  const rows = runs.reduce((s, r) => s + (r.n_rows || 0), 0);
  const hours = runs.reduce((s, r) => s + (r.duration_h || 0), 0);
  const exceed = runs.filter((r) => r.ashrae_exceed).length;
  const peaks = runs.map((r) => r.co2_peak).filter((v): v is number => v != null);
  const dates = runs.map((r) => r.date).filter(Boolean).sort();
  return {
    nRuns: runs.length,
    nBuildings: buildings.length,
    buildings,
    totalRows: rows,
    deviceHours: Math.round(hours * 10) / 10,
    ashraeExceedRate: runs.length ? exceed / runs.length : 0,
    co2PeakMax: peaks.length ? Math.max(...peaks) : null,
    dateRange: dates.length ? [dates[0], dates[dates.length - 1]] : null,
  };
}
