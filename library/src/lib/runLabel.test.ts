import { describe, it, expect } from "vitest";
import { canonical, compose, validateLabelInputs, BUILDINGS, SCENARIOS } from "./runLabel";

describe("canonical", () => {
  it("lowercases, maps number-words to digits, folds occupancy shorthand, drops separators", () => {
    expect(canonical("Little_window_one person")).toBe("littlewindow1person");
    expect(canonical("little_window_1_person")).toBe("littlewindow1person");
    expect(canonical("little_window_1p")).toBe("littlewindow1person");
  });

  it("bridges a number-word glued to an occupancy word", () => {
    expect(canonical("french_window_oneperson")).toBe(canonical("french_window_one_person"));
  });

  it("keeps different occupancy counts distinct", () => {
    expect(canonical("little_window_1person")).not.toBe(canonical("little_window_2person"));
  });

  it("does not split ordinary words that merely start with a number-word", () => {
    expect(canonical("tenant")).toBe("tenant");
  });
});

describe("compose", () => {
  it("builds building_scenario_Nperson with a digit occupancy", () => {
    expect(compose("fahey", "window", 1)).toBe("fahey_window_1person");
    expect(compose("east_wheelock", "negcontrol", 2)).toBe("east_wheelock_negcontrol_2person");
  });
});

describe("validateLabelInputs", () => {
  it("accepts clean tokens and a non-negative integer occupancy", () => {
    expect(validateLabelInputs({ building: "fahey", scenario: "window", occupancy: 1 }))
      .toEqual({ ok: true, errors: [] });
  });

  it("rejects bad building/scenario shape and bad occupancy", () => {
    const r = validateLabelInputs({ building: "Fahey Hall", scenario: "", occupancy: -1 });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBe(3);
  });

  it("exposes suggested dropdown values", () => {
    expect(BUILDINGS).toContain("fahey");
    expect(SCENARIOS).toContain("windowclosed");
  });
});
