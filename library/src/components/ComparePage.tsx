import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer,
} from "recharts";
import { loadCatalog, type Run } from "../lib/catalog";
import {
  parseIds, toElapsedSeries, loadSeries, METRICS, type MetricKey,
} from "../lib/compare";

const PALETTE = ["#1e6e3a", "#c6422c", "#1565c0", "#b87900", "#6a1b9a", "#00838f"];

interface Loaded {
  run: Run;
  pts: { h: number; v: number }[];
  color: string;
}

export default function ComparePage() {
  const { search } = useLocation();
  const ids = useMemo(() => parseIds(search), [search]);
  const [metric, setMetric] = useState<MetricKey>("co2_ppm");
  const [runs, setRuns] = useState<Run[]>([]);
  const [seriesById, setSeriesById] = useState<Record<string, Awaited<ReturnType<typeof loadSeries>>>>({});
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    loadCatalog().then(setRuns).catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    if (!runs.length) return;
    const chosen = runs.filter((r) => ids.includes(r.run_id || r.run_key));
    Promise.all(
      chosen.map((r) => loadSeries(r.series).then((s) => [r.run_id || r.run_key, s] as const))
    )
      .then((pairs) => setSeriesById(Object.fromEntries(pairs)))
      .catch((e) => setErr(String(e)));
  }, [runs, ids]);

  const loaded: Loaded[] = useMemo(() => {
    const chosen = runs.filter((r) => ids.includes(r.run_id || r.run_key));
    return chosen.map((run, i) => {
      const s = seriesById[run.run_id || run.run_key];
      return {
        run,
        color: PALETTE[i % PALETTE.length],
        pts: s ? toElapsedSeries(s, metric) : [],
      };
    });
  }, [runs, ids, seriesById, metric]);

  const unit = METRICS.find((m) => m.key === metric)!.unit;
  const axisTick = { fill: "#5e6b5e", fontSize: 12, fontFamily: "DM Mono, monospace" };

  if (err)
    return (
      <main className="lib-main">
        <div className="wrap">
          <Link to="/" className="back-link"><span className="arr">←</span> back to catalog</Link>
          <p className="state state-err">{err}</p>
        </div>
      </main>
    );

  return (
    <main className="lib-main">
      <div className="wrap">
        <Link to="/" className="back-link"><span className="arr">←</span> back to catalog</Link>
        <div className="eyebrow">Overlay</div>
        <h1 className="page-title">Compare runs</h1>
        <p className="page-lede">
          {ids.length
            ? `${ids.length} run${ids.length === 1 ? "" : "s"}, aligned by elapsed time from each run's start.`
            : "No runs selected. Pick runs in the catalog and hit Compare."}
        </p>

        <div className="seg" style={{ margin: "18px 0 4px" }}>
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={metric === m.key ? "active" : ""}
            >
              {m.label}
            </button>
          ))}
        </div>

        {ids.length > 0 && (
          <div className="chart-card">
            <ResponsiveContainer width="100%" height={440}>
              <LineChart margin={{ top: 10, right: 24, bottom: 28, left: 8 }}>
                <CartesianGrid stroke="rgba(13,69,32,0.10)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="h"
                  type="number"
                  allowDuplicatedCategory={false}
                  domain={["dataMin", "dataMax"]}
                  tick={axisTick}
                  stroke="rgba(13,69,32,0.25)"
                  tickFormatter={(h) => `${(h as number).toFixed(1)}h`}
                  label={{ value: "elapsed (hours)", position: "insideBottom", offset: -14, fill: "#5e6b5e", fontSize: 12 }}
                />
                <YAxis
                  dataKey="v"
                  domain={metric === "co2_ppm" ? [400, "auto"] : ["auto", "auto"]}
                  allowDataOverflow={false}
                  tick={axisTick}
                  stroke="rgba(13,69,32,0.25)"
                  label={{ value: `${METRICS.find((m) => m.key === metric)!.label} (${unit})`, angle: -90, position: "insideLeft", fill: "#5e6b5e", fontSize: 12 }}
                />
                <Tooltip
                  formatter={(v) => `${v} ${unit}`}
                  labelFormatter={(h) => `${Number(h).toFixed(2)} h`}
                  contentStyle={{ borderRadius: 10, border: "1px solid rgba(13,69,32,0.12)", boxShadow: "0 4px 18px rgba(13,69,32,0.10)", fontFamily: "Outfit, sans-serif", fontSize: 13 }}
                />
                <Legend
                  iconSize={10}
                  wrapperStyle={{ fontSize: 13, fontFamily: "Outfit, sans-serif", paddingTop: 12, lineHeight: "1.7" }}
                />
                {metric === "co2_ppm" && (
                  <>
                    <ReferenceLine y={1000} stroke="#b87900" strokeDasharray="4 4" label={{ value: "ASHRAE 1000", fill: "#b87900", fontSize: 11, position: "insideTopRight" }} />
                    <ReferenceLine y={1400} stroke="#c6422c" strokeDasharray="4 4" label={{ value: "1400 impair", fill: "#c6422c", fontSize: 11, position: "insideTopRight" }} />
                  </>
                )}
                {loaded.map((l) => (
                  <Line
                    key={l.run.run_id || l.run.run_key}
                    data={l.pts}
                    dataKey="v"
                    name={l.run.condition || l.run.building}
                    stroke={l.color}
                    dot={false}
                    strokeWidth={1.8}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </main>
  );
}
