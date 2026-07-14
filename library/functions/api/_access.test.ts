import { describe, it, expect } from "vitest";
import { accessConfig, tokenFrom, verifyAccess, AccessDenied } from "./_access";

const TEAM = "https://ventis.cloudflareaccess.com";
const AUD = "aud-tag-123";

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://x/api/run-launch", { method: "POST", headers });
}

describe("accessConfig", () => {
  it("is null unless BOTH team domain and aud are set", () => {
    expect(accessConfig({})).toBeNull();
    expect(accessConfig({ CF_ACCESS_TEAM_DOMAIN: TEAM })).toBeNull();
    expect(accessConfig({ CF_ACCESS_AUD: AUD })).toBeNull();
    expect(accessConfig({ CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD }))
      .toEqual({ teamDomain: TEAM, aud: AUD });
  });

  it("trims a trailing slash off the team domain", () => {
    expect(accessConfig({ CF_ACCESS_TEAM_DOMAIN: TEAM + "/", CF_ACCESS_AUD: AUD })?.teamDomain)
      .toBe(TEAM);
  });
});

describe("tokenFrom", () => {
  it("prefers the Cf-Access-Jwt-Assertion header", () => {
    expect(tokenFrom(req({ "Cf-Access-Jwt-Assertion": "tok-h" }))).toBe("tok-h");
  });
  it("falls back to the CF_Authorization cookie", () => {
    expect(tokenFrom(req({ Cookie: "a=1; CF_Authorization=tok-c; b=2" }))).toBe("tok-c");
  });
  it("is null when neither is present", () => {
    expect(tokenFrom(req())).toBeNull();
  });
});

describe("verifyAccess", () => {
  it("is inert (header-only, not enforced) when unconfigured", async () => {
    const id = await verifyAccess(
      req({ "Cf-Access-Authenticated-User-Email": "d@ventis.app" }), {});
    expect(id).toEqual({ email: "d@ventis.app", enforced: false });
  });

  it("denies when configured but no JWT is presented", async () => {
    await expect(verifyAccess(req(), { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD }))
      .rejects.toBeInstanceOf(AccessDenied);
  });

  it("returns the verified email (enforced) on a valid JWT", async () => {
    const id = await verifyAccess(
      req({ "Cf-Access-Jwt-Assertion": "good" }),
      { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD },
      async () => ({ email: "occupant@ventis.app" }),  // injected verifier
    );
    expect(id).toEqual({ email: "occupant@ventis.app", enforced: true });
  });

  it("denies when the JWT fails verification (bad signature / aud / exp)", async () => {
    await expect(verifyAccess(
      req({ "Cf-Access-Jwt-Assertion": "bad" }),
      { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD },
      async () => { throw new Error("signature verification failed"); },
    )).rejects.toBeInstanceOf(AccessDenied);
  });

  it("does not trust a spoofed email header when a JWT is required but missing", async () => {
    await expect(verifyAccess(
      req({ "Cf-Access-Authenticated-User-Email": "attacker@evil.com" }),
      { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD },
    )).rejects.toBeInstanceOf(AccessDenied);
  });
});
