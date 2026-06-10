import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { loadCatalog, filterRuns, sortRuns, searchRuns, type Run } from "../lib/catalog";
import StatsBar from "./StatsBar";

type SortKey = keyof Run;

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "building", label: "Building" },
  { key: "occupancy", label: "Occ" },
  { key: "condition", label: "Condition" },
  { key: "duration_h", label: "Hrs" },
  { key: "co2_mean", label: "CO₂ mean" },
  { key: "co2_peak", label: "CO₂ peak" },
  { key: "n_rows", label: "Rows" },
];

/** CO₂ peak → semantic air tier. */
function tier(peak: number | null): "green" | "amber" | "red" | null {
  if (peak == null) return null;
  if (peak >= 1000) return "red";
  if (peak >= 800) return "amber";
  return "green";
}

export default function RunTable() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<Run[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [filters, setFilters] = useState<Partial<Record<keyof Run, string>>>({});
  const [sortBy, setSortBy] = useState<SortKey>("date");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  useEffect(() => {
    loadCatalog()
      .then(setRuns)
      .catch((e) => setErr(String(e)));
  }, []);

  const rows = useMemo(() => {
    const active = Object.fromEntries(
      Object.entries(filters).filter(([, v]) => v !== "" && v != null)
    );
    return sortRuns(filterRuns(searchRuns(runs, query), active), sortBy, dir);
  }, [runs, query, filters, sortBy, dir]);

  function toggleSort(key: SortKey) {
    if (key === sortBy) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setSortBy(key);
      setDir("desc");
    }
  }

  function setFilter(key: keyof Run, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  const canCompare = selected.size >= 2;

  if (err)
    return (
      <main className="lib-main">
        <div className="wrap">
          <p className="state state-err">Could not load catalog: {err}</p>
        </div>
      </main>
    );

  return (
    <main className="lib-main">
      <div className="wrap">
        <div className="eyebrow">Indoor-air dataset</div>
        <h1 className="page-title">Run catalog</h1>
        <p className="page-lede">
          {runs.length} run{runs.length === 1 ? "" : "s"} of overnight CO₂, temperature, and
          humidity from real rooms. Peaks above ASHRAE 1,000 ppm are flagged red.
        </p>

        <StatsBar runs={runs} />

        <div className="toolbar">
          <label className="lib-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
            </svg>
            <input
              className="lib-input"
              placeholder="Search runs (building, condition, date)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search runs"
            />
          </label>

          {(["building", "condition", "occupancy", "date"] as (keyof Run)[]).map((k) => (
            <input
              key={k}
              className="lib-input filter-input"
              placeholder={`filter ${k}`}
              value={(filters[k] as string) ?? ""}
              onChange={(e) => setFilter(k, e.target.value)}
              aria-label={`Filter by ${k}`}
            />
          ))}

          <Link
            to={`/compare?ids=${encodeURIComponent(Array.from(selected).join(","))}`}
            onClick={(e) => {
              if (!canCompare) e.preventDefault();
            }}
            className={`btn-compare ${canCompare ? "on" : "off"}`}
            title={canCompare ? "Compare selected runs" : "Select 2+ runs to compare"}
          >
            Compare ({selected.size})
          </Link>
        </div>

        <div className="table-wrap">
          <div className="table-scroll">
            <table className="run-table">
              <thead>
                <tr>
                  <th className="plain" aria-label="select" />
                  {COLUMNS.map((c) => (
                    <th key={c.key} onClick={() => toggleSort(c.key)}>
                      {c.label}
                      {sortBy === c.key && <span className="arr">{dir === "asc" ? "▲" : "▼"}</span>}
                    </th>
                  ))}
                  <th className="plain" aria-label="open" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const id = r.run_id || r.run_key;
                  const t = tier(r.co2_peak);
                  return (
                    <tr key={id} onClick={() => navigate(`/run/${encodeURIComponent(id)}`)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          className="run-check"
                          type="checkbox"
                          checked={selected.has(id)}
                          onChange={() => toggleSelect(id)}
                          aria-label={`select ${r.condition}`}
                        />
                      </td>
                      <td>{r.date}</td>
                      <td className="cell-name">{r.building}</td>
                      <td className="num">{r.occupancy ?? <span className="num-dim">·</span>}</td>
                      <td className="cell-sub">{r.condition}</td>
                      <td className="num">{r.duration_h ?? <span className="num-dim">·</span>}</td>
                      <td className="num">{r.co2_mean ?? <span className="num-dim">·</span>}</td>
                      <td>
                        {t ? (
                          <span className={`chip chip-${t}`}>
                            <span className="dot" />
                            {r.co2_peak}
                          </span>
                        ) : (
                          <span className="num-dim">·</span>
                        )}
                        {(r.quality_flag === "exclude" || r.quality_flag === "caution") && (
                          <span className={`badge ${r.quality_flag === "exclude" ? "badge-red" : "badge-amber"}`}>
                            {r.quality_flag}
                          </span>
                        )}
                      </td>
                      <td className="num num-dim">{r.n_rows}</td>
                      <td>
                        <span className="row-view">
                          view <span className="arr">→</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
