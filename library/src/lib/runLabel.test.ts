import { describe, it, expect } from "vitest";
import { canonical } from "./runLabel";

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
