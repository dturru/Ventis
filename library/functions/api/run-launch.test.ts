import { describe, it, expect, vi } from "vitest";
import { handleRunLaunch, type LaunchDeps, type LaunchBody } from "./run-launch";

function deps(over: Partial<LaunchDeps> = {}): LaunchDeps {
  return {
    now: () => new Date("2026-06-16T18:00:00Z"),
    getControl: vi.fn(async () => ({ logging: false, seq: 4, lastTelemetryAt: "2026-06-16T17:59:30Z" })),
    setControl: vi.fn(async () => 5),
    insertConsent: vi.fn(async () => {}),
    recentDuplicate: vi.fn(async () => false),
    insertLaunch: vi.fn(async () => {}),
    ...over,
  };
}

const body: LaunchBody = {
  action: "start",
  building: "fahey", scenario: "window", occupancy: 1,
  consent: { consent_method: "opt_in_verbal", attested_by: "occupant", terms_version: "v1-2026-06", notes: "" },
  nonce: "n-1", overrides: [],
};

describe("handleRunLaunch", () => {
  it("starts the device on a clean preflight and records consent + launch", async () => {
    const d = deps();
    const r = await handleRunLaunch(d, body, "founder@ventis.app");
    expect(r.status).toBe("started");
    expect(d.insertConsent).toHaveBeenCalledOnce();
    expect(d.setControl).toHaveBeenCalledWith(true, "fahey_window_1person");
    expect(d.insertLaunch).toHaveBeenCalledOnce();
  });

  it("blocks (no device start) on a hard failure", async () => {
    const d = deps();
    const r = await handleRunLaunch(d, { ...body, occupancy: -1 }, "founder@ventis.app");
    expect(r.status).toBe("blocked");
    expect(d.setControl).not.toHaveBeenCalled();
    expect(d.insertConsent).not.toHaveBeenCalled();
  });

  it("asks for override when the device is stale, without starting", async () => {
    const d = deps({ getControl: vi.fn(async () => ({ logging: false, seq: 4, lastTelemetryAt: "2026-06-16T17:00:00Z" })) });
    const r = await handleRunLaunch(d, body, "founder@ventis.app");
    expect(r.status).toBe("needs_override");
    expect(r.verdicts.find((v) => v.id === "device_online")?.pass).toBe(false);
    expect(d.setControl).not.toHaveBeenCalled();
  });

  it("defers consent and still starts when the DB write fails and is overridden", async () => {
    const d = deps({ insertConsent: vi.fn(async () => { throw new Error("pooler timeout"); }) });
    const r = await handleRunLaunch(d, { ...body, overrides: ["consent_persisted"] }, "founder@ventis.app");
    expect(r.status).toBe("started");
    expect(d.setControl).toHaveBeenCalledOnce();
    expect(d.insertLaunch).toHaveBeenCalledWith(expect.objectContaining({ consent_status: "deferred" }));
  });

  it("persists the override reason and flags when a soft check is overridden", async () => {
    const d = deps({ getControl: vi.fn(async () => ({ logging: false, seq: 4, lastTelemetryAt: "2026-06-16T17:00:00Z" })) });
    const r = await handleRunLaunch(
      d,
      { ...body, overrides: ["device_online"], override_reason: "device briefly rebooting" },
      "founder@ventis.app",
    );
    expect(r.status).toBe("started");
    expect(d.insertLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ override_reason: "device briefly rebooting", override_flags: ["device_online"] }),
    );
  });

  it("is idempotent: a repeated nonce does not start twice", async () => {
    const d = deps({ recentDuplicate: vi.fn(async () => false), insertLaunch: vi.fn(async () => { throw { code: "23505" }; }) });
    const r = await handleRunLaunch(d, body, "founder@ventis.app");
    expect(r.status).toBe("duplicate_nonce");
  });
});
