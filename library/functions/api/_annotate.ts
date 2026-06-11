export interface AnnotationValue {
  run_key: string; note: string; quality_flag: string; tags: string;
}
type Result = { ok: true; value: AnnotationValue } | { ok: false; error: string };

// Matches site/scripts/annotate.py VALID_FLAGS, plus "" to clear a flag.
export const VALID_FLAGS = new Set(["good", "caution", "exclude", ""]);
const cap = (v: unknown, n: number) => String(v ?? "").slice(0, n);

export function validateAnnotationPayload(body: any): Result {
  if (!body || typeof body !== "object") return { ok: false, error: "bad request" };
  const run_key = String(body.run_key ?? "").trim();
  if (!run_key) return { ok: false, error: "missing run_key" };
  const quality_flag = String(body.quality_flag ?? "").trim();
  if (!VALID_FLAGS.has(quality_flag)) return { ok: false, error: "invalid quality flag" };
  return {
    ok: true,
    value: { run_key, quality_flag, note: cap(body.note, 1000), tags: cap(body.tags, 200) },
  };
}

// Cloudflare Access guarantees this header on authenticated requests; "founder"
// is a defensive fallback (the route is unreachable without Access anyway).
export function resolveUpdatedBy(headerEmail: string | null): string {
  const e = String(headerEmail ?? "").trim();
  return e ? e.slice(0, 120) : "founder";
}
