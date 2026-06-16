import { describe, it, expect } from "vitest";
import { evaluatePreflight, gate, CHECKPOINT_HELP, type PreflightInputs } from "./preflight";

const base: PreflightInputs = {
  authedEmail: "founder@ventis.app",
  labelInputsOk: true,
  labelErrors: [],
  consentComplete: true,
  deviceFresh: true,
  deviceLastSeenSecs: 12,
  activeRun: false,
  duplicateRecent: false,
  consentPersisted: true,
  overrides: [],
};

describe("evaluatePreflight + gate", () => {
  it("passes cleanly when everything is good", () => {
    expect(gate(evaluatePreflight(base))).toBe("ok");
  });

  it("blocks on a hard failure even if overridden", () => {
    const v = evaluatePreflight({ ...base, labelInputsOk: false, labelErrors: ["bad"], overrides: ["label"] });
    expect(gate(v)).toBe("blocked");
  });

  it("needs override when a soft check fails and is not overridden", () => {
    expect(gate(evaluatePreflight({ ...base, deviceFresh: false }))).toBe("needs_override");
  });

  it("proceeds when the failing soft check is overridden", () => {
    expect(gate(evaluatePreflight({ ...base, deviceFresh: false, overrides: ["device_online"] }))).toBe("ok");
  });

  it("omits the consent_persisted verdict until consent has been attempted", () => {
    const v = evaluatePreflight({ ...base, consentPersisted: null });
    expect(v.find((x) => x.id === "consent_persisted")).toBeUndefined();
  });

  it("defers consent when the DB write failed but the operator overrode it", () => {
    const v = evaluatePreflight({ ...base, consentPersisted: false, overrides: ["consent_persisted"] });
    expect(gate(v)).toBe("ok");
  });

  it("has operator help (what + fix) for every checkpoint id it can emit", () => {
    const v = evaluatePreflight({ ...base, consentPersisted: false }); // consentPersisted set => includes that verdict
    for (const verdict of v) {
      const help = CHECKPOINT_HELP[verdict.id];
      expect(help, `missing help for "${verdict.id}"`).toBeDefined();
      expect(help.what.length).toBeGreaterThan(0);
      expect(help.fix.length).toBeGreaterThan(0);
    }
  });
});
