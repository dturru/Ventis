export interface Run {
  run_id: string;
  run_key: string;
  device_id: string;
  building: string;
  condition: string;
  occupancy: number | null;
  window_state: string;
  window?: string;       // label-derived (or annotation-overridden) window: open | closed | ""
  fan?: string;          // on | off
  scenario?: string;     // "window open · fan off"
  attr_overrides?: string[];  // which attrs came from the annotation
  date: string;
  start: string;
  end: string;
  duration_h: number | null;
  n_rows: number;
  co2_mean: number | null;
  co2_peak: number | null;
  ashrae_exceed: boolean;
  consent: string;
  consent_status?: string;
  consent_method?: string;
  consent_date?: string;
  note?: string;
  quality_flag?: string;
  tags?: string;
  chart: string;
  csv: string;
  series: string;
  notes: string;
}

export async function loadCatalog(): Promise<Run[]> {
  const r = await fetch("/data/catalog.json");
  return (await r.json()).runs;
}

export function filterRuns(runs: Run[], f: Partial<Record<keyof Run, unknown>>): Run[] {
  return runs.filter((r) =>
    Object.entries(f).every(
      ([k, v]) =>
        v == null ||
        v === "" ||
        String((r as unknown as Record<string, unknown>)[k]).toLowerCase().includes(String(v).toLowerCase())
    )
  );
}

/** Free-text search across the human-readable fields of each run. */
export function searchRuns(runs: Run[], query: string): Run[] {
  const q = query.trim().toLowerCase();
  if (!q) return runs;
  const fields: (keyof Run)[] = ["building", "condition", "date", "device_id", "window_state"];
  return runs.filter((r) =>
    fields.some((f) => String((r as unknown as Record<string, unknown>)[f] ?? "").toLowerCase().includes(q))
  );
}

export function sortRuns(runs: Run[], key: keyof Run, dir: "asc" | "desc"): Run[] {
  const s = [...runs].sort((a, b) =>
    (a[key] as never) > (b[key] as never) ? 1 : -1
  );
  return dir === "desc" ? s.reverse() : s;
}
