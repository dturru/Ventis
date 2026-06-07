import { describe, it, expect } from "vitest";
import { validateConsentPayload } from "./_validate";

describe("validateConsentPayload", () => {
  const good = { code: "VEN-4827", method: "opt_in_form", condition: "fahey_window_1person",
                 attested_by: "occupant", terms_version: "v1", notes: "" };

  it("accepts a valid payload", () => {
    const r = validateConsentPayload(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.code).toBe("VEN-4827");
  });

  it("rejects a missing/invalid code", () => {
    expect(validateConsentPayload({ ...good, code: "nope" }).ok).toBe(false);
    expect(validateConsentPayload({ ...good, code: "" }).ok).toBe(false);
  });

  it("rejects an invalid method", () => {
    expect(validateConsentPayload({ ...good, method: "hacked" }).ok).toBe(false);
  });

  it("trips the honeypot", () => {
    expect(validateConsentPayload({ ...good, website: "spam" }).ok).toBe(false);
  });

  it("caps oversized notes", () => {
    const r = validateConsentPayload({ ...good, notes: "x".repeat(5000) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.notes.length).toBeLessThanOrEqual(500);
  });
});
