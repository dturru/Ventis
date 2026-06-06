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

const PALETTE = ["#1e6e3a", "#c62828", "#1565c0", "#b87900", "#6a1b9a", "#00838f"];

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

  if (err) return <div style={wrap}><Link to="/">← back</Link><p style={{ color: "var(--red)" }}>{err}</p></div>;

  return (
    <div style={wrap}>
      <Link to="/">← back to catalog</Link>
      <h1 style={{ fontSize: 22, margin: "12px 0 4px" }}>Compare runs</h1>
      <p style={{ color: "var(--muted)", marginBottom: 16 }}>
        {ids.length
          ? `${ids.length} run${ids.length === 1 ? "" : "s"} · aligned by elapsed time from each run's start`
          : "No runs selected — pick runs in the catalog and hit Compare."}
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {METRICS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: metric === m.key ? "var(--green)" : "var(--tile)",
              color: metric === m.key ? "#fff" : "var(--fg)",
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {ids.length > 0 && (
        <div style={{ background: "var(--tile)", padding: 16, borderRadius: 8, boxShadow: "var(--shadow)" }}>
          <ResponsiveContainer width="100%" height={420}>
            <LineChart margin={{ top: 8, right: 24, bottom: 24, left: 8 }}>
              <CartesianGrid strokeOpacity={0.25} />
              <XAxis
                dataKey="h"
                type="number"
                allowDuplicatedCategory={false}
                domain={["dataMin", "dataMax"]}
                tickFormatter={(h) => `${(h as number).toFixed(1)}h`}
                label={{ value: "elapsed (hours)", position: "insideBottom", offset: -12 }}
              />
              <YAxis
                dataKey="v"
                domain={["auto", "auto"]}
                label={{ value: `${METRICS.find((m) => m.key === metric)!.label} (${unit})`, angle: -90, position: "insideLeft" }}
              />
              <Tooltip
                formatter={(v) => `${v} ${unit}`}
                labelFormatter={(h) => `${Number(h).toFixed(2)} h`}
              />
              <Legend />
              {metric === "co2_ppm" && (
                <>
                  <ReferenceLine y={1000} stroke="#b87900" strokeDasharray="4 4" label="ASHRAE 1000" />
                  <ReferenceLine y={1400} stroke="#c62828" strokeDasharray="4 4" label="1400 impair" />
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
                  strokeWidth={1.6}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

const wrap: React.CSSProperties = { maxWidth: 980, margin: "0 auto", padding: 24 };
