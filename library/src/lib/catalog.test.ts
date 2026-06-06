import { describe, it, expect } from "vitest";
import { filterRuns, sortRuns, type Run } from "./catalog";

const runs: Run[] = [
  { run_id: "a", building: "choates", occupancy: 1, co2_peak: 1100, date: "2026-06-01" } as Run,
  { run_id: "b", building: "fahey", occupancy: 2, co2_peak: 700, date: "2026-06-02" } as Run,
];

describe("catalog utils", () => {
  it("filters by building", () => {
    expect(filterRuns(runs, { building: "choates" }).length).toBe(1);
  });
  it("sorts by co2_peak desc", () => {
    expect(sortRuns(runs, "co2_peak", "desc")[0].run_id).toBe("a");
  });
});
