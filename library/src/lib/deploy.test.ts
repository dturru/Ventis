import { describe, it, expect } from "vitest";
import { normalizeCondition, buildConsentUrl, randomCode } from "./deploy";

describe("normalizeCondition", () => {
  it("lowercases, replaces non-alphanumerics with underscores, trims edges", () => {
    expect(normalizeCondition("Fahey Window 1person")).toBe("fahey_window_1person");
    expect(normalizeCondition("  Judge_3RDouble  ")).toBe("judge_3rdouble");
    expect(normalizeCondition("east--wheelock__2person")).toBe("east_wheelock_2person");
  });
});

describe("buildConsentUrl", () => {
  it("builds the public consent link with code and normalized condition", () => {
    expect(buildConsentUrl("VEN-4827", "fahey_window_1person")).toBe(
      "https://ventis.vercel.app/consent?code=VEN-4827&c=fahey_window_1person",
    );
  });

  it("normalizes the condition inside the URL", () => {
    expect(buildConsentUrl("VEN-1", "Summit Bedroom 2person")).toBe(
      "https://ventis.vercel.app/consent?code=VEN-1&c=summit_bedroom_2person",
    );
  });
});

describe("randomCode", () => {
  it("matches the VEN-#### format", () => {
    for (let i = 0; i < 20; i++) expect(randomCode()).toMatch(/^VEN-\d{4}$/);
  });
});
