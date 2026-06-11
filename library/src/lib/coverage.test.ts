import { describe, it, expect } from "vitest";
import {
  occBucket,
  buildingCoverage,
  collectionPriorities,
  coverageSummary,
  RANKING_GATE_N,
} from "./coverage";
import type { Run } from "./catalog";

const mk = (p: Partial<Run>): Run => ({ run_key: Math.random().toString(36), ...p } as Run);

describe("occBucket", () => {
  it("buckets occupancy honestly, treating null as unlabeled", () => {
    expect(occBucket(0)).toBe("empty");
    expect(occBucket(1)).toBe("single");
    expect(occBucket(2)).toBe("multi");
    expect(occBucket(5)).toBe("multi");
    expect(occBucket(null)).toBe("unknown");
    expect(occBucket(undefined)).toBe("unknown");
  });
});

describe("buildingCoverage", () => {
  const runs = [
    mk({ building: "fahey", occupancy: 1, window: "open", consent_status: "verified" }),
    mk({ building: "fahey", occupancy: 1, window: "closed", consent_status: "unverified" }),
    mk({ building: "little", occupancy: 2, window: "", consent_status: "unverified" }),
    mk({ building: "", occupancy: null, window: "", consent_status: "unverified" }),
  ];

  it("counts runs per building", () => {
    const cov = buildingCoverage(runs);
    expect(cov.find((c) => c.building === "fahey")!.n).toBe(2);
    expect(cov.find((c) => c.building === "little")!.n).toBe(1);
  });

  it("tracks both window states for ventilation pairing", () => {
    const fahey = buildingCoverage(runs).find((c) => c.building === "fahey")!;
    expect(fahey.hasWindowOpen).toBe(true);
    expect(fahey.hasWindowClosed).toBe(true);
    const little = buildingCoverage(runs).find((c) => c.building === "little")!;
    expect(little.hasWindowOpen).toBe(false);
    expect(little.hasWindowClosed).toBe(false);
  });

  it("counts missing consent and missing occupancy", () => {
    const fahey = buildingCoverage(runs).find((c) => c.building === "fahey")!;
    expect(fahey.missingConsent).toBe(1);
    const blank = buildingCoverage(runs).find((c) => c.building === "")!;
    expect(blank.missingOccupancy).toBe(1);
  });

  it("sinks the unresolved-building bucket to the bottom", () => {
    expect(buildingCoverage(runs).at(-1)!.building).toBe("");
  });

  it("flags ranking-ready only at the gate", () => {
    const big = Array.from({ length: RANKING_GATE_N }, () => mk({ building: "summit" }));
    const cov = buildingCoverage(big);
    expect(cov[0].rankingReady).toBe(true);
    expect(buildingCoverage([mk({ building: "summit" })])[0].rankingReady).toBe(false);
  });
});

describe("collectionPriorities", () => {
  it("asks for more runs when a building is below the gate", () => {
    const p = collectionPriorities([mk({ building: "little", occupancy: 1 })]);
    expect(p.some((x) => /little/i.test(x.text) && /collect 3 more/.test(x.text))).toBe(true);
  });

  it("flags a window-pair gap (has open, lacks closed)", () => {
    const p = collectionPriorities([mk({ building: "judge", occupancy: 1, window: "open" })]);
    expect(p.some((x) => /judge/i.test(x.text) && /no window-closed run/.test(x.text))).toBe(true);
  });

  it("flags the absence of any negative control", () => {
    const p = collectionPriorities([mk({ building: "fahey", occupancy: 1 })]);
    expect(p.some((x) => /negative control/i.test(x.text))).toBe(true);
  });

  it("flags unresolved building labels and missing occupancy as high severity", () => {
    const p = collectionPriorities([mk({ building: "", occupancy: null })]);
    expect(p.some((x) => x.severity === "high" && /didn't resolve/.test(x.text))).toBe(true);
    expect(p.some((x) => x.severity === "high" && /missing an occupancy label/.test(x.text))).toBe(true);
  });

  it("orders high severity before low", () => {
    const p = collectionPriorities([
      mk({ building: "", occupancy: null, consent_status: "unverified" }),
    ]);
    const sevs = p.map((x) => x.severity);
    expect(sevs.indexOf("high")).toBeLessThan(sevs.lastIndexOf("low"));
  });
});

describe("coverageSummary", () => {
  it("counts named buildings, ranking-ready, consent, and unlabeled occupancy", () => {
    const runs = [
      ...Array.from({ length: 4 }, () => mk({ building: "fahey", occupancy: 1, consent_status: "verified" })),
      mk({ building: "little", occupancy: null, consent_status: "unverified" }),
      mk({ building: "", occupancy: 1, consent_status: "unverified" }),
    ];
    const s = coverageSummary(runs);
    expect(s.nRuns).toBe(6);
    expect(s.nBuildings).toBe(2); // fahey + little; "" excluded
    expect(s.rankingReady).toBe(1); // only fahey at n>=4
    expect(s.withConsent).toBe(4);
    expect(s.unlabeledOccupancy).toBe(1);
  });
});
