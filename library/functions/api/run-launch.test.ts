import { describe, it, expect, vi } from "vitest";
import { handleRunLaunch, buildEndFields, type LaunchDeps, type LaunchBody, type EndCapture } from "./run-launch";

function deps(over: Partial<LaunchDeps> = {}): LaunchDeps {
  return {
    now: () => new Date("2026-06-16T18:00:00Z"),
    getControl: vi.fn(async () => ({ logging: false, seq: 4, lastTelemetryAt: "2026-06-16T17:59:30Z" })),
    setControl: vi.fn(async () => 5),
    insertConsent: vi.fn(async () => {}),
    recentDuplicate: vi.fn(async () => false),
    insertLaunch: vi.fn(async () => {}),
    recordEnd: vi.fn(async () => {}),
    ...over,
  };
}

const capture: EndCapture = {
  window: "open", door: "closed", occupancy: 1, visitors: true,
  placement: "floor", power: "ext_cord", deviation: false, quality: "caution", note: "ran 52h",
};

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

  it("opt_in_form: defers to the occupant's self-serve tap — no consent row written, still starts", async () => {
    const d = deps();
    const r = await handleRunLaunch(
      d,
      { ...body, consent: { ...body.consent, consent_method: "opt_in_form" } },
      "founder@ventis.app",
    );
    expect(r.status).toBe("started");
    expect(d.insertConsent).not.toHaveBeenCalled(); // occupant's QR submission is the record
    expect(r.verdicts.find((v) => v.id === "consent_persisted")).toBeUndefined(); // not emitted → no override
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

  it("stops the device and records the end-of-run capture on stop", async () => {
    const d = deps();
    const r = await handleRunLaunch(d, { ...body, action: "stop", endCapture: capture }, "founder@ventis.app");
    expect(r.status).toBe("stopped");
    expect(d.setControl).toHaveBeenCalledWith(false, "fahey_window_1person");
    expect(d.recordEnd).toHaveBeenCalledWith(
      "faheywindow1person", "fahey_window_1person",
      expect.objectContaining({ quality_flag: "caution", window: "open", occupancy: 1, ended_by: "founder@ventis.app" }),
    );
  });

  it("a bare stop (no capture) still stops without recording", async () => {
    const d = deps();
    const r = await handleRunLaunch(d, { ...body, action: "stop" }, "founder@ventis.app");
    expect(r.status).toBe("stopped");
    expect(d.setControl).toHaveBeenCalledWith(false, "fahey_window_1person");
    expect(d.recordEnd).not.toHaveBeenCalled();
  });

  it("never undoes the device stop if the capture write fails", async () => {
    const d = deps({ recordEnd: vi.fn(async () => { throw new Error("pooler timeout"); }) });
    const r = await handleRunLaunch(d, { ...body, action: "stop", endCapture: capture }, "founder@ventis.app");
    expect(r.status).toBe("stopped");
    expect(r.message).toMatch(/deferred/);
  });
});

describe("buildEndFields", () => {
  it("derives provenance + deviation tags and a composed note", () => {
    const f = buildEndFields(capture);
    expect(f.window).toBe("open");
    expect(f.occupancy).toBe(1);
    expect(f.quality_flag).toBe("caution");
    const tags = f.tags.split(",");
    expect(tags).toEqual(expect.arrayContaining(["scd40-pas", "window-open", "floor-placement", "bad-power", "sop-deviation", "internal-only"]));
    expect(f.note).toContain("daytime visitors noted");
    expect(f.note).toContain("ran 52h");
  });

  it("a clean breathing-zone run carries no deviation tags", () => {
    const f = buildEndFields({ ...capture, placement: "breathing", power: "usb", deviation: false, quality: "good", visitors: false });
    const tags = f.tags.split(",");
    expect(tags).not.toContain("sop-deviation");
    expect(tags).not.toContain("internal-only");
    expect(f.note).toContain("no daytime visitors");
  });

  it("drops an invalid quality flag rather than passing it through", () => {
    expect(buildEndFields({ ...capture, quality: "bogus" }).quality_flag).toBe("");
  });
});
