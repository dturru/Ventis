// Deployment-link helpers for the founders-only QR generator (/deploy).
// The consent form lives on the PUBLIC site; this builds links that point at it.
// The condition in the link must match the run's condition label exactly for
// reconcile_consent to tie the opt-in to the run, so we normalize it here.

export const CONSENT_BASE = "https://ventis.vercel.app/consent";

/** building_condition_occupancy form: lowercase, non-alphanumerics -> single _, trimmed. */
export function normalizeCondition(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** A fresh human-readable deployment code, VEN-####. */
export function randomCode(): string {
  return "VEN-" + Math.floor(1000 + Math.random() * 9000);
}

/** The public consent URL for a deployment (code + normalized condition). */
export function buildConsentUrl(code: string, condition: string): string {
  const params = new URLSearchParams({
    code: code.trim(),
    c: normalizeCondition(condition),
  });
  return `${CONSENT_BASE}?${params.toString()}`;
}
