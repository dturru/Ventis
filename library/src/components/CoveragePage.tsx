import { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  LabelList, ResponsiveContainer,
} from "recharts";
import { loadCatalog, type Run } from "../lib/catalog";
import {
  buildingCoverage, collectionPriorities, coverageSummary,
  OCC_BUCKETS, RANKING_GATE_N, type OccBucket,
} from "../lib/coverage";

// Coverage uses a GREEN-only ramp on purpose. The red/amber palette is reserved
// for CO₂ air tiers; a "red" coverage bar would falsely read as "bad air". Depth
// of green = how close a building is to the comparison gate, nothing about air.
function coverageFill(n: number): string {
  if (n >= RANKING_GATE_N) return "#1e6e3a"; // ready
  if (n >= 2) return "#6aa67f"; // partial
  return "#bcd9c4"; // sparse (n = 1)
}

const axisTick = { fill: "#5e6b5e", fontSize: 12, fontFamily: "DM Mono, monospace" };

export default function CoveragePage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    loadCatalog().then(setRuns).catch((e) => setErr(String(e)));
  }, []);

  const cov = useMemo(() => buildingCoverage(runs), [runs]);
  const named = useMemo(() => cov.filter((c) => c.building !== ""), [cov]);
  const priorities = useMemo(() => collectionPriorities(runs), [runs]);
  const summary = useMemo(() => coverageSummary(runs), [runs]);

  const barData = useMemo(
    () => named.map((c) => ({ building: c.building, n: c.n })),
    [named]
  );
  const barHeight = Math.max(220, barData.length * 38 + 40);

  if (err)
    return (
      <main className="lib-main">
        <div className="wrap">
          <p className="state state-err">Could not load catalog: {err}</p>
        </div>
      </main>
    );

  const tiles: [string, string][] = [
    ["Runs", String(summary.nRuns)],
    ["Buildings", String(summary.nBuildings)],
    [`Ranking-ready (n≥${RANKING_GATE_N})`, `${summary.rankingReady}/${summary.nBuildings}`],
    ["Consent recorded", `${summary.withConsent}/${summary.nRuns}`],
    ["Unlabeled occupancy", String(summary.unlabeledOccupancy)],
  ];

  return (
    <main className="lib-main">
      <div className="wrap">
        <div className="eyebrow">Internal · collection map</div>
        <h1 className="page-title">Coverage</h1>
        <p className="page-lede">
          What we have and where the gaps are — a tool for deciding what to collect
          next, not a findings page.
        </p>

        <div className="callout amber">
          Run counts are honest at any sample size. Per-building CO₂ averages and
          best-to-worst rankings are <strong>deliberately omitted</strong>: with this
          many runs and confounded conditions (occupancy, window, fan, season) they
          would mislead more than inform. Cross-building comparison unlocks per building
          at <strong>n ≥ {RANKING_GATE_N}</strong>.
        </div>

        <div className="stat-grid">
          {tiles.map(([label, val]) => (
            <div className="stat" key={label}>
              <div className="stat-k">{val}</div>
              <div className="stat-l">{label}</div>
            </div>
          ))}
        </div>

        {priorities.length > 0 && (
          <>
            <h2 className="cov-h2">Collection priorities</h2>
            <p className="cov-sub">Ordered by what most limits the dataset right now.</p>
            <ul className="cov-priorities">
              {priorities.map((p, i) => (
                <li key={i} className={`prio prio-${p.severity}`}>
                  <span className="prio-tag">{p.severity}</span>
                  <span>{p.text}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {barData.length > 0 && (
          <>
            <h2 className="cov-h2">Runs per building</h2>
            <p className="cov-sub">
              Depth of green = distance to the n≥{RANKING_GATE_N} comparison gate (dashed line). Counts only.
            </p>
            <div className="chart-card">
              <ResponsiveContainer width="100%" height={barHeight}>
                <BarChart data={barData} layout="vertical" margin={{ top: 6, right: 40, bottom: 24, left: 8 }}>
                  <CartesianGrid stroke="rgba(13,69,32,0.10)" strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={axisTick}
                    stroke="rgba(13,69,32,0.25)"
                    label={{ value: "runs", position: "insideBottom", offset: -12, fill: "#5e6b5e", fontSize: 12 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="building"
                    width={104}
                    tick={axisTick}
                    stroke="rgba(13,69,32,0.25)"
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(30,110,58,0.06)" }}
                    formatter={(v) => [`${v} run${v === 1 ? "" : "s"}`, "count"]}
                    contentStyle={{ borderRadius: 10, border: "1px solid rgba(13,69,32,0.12)", boxShadow: "0 4px 18px rgba(13,69,32,0.10)", fontFamily: "Outfit, sans-serif", fontSize: 13 }}
                  />
                  <ReferenceLine x={RANKING_GATE_N} stroke="#1e6e3a" strokeDasharray="4 4" label={{ value: `gate n=${RANKING_GATE_N}`, fill: "#1e6e3a", fontSize: 11, position: "top" }} />
                  <Bar dataKey="n" radius={[0, 5, 5, 0]} isAnimationActive={false}>
                    {barData.map((d) => (
                      <Cell key={d.building} fill={coverageFill(d.n)} />
                    ))}
                    <LabelList dataKey="n" position="right" style={{ fill: "#16241a", fontFamily: "DM Mono, monospace", fontSize: 12 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}

        {named.length > 0 && (
          <>
            <h2 className="cov-h2">Coverage matrix</h2>
            <p className="cov-sub">
              Building × occupancy. Empty cells are collection targets; window pairing
              shows whether a within-room ventilation comparison is possible.
            </p>
            <div className="table-wrap">
              <div className="table-scroll">
                <table className="run-table cov-matrix">
                  <thead>
                    <tr>
                      <th className="plain">Building</th>
                      {OCC_BUCKETS.map((b) => (
                        <th key={b.key} className="plain cov-col">{b.label}</th>
                      ))}
                      <th className="plain cov-col">Window pair</th>
                      <th className="plain cov-col">Consent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {named.map((c) => (
                      <tr key={c.building}>
                        <td className="cell-name">
                          {c.building}
                          {c.rankingReady && <span className="badge badge-green">n≥{RANKING_GATE_N}</span>}
                        </td>
                        {OCC_BUCKETS.map((b) => {
                          const v = c.byOcc[b.key as OccBucket];
                          return (
                            <td key={b.key} className="num cov-td">
                              {v > 0 ? <span className="cov-have">{v}</span> : <span className="cov-gap">·</span>}
                            </td>
                          );
                        })}
                        <td className="cov-td">
                          <span className={`cov-pair ${c.hasWindowOpen ? "on" : ""}`}>open</span>
                          <span className={`cov-pair ${c.hasWindowClosed ? "on" : ""}`}>closed</span>
                        </td>
                        <td className="num cov-td">
                          {c.missingConsent === 0 ? (
                            <span className="cov-have">{c.n}/{c.n}</span>
                          ) : (
                            <span className="cov-gap">{c.n - c.missingConsent}/{c.n}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {cov.some((c) => c.building === "") && (
              <p className="cov-foot">
                {cov.find((c) => c.building === "")!.n} run(s) are excluded from the matrix —
                their label didn't resolve to a known building (see Collection priorities).
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
