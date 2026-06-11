import { describe, it, expect } from "vitest";
import { unannotatedFirst, FLAG_OPTIONS } from "./annotate";
import type { Run } from "./catalog";

const runs = [
  { run_key: "a", condition: "fahey_window_1p", quality_flag: "caution" } as Run,
  { run_key: "b", condition: "little_baseline_1p", quality_flag: "" } as Run,
  { run_key: "c", condition: "ew_fan_2p" } as Run, // no flag field at all
];

describe("unannotatedFirst", () => {
  it("puts runs with no flag before flagged runs", () => {
    const ordered = unannotatedFirst(runs);
    expect(ordered.map((r) => r.run_key)).toEqual(["b", "c", "a"]);
  });
  it("does not mutate the input array", () => {
    const copy = [...runs];
    unannotatedFirst(runs);
    expect(runs).toEqual(copy);
  });
});

describe("FLAG_OPTIONS", () => {
  it("offers clear/good/caution/exclude", () => {
    expect(FLAG_OPTIONS.map((o) => o.value)).toEqual(["", "good", "caution", "exclude"]);
  });
});
