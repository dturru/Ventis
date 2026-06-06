export interface RawSeries {
  ts: string[];
  co2_ppm: (number | null)[];
  temp_c: (number | null)[];
  humidity_pct: (number | null)[];
}

export type MetricKey = "co2_ppm" | "temp_c" | "humidity_pct";

export const METRICS: { key: MetricKey; label: string; unit: string }[] = [
  { key: "co2_ppm", label: "CO₂", unit: "ppm" },
  { key: "temp_c", label: "Temp", unit: "°C" },
  { key: "humidity_pct", label: "Humidity", unit: "%" },
];

/** Parse `?ids=a,b,c` -> ["a","b","c"], trimmed + de-duplicated. */
export function parseIds(search: string): string[] {
  const q = new URLSearchParams(search);
  const raw = q.get("ids") ?? "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** Convert a raw series to [{h: elapsed hours from start, v: metric}], dropping nulls. */
export function toElapsedSeries(raw: RawSeries, metric: MetricKey): { h: number; v: number }[] {
  if (!raw.ts.length) return [];
  const t0 = new Date(raw.ts[0].replace(" ", "T")).getTime();
  const vals = raw[metric];
  const out: { h: number; v: number }[] = [];
  for (let i = 0; i < raw.ts.length; i++) {
    const v = vals[i];
    if (v == null || Number.isNaN(Number(v))) continue;
    const h = (new Date(raw.ts[i].replace(" ", "T")).getTime() - t0) / 3600000;
    out.push({ h: Math.round(h * 1000) / 1000, v: Number(v) });
  }
  return out;
}

export async function loadSeries(file: string): Promise<RawSeries> {
  const r = await fetch(`/data/series/${file}`);
  return r.json();
}
