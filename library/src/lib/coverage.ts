import type { Run } from "./catalog";

/**
 * Coverage = the internal collection map. It answers "what data do we have and
 * where are the gaps", NOT "which building is best". Per the council verdict
 * (2026-06-11): run counts are honest at any n, but per-building CO₂ averages
 * and best-to-worst rankings are deliberately omitted — with a small, confounded
 * sample they mislead. This module only counts; it never ranks or averages.
 */

/** Per-building run count below which a cross-building comparison is statistical
 *  theatre. The council's gate: no aggregate ranking until every building clears it. */
export const RANKING_GATE_N = 4;

export type OccBucket = "empty" | "single" | "multi" | "unknown";

export const OCC_BUCKETS: { key: OccBucket; label: string }[] = [
  { key: "empty", label: "Empty · control" },
  { key: "single", label: "1 person" },
  { key: "multi", label: "2+ people" },
  { key: "unknown", label: "Unlabeled" },
];

export function occBucket(occ: number | null | undefined): OccBucket {
  if (occ == null) return "unknown";
  if (occ <= 0) return "empty";
  if (occ === 1) return "single";
  return "multi";
}

export interface BuildingCoverage {
  building: string; // "" => the run label didn't resolve to a known building
  n: number;
  byOcc: Record<OccBucket, number>;
  hasWindowOpen: boolean;
  hasWindowClosed: boolean;
  missingConsent: number; // runs without verified consent
  missingOccupancy: number; // runs with a null occupancy label
  rankingReady: boolean; // n >= gate
}

function emptyCoverage(building: string): BuildingCoverage {
  return {
    building,
    n: 0,
    byOcc: { empty: 0, single: 0, multi: 0, unknown: 0 },
    hasWindowOpen: false,
    hasWindowClosed: false,
    missingConsent: 0,
    missingOccupancy: 0,
    rankingReady: false,
  };
}

/** One row per distinct building, most-data-first. The unresolved-building
 *  bucket ("") sinks to the bottom — it's a labeling gap, not a place. */
export function buildingCoverage(runs: Run[]): BuildingCoverage[] {
  const map = new Map<string, BuildingCoverage>();
  for (const r of runs) {
    const b = r.building || "";
    const c = map.get(b) ?? emptyCoverage(b);
    map.set(b, c);
    c.n++;
    c.byOcc[occBucket(r.occupancy)]++;
    if (r.window === "open") c.hasWindowOpen = true;
    if (r.window === "closed") c.hasWindowClosed = true;
    if (r.consent_status !== "verified") c.missingConsent++;
    if (r.occupancy == null) c.missingOccupancy++;
  }
  const out = [...map.values()];
  for (const c of out) c.rankingReady = c.n >= RANKING_GATE_N;
  return out.sort((a, b) => {
    if ((a.building === "") !== (b.building === "")) return a.building === "" ? 1 : -1;
    return b.n - a.n || a.building.localeCompare(b.building);
  });
}

export type Severity = "high" | "med" | "low";
export interface Priority {
  severity: Severity;
  text: string;
}

const SEV_ORDER: Record<Severity, number> = { high: 0, med: 1, low: 2 };

/** The cofounder's collection to-do list, derived from the gaps. Imperatives,
 *  ordered by severity — this is the operational output of the page. */
export function collectionPriorities(runs: Run[]): Priority[] {
  const cov = buildingCoverage(runs);
  const named = cov.filter((c) => c.building !== "");
  const out: Priority[] = [];

  // 1. buildings short of the comparison gate
  for (const c of named) {
    if (c.n > 0 && c.n < RANKING_GATE_N) {
      const more = RANKING_GATE_N - c.n;
      out.push({
        severity: c.n === 1 ? "high" : "med",
        text: `${c.building}: ${c.n} run${c.n === 1 ? "" : "s"} — collect ${more} more to reach the n≥${RANKING_GATE_N} comparison gate.`,
      });
    }
  }

  // 2. ventilation pairing gaps — a Fahey-style within-room comparison needs both states
  for (const c of named) {
    if (c.hasWindowOpen !== c.hasWindowClosed) {
      const have = c.hasWindowOpen ? "open" : "closed";
      const need = c.hasWindowOpen ? "closed" : "open";
      out.push({
        severity: "med",
        text: `${c.building}: has a window-${have} run but no window-${need} run — can't isolate the ventilation effect.`,
      });
    }
  }

  // 3. no negative control anywhere — the baseline that makes occupancy legible
  if (!runs.some((r) => occBucket(r.occupancy) === "empty")) {
    out.push({
      severity: "med",
      text: "No empty-room (negative control) run recorded in any building.",
    });
  }

  // 4. labeling + consent gaps — the guide-tab reconciliation work
  const noBuilding = runs.filter((r) => !r.building).length;
  if (noBuilding) {
    out.push({
      severity: "high",
      text: `${noBuilding} run${noBuilding === 1 ? "" : "s"} whose label didn't resolve to a known building.`,
    });
  }
  const missOcc = runs.filter((r) => r.occupancy == null).length;
  if (missOcc) {
    out.push({
      severity: "high",
      text: `${missOcc} run${missOcc === 1 ? "" : "s"} missing an occupancy label — reconcile in the guide tab.`,
    });
  }
  const missConsent = runs.filter((r) => r.consent_status !== "verified").length;
  if (missConsent) {
    out.push({
      severity: "low",
      text: `${missConsent} of ${runs.length} run${runs.length === 1 ? "" : "s"} without verified consent recorded.`,
    });
  }

  return out.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
}

export interface CoverageSummary {
  nRuns: number;
  nBuildings: number; // named buildings only
  rankingReady: number; // # buildings at n >= gate
  withConsent: number;
  unlabeledOccupancy: number;
}

export function coverageSummary(runs: Run[]): CoverageSummary {
  const named = buildingCoverage(runs).filter((c) => c.building !== "");
  return {
    nRuns: runs.length,
    nBuildings: named.length,
    rankingReady: named.filter((c) => c.rankingReady).length,
    withConsent: runs.filter((r) => r.consent_status === "verified").length,
    unlabeledOccupancy: runs.filter((r) => r.occupancy == null).length,
  };
}
