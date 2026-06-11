import { Fragment, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { loadCatalog, type Run } from "../lib/catalog";

function tier(peak: number | null): "green" | "amber" | "red" | null {
  if (peak == null) return null;
  if (peak >= 1000) return "red";
  if (peak >= 800) return "amber";
  return "green";
}

export default function RunDetail() {
  const { run_id } = useParams<{ run_id: string }>();
  const [run, setRun] = useState<Run | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    loadCatalog()
      .then((runs) => {
        const found = runs.find((r) => (r.run_id || r.run_key) === run_id);
        if (found) setRun(found);
        else setNotFound(true);
      })
      .catch(() => setNotFound(true));
  }, [run_id]);

  if (notFound)
    return (
      <main className="lib-main">
        <div className="wrap" style={{ maxWidth: 880 }}>
          <Link to="/" className="back-link"><span className="arr">←</span> back to catalog</Link>
          <p className="state">Run not found: {run_id}</p>
        </div>
      </main>
    );
  if (!run)
    return (
      <main className="lib-main">
        <div className="wrap"><p className="state">Loading…</p></div>
      </main>
    );

  const t = tier(run.co2_peak);
  const noted = (f: string) => (run.attr_overrides?.includes(f) ? " (noted)" : "");
  const rows: [string, React.ReactNode][] = [
    ["Building", run.building || "·"],
    ["Condition", run.condition || "·"],
    ["Scenario", run.scenario || "·"],
    ["Occupancy", (run.occupancy ?? "·") + noted("occupancy")],
    ["Window", (run.window || "·") + noted("window")],
    ["Fan", (run.fan || "·") + noted("fan")],
    ["Window (logged)", run.window_state || "·"],
    ["Start", <span className="num">{run.start || "·"}</span>],
    ["End", <span className="num">{run.end || "·"}</span>],
    ["Duration", run.duration_h != null ? <span className="num">{run.duration_h} h</span> : "·"],
    ["Readings", <span className="num">{run.n_rows ?? "·"}</span>],
    ["CO₂ mean", run.co2_mean != null ? <span className="num">{run.co2_mean} ppm</span> : "·"],
    [
      "CO₂ peak",
      run.co2_peak != null ? (
        <span className={`chip chip-${t}`}><span className="dot" />{run.co2_peak} ppm</span>
      ) : (
        "·"
      ),
    ],
    [
      "Consent",
      run.consent_status === "verified" ? (
        <span className="badge badge-green" style={{ marginLeft: 0 }}>
          verified{run.consent_method ? ` · ${run.consent_method}` : ""}
          {run.consent_date ? ` · ${run.consent_date}` : ""}
        </span>
      ) : (
        <span className="badge badge-amber" style={{ marginLeft: 0 }}>unverified</span>
      ),
    ],
    [
      "Quality",
      run.quality_flag ? (
        <span
          className={`badge ${
            run.quality_flag === "exclude" ? "badge-red" : run.quality_flag === "caution" ? "badge-amber" : "badge-green"
          }`}
          style={{ marginLeft: 0 }}
        >
          {run.quality_flag}
        </span>
      ) : (
        "·"
      ),
    ],
    ["Note", run.note || "·"],
    ["Run ID", <span className="num num-dim">{run.run_id || run.run_key}</span>],
  ];

  return (
    <main className="lib-main">
      <div className="wrap" style={{ maxWidth: 880 }}>
        <Link to="/" className="back-link"><span className="arr">←</span> back to catalog</Link>

        <div className="detail-head">
          <div>
            <div className="eyebrow">{run.date}</div>
            <h1 className="page-title">{run.building || run.condition || "Run"}</h1>
          </div>
          <a className="dl-csv" href={`/data/csv/${run.csv}`} download={run.csv}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <path d="M12 3v12" strokeLinecap="round" />
              <path d="M7 11l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5 21h14" strokeLinecap="round" />
            </svg>
            Download raw CSV
          </a>
        </div>

        <img
          className="detail-chart"
          src={`/data/charts/${run.chart}`}
          alt={`CO₂ chart for ${run.condition}`}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />

        <dl className="def-grid">
          {rows.map(([k, v]) => (
            <Fragment key={k as string}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </Fragment>
          ))}
        </dl>

        {run.notes && (
          <div className="prose" style={{ marginTop: 26 }}>
            <h2>Notes</h2>
            <p>{run.notes}</p>
          </div>
        )}
      </div>
    </main>
  );
}
