import { describe, it, expect } from "vitest";
import { validateAnnotationPayload, resolveUpdatedBy } from "./_annotate";

describe("validateAnnotationPayload", () => {
  const good = { run_key: "little_continuous_1p_20260610", note: "fan ran all night",
                 quality_flag: "caution", tags: "hardware" };

  it("accepts a valid payload", () => {
    const r = validateAnnotationPayload(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.run_key).toBe("little_continuous_1p_20260610");
  });

  it("accepts an empty flag (clears the flag)", () => {
    const r = validateAnnotationPayload({ ...good, quality_flag: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.quality_flag).toBe("");
  });

  it("rejects a missing run_key", () => {
    expect(validateAnnotationPayload({ ...good, run_key: "" }).ok).toBe(false);
    expect(validateAnnotationPayload({ ...good, run_key: "   " }).ok).toBe(false);
  });

  it("rejects an invalid flag", () => {
    expect(validateAnnotationPayload({ ...good, quality_flag: "bogus" }).ok).toBe(false);
  });

  it("rejects a non-object body", () => {
    expect(validateAnnotationPayload(null).ok).toBe(false);
    expect(validateAnnotationPayload("x").ok).toBe(false);
  });

  it("caps oversized note and tags", () => {
    const r = validateAnnotationPayload({ ...good, note: "x".repeat(5000), tags: "y".repeat(500) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.note.length).toBeLessThanOrEqual(1000);
      expect(r.value.tags.length).toBeLessThanOrEqual(200);
    }
  });
});

describe("resolveUpdatedBy", () => {
  it("uses the Access email when present", () => {
    expect(resolveUpdatedBy("diego@dartmouth.edu")).toBe("diego@dartmouth.edu");
  });
  it("falls back to 'founder' when the header is missing", () => {
    expect(resolveUpdatedBy(null)).toBe("founder");
    expect(resolveUpdatedBy("")).toBe("founder");
  });
  it("caps an oversized email", () => {
    expect(resolveUpdatedBy("a".repeat(300)).length).toBeLessThanOrEqual(120);
  });
});
