import { describe, it, expect } from "vitest";
import { parseIds, toElapsedSeries, METRICS, type RawSeries } from "./compare";

describe("compare utils", () => {
  it("parses ids from a query string", () => {
    expect(parseIds("?ids=a,b,c")).toEqual(["a", "b", "c"]);
    expect(parseIds("?ids=")).toEqual([]);
    expect(parseIds("")).toEqual([]);
    // dedupes + trims
    expect(parseIds("?ids=a, a ,b")).toEqual(["a", "b"]);
  });

  it("converts a raw series to elapsed-hours points for a metric", () => {
    const raw: RawSeries = {
      ts: ["2026-06-01 21:00:00", "2026-06-01 21:30:00", "2026-06-01 22:00:00"],
      co2_ppm: [800, 900, 1000],
      temp_c: [22, 22.5, 23],
      humidity_pct: [40, 41, 42],
    };
    const pts = toElapsedSeries(raw, "co2_ppm");
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual({ h: 0, v: 800 });
    expect(pts[1].h).toBeCloseTo(0.5, 3);
    expect(pts[2].h).toBeCloseTo(1.0, 3);
    expect(pts[2].v).toBe(1000);
  });

  it("drops points with null/NaN metric values", () => {
    const raw: RawSeries = {
      ts: ["2026-06-01 21:00:00", "2026-06-01 21:30:00"],
      co2_ppm: [800, null as unknown as number],
      temp_c: [22, 23],
      humidity_pct: [40, 41],
    };
    expect(toElapsedSeries(raw, "co2_ppm")).toHaveLength(1);
  });

  it("exposes the three comparable metrics", () => {
    expect(METRICS.map((m) => m.key)).toEqual(["co2_ppm", "temp_c", "humidity_pct"]);
  });
});
