export interface ConsentValue {
  code: string; method: string; condition: string;
  attested_by: string; terms_version: string; notes: string;
}
type Result = { ok: true; value: ConsentValue } | { ok: false; error: string };

const METHODS = new Set(["opt_in_form", "opt_in_verbal"]);
const CODE_RE = /^VEN-\w{3,8}$/;
const cap = (v: unknown, n: number) => String(v ?? "").slice(0, n);

export function validateConsentPayload(body: any): Result {
  if (!body || typeof body !== "object") return { ok: false, error: "bad request" };
  if (body.website) return { ok: false, error: "rejected" };          // honeypot
  const code = String(body.code ?? "").trim();
  if (!CODE_RE.test(code)) return { ok: false, error: "invalid deployment code" };
  const method = String(body.method ?? "");
  if (!METHODS.has(method)) return { ok: false, error: "invalid consent method" };
  return {
    ok: true,
    value: {
      code,
      method,
      condition: cap(body.condition, 120),
      attested_by: cap(body.attested_by, 60),
      terms_version: cap(body.terms_version, 40),
      notes: cap(body.notes, 500),
    },
  };
}
