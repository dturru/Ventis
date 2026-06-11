import type { Run } from "./catalog";

export const FLAG_OPTIONS = [
  { value: "", label: "— no flag —" },
  { value: "good", label: "good" },
  { value: "caution", label: "caution" },
  { value: "exclude", label: "exclude" },
] as const;

export interface AnnotationForm {
  run_key: string; note: string; quality_flag: string; tags: string;
}

/** Runs lacking a quality_flag sorted before flagged ones; stable, non-mutating. */
export function unannotatedFirst(runs: Run[]): Run[] {
  const rank = (r: Run) => (r.quality_flag ? 1 : 0);
  return [...runs]
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map(({ r }) => r);
}

/** POST an annotation to the gated Pages Function. Throws on a non-ok response. */
export async function postAnnotation(form: AnnotationForm): Promise<void> {
  const res = await fetch("/api/annotate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(form),
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({}))).error || "could not save annotation";
    throw new Error(msg);
  }
}
