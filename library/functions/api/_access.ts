// Cloudflare Access identity verification for the Run Launcher API.
//
// The launcher sits behind Cloudflare Access, which forwards the caller's email in the
// `Cf-Access-Authenticated-User-Email` header. That header is PLAINTEXT and trusted
// blindly today — so the whole moat rests on the Access policy covering every route with
// no gap, ever. This verifies the SIGNED `Cf-Access-Jwt-Assertion` token instead, using
// jose against Cloudflare's rotating public keys, so the function itself refuses
// unauthenticated callers even if Access is bypassed at the network layer.
//
// INERT until wired: with CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD unset it falls back to
// the (unverified) header — byte-for-byte today's behavior — so deploying is a no-op.
// Once both are set it REQUIRES a valid signed JWT and throws AccessDenied otherwise.
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface AccessEnv {
  CF_ACCESS_TEAM_DOMAIN?: string; // e.g. https://ventis.cloudflareaccess.com
  CF_ACCESS_AUD?: string;         // the Access application's Audience (AUD) tag
}

export interface AccessIdentity {
  email: string | null; // resolved caller identity (null if unknown)
  enforced: boolean;     // true only when the JWT was cryptographically verified
}

export class AccessDenied extends Error {}

// One remote JWKS per team domain, cached across invocations. createRemoteJWKSet fetches
// and caches Cloudflare's keys (honoring their cache headers), so key rotation is handled.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwks(teamDomain: string) {
  let set = jwksCache.get(teamDomain);
  if (!set) {
    set = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, set);
  }
  return set;
}

/** Enforcement is on only when BOTH values are configured. */
export function accessConfig(env: AccessEnv): { teamDomain: string; aud: string } | null {
  const teamDomain = (env.CF_ACCESS_TEAM_DOMAIN || "").trim().replace(/\/$/, "");
  const aud = (env.CF_ACCESS_AUD || "").trim();
  return teamDomain && aud ? { teamDomain, aud } : null;
}

/** The Access JWT from the header, or the CF_Authorization cookie as a fallback. */
export function tokenFrom(request: Request): string | null {
  const header = request.headers.get("Cf-Access-Jwt-Assertion");
  if (header) return header;
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return m ? m[1] : null;
}

type Verifier = (token: string, teamDomain: string, aud: string) => Promise<JWTPayload>;

// Real verification: signature (RS256 via JWKS) + issuer + audience + exp/nbf, all by jose.
const joseVerifier: Verifier = async (token, teamDomain, aud) => {
  const { payload } = await jwtVerify(token, jwks(teamDomain), {
    issuer: teamDomain,
    audience: aud,
  });
  return payload;
};

/**
 * Resolve — and, when configured, verify — the caller's Cloudflare Access identity.
 * `verifier` is injectable so the enforced/inert branching is unit-testable without crypto.
 */
export async function verifyAccess(
  request: Request,
  env: AccessEnv,
  verifier: Verifier = joseVerifier,
): Promise<AccessIdentity> {
  const cfg = accessConfig(env);
  const headerEmail = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!cfg) {
    return { email: headerEmail, enforced: false }; // inert: header-only, as today
  }
  const token = tokenFrom(request);
  if (!token) throw new AccessDenied("missing Access JWT");
  let payload: JWTPayload;
  try {
    payload = await verifier(token, cfg.teamDomain, cfg.aud);
  } catch (e) {
    throw new AccessDenied(`invalid Access JWT: ${(e as Error).message}`);
  }
  const email = typeof payload.email === "string" ? payload.email : headerEmail;
  return { email, enforced: true };
}
