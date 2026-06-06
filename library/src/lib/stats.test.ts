import { describe, it, expect } from "vitest";
import { datasetStats } from "./stats";
import { searchRuns } from "./catalog";
import type { Run } from "./catalog";

const runs: Run[] = [
  { run_id: "a", building: "choates", condition: "choates_baseline_1person", occupancy: 1, co2_peak: 1100, ashrae_exceed: true, n_rows: 100, duration_h: 2, date: "2026-06-01" } as Run,
  { run_id: "b", building: "fahey", condition: "fahey_window_1person", occupancy: 1, co2_peak: 700, ashrae_exceed: false, n_rows: 200, duration_h: 3, date: "2026-06-02" } as Run,
  { run_id: "c", building: "fahey", condition: "fahey_baseline_2person", occupancy: 2, co2_peak: 950, ashrae_exceed: false, n_rows: 50, duration_h: 1, date: "2026-05-30" } as Run,
];

describe("datasetStats", () => {
  it("aggregates headline numbers", () => {
    const s = datasetStats(runs);
    expect(s.nRuns).toBe(3);
    expect(s.nBuildings).toBe(2); // choates, fahey
    expect(s.totalRows).toBe(350);
    expect(s.deviceHours).toBe(6);
    expect(s.ashraeExceedRate).toBeCloseTo(1 / 3, 3);
    expect(s.co2PeakMax).toBe(1100);
    expect(s.dateRange).toEqual(["2026-05-30", "2026-06-02"]);
  });
  it("handles empty", () => {
    expect(datasetStats([]).nRuns).toBe(0);
    expect(datasetStats([]).dateRange).toBeNull();
  });
});

describe("searchRuns", () => {
  it("matches across building + condition", () => {
    expect(searchRuns(runs, "fahey").length).toBe(2);
    expect(searchRuns(runs, "window").length).toBe(1);
    expect(searchRuns(runs, "").length).toBe(3);
    expect(searchRuns(runs, "nope").length).toBe(0);
  });
});
