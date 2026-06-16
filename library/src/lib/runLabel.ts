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
