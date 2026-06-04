// ─────────────────────────────────────────────────────────────────────────
//  Ventis site — editable config
//  Swap these two values when the real links are ready. Nothing else needs
//  to change. (v1 ship-fast, 2026-06-03)
// ─────────────────────────────────────────────────────────────────────────

// Residents CTA → the existing "Ventis — Early Access" Google Form.
// (Form ends with a "would you like to be in the beta?" question.)
export const BETA_FORM_URL = 'https://forms.gle/UsFdeU8syZUFy8ms5'

// Contact address (Diego's Dartmouth school email) — used by the /contact form's
// mailto fallback and the footer link.
export const CONTACT_EMAIL = 'Diego.A.Turrubiartes.28@dartmouth.edu'

// /contact form delivery via Web3Forms (free, no backend, no account beyond a key).
// TODO(Diego): get a free access key in ~2 min at https://web3forms.com (enter your
// Dartmouth email → they email you a key → paste it below). Submissions then arrive
// in your inbox with no mail-client popup. While this is empty, the contact form
// falls back to composing a pre-filled email in the visitor's mail app.
export const WEB3FORMS_KEY = '8d8a4877-e3ad-4cbf-acd7-dd0f59b31cab'

// Resolved residents link: real form if set, else fall back to an email intro.
export const residentsCTA = BETA_FORM_URL
  ? BETA_FORM_URL
  : `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
      'Ventis — I want one in my dorm this fall',
    )}`
