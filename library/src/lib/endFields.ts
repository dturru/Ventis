// End-of-run capture -> catalog annotation. Single source of truth shared by the
// Run Launcher UI (the review preview) and the run-launch Pages Function (the
// authoritative compute on submit), so the categorization an operator REVIEWS is
// byte-for-byte what gets written to the catalog.

// What the operator confirms when ending a run (the end-of-run SOP, Phase A).
export interface EndCapture {
  window: string; // open | closed | changed
  door: string; // open | closed
  occupancy: number; // confirmed at end
  visitors: boolean; // daytime visitors observed
  placement: string; // breathing | floor | desk | near_window
  power: string; // usb | 12v | ext_cord
  deviation: boolean; // any other SOP deviation
  quality: string; // good | caution | exclude
  note: string; // free text
}

// The annotation-shaped fields derived from a capture (1:1 with the annotations table,
// so reconcile_run_ends just copies them onto the run by run_key).
export interface EndFields {
  window: string;
  occupancy: number;
  quality_flag: string;
  tags: string;
  note: string;
}

export interface EndRecord extends EndFields {
  ended_by: string;
}

const VALID_QUALITY = new Set(["good", "caution", "exclude"]);

/** Compose the catalog annotation from an operator's end-of-run capture. Pure +
 *  testable. Provenance + deviation tags are derived so the catalog categorizes the
 *  run automatically the moment it's reconciled. The UI renders this output for
 *  review before the run is ended. */
export function buildEndFields(c: EndCapture): EndFields {
  const offBreathing = !!c.placement && c.placement !== "breathing";
  const tags = ["scd40-pas"]; // v1 sensor provenance
  if (c.window === "open") tags.push("window-open");
  else if (c.window === "closed") tags.push("window-closed");
  else if (c.window === "changed") tags.push("window-changed");
  if (offBreathing) tags.push(`${c.placement.replace(/_/g, "-")}-placement`);
  if (c.power === "ext_cord") tags.push("bad-power");
  if (c.deviation || offBreathing || c.power === "ext_cord") tags.push("sop-deviation");
  if (c.quality !== "good") tags.push("internal-only");

  const note = [
    `door ${c.door || "?"}`,
    c.visitors ? "daytime visitors noted" : "no daytime visitors",
    `placement ${c.placement || "?"}`,
    `power ${c.power || "?"}`,
    c.note?.trim(),
  ].filter(Boolean).join("; ");

  return {
    window: c.window,
    occupancy: c.occupancy,
    quality_flag: VALID_QUALITY.has(c.quality) ? c.quality : "",
    tags: Array.from(new Set(tags)).join(","),
    note,
  };
}
