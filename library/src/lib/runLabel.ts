// Run condition labels: composed once from structured fields and used for BOTH the
// device control tab and the consent row, so they cannot diverge. canonical() mirrors
// site/scripts/reconcile_consent.py::canonical so the TS and Python forms always agree.

const NUM_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
};
const OCCUPANCY: Record<string, string> = {
  people: "person", persons: "person", p: "person", ppl: "person", ppls: "person",
};
const OCC_WORDS = new Set<string>([...Object.keys(OCCUPANCY), "person"]);

function splitGluedNumword(tok: string): string[] {
  for (const w of Object.keys(NUM_WORDS)) {
    if (tok !== w && tok.startsWith(w) && OCC_WORDS.has(tok.slice(w.length))) {
      return [w, tok.slice(w.length)];
    }
  }
  return [tok];
}

/** Comparable form of a condition label — tolerant of how it was written, never of
 *  what it says. Port of reconcile_consent.py::canonical. */
export function canonical(s: string): string {
  const tokens = String(s ?? "").toLowerCase().match(/[a-z]+|[0-9]+/g) ?? [];
  const split = tokens.flatMap(splitGluedNumword);
  return split.map((t) => OCCUPANCY[t] ?? NUM_WORDS[t] ?? t).join("");
}

// Suggested dropdown values for the UI. The server validates by SHAPE (not membership)
// so an "other" free-text entry is allowed as long as it is a clean token.
export const BUILDINGS = ["fahey", "choates", "little", "east_wheelock", "mid_mass", "summit", "apt"] as const;
export const SCENARIOS = ["baseline", "window", "windowclosed", "fan", "fan_window", "negcontrol"] as const;

export interface LabelInputs {
  building: string;
  scenario: string;
  occupancy: number;
}

/** Compose the canonical-by-construction label. Occupancy is always a digit. */
export function compose(building: string, scenario: string, occupancy: number): string {
  return `${building}_${scenario}_${occupancy}person`;
}

/** Accept a digit string ("2") or a number-word ("two") → a non-negative integer;
 *  null if unparseable. Lets the form take either form while the stored label stays
 *  a digit (compose() always emits Nperson). */
export function parseOccupancy(input: string): number | null {
  const t = String(input ?? "").trim().toLowerCase();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  if (Object.prototype.hasOwnProperty.call(NUM_WORDS, t)) return Number(NUM_WORDS[t]);
  return null;
}

const TOKEN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** Hard-checkpoint H2: label inputs are well-formed (kills the divergence bug class). */
export function validateLabelInputs(i: LabelInputs): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!TOKEN.test(i.building)) errors.push("building must be lowercase tokens (a-z, 0-9, _)");
  if (!TOKEN.test(i.scenario)) errors.push("scenario must be lowercase tokens (a-z, 0-9, _)");
  if (!Number.isInteger(i.occupancy) || i.occupancy < 0) errors.push("occupancy must be a non-negative integer");
  return { ok: errors.length === 0, errors };
}
