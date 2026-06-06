import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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

export default function RunTable() {
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

  if (err)
    return (
      <p style={{ color: "var(--red)", padding: 24 }}>
        Could not load catalog: {err}
      </p>
    );

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 22, marginBottom: 4 }}>Ventis Data Library</h1>
        <span style={{ fontSize: 14 }}>
          <Link to="/operations">Operations</Link>
          {" · "}
          <Link to="/about">About / export →</Link>
        </span>
      </div>
      <p style={{ color: "var(--muted)", marginBottom: 20 }}>
        {runs.length} run{runs.length === 1 ? "" : "s"} · CO₂ peaks above 1000 ppm
        flagged (ASHRAE)
      </p>

      <StatsBar runs={runs} />

      <input
        placeholder="🔍 search runs (building, condition, date…)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{
          width: "100%",
          padding: "8px 12px",
          marginBottom: 12,
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--tile)",
        }}
      />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
        {(["building", "condition", "occupancy", "date"] as (keyof Run)[]).map((k) => (
          <input
            key={k}
            placeholder={`filter ${k}`}
            value={(filters[k] as string) ?? ""}
            onChange={(e) => setFilter(k, e.target.value)}
            style={{
              padding: "6px 10px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--tile)",
            }}
          />
        ))}
        <Link
          to={`/compare?ids=${encodeURIComponent(Array.from(selected).join(","))}`}
          onClick={(e) => {
            if (selected.size < 2) {
              e.preventDefault();
            }
          }}
          style={{
            marginLeft: "auto",
            padding: "6px 14px",
            borderRadius: 6,
            background: selected.size >= 2 ? "var(--green)" : "var(--border)",
            color: selected.size >= 2 ? "#fff" : "var(--muted)",
            pointerEvents: selected.size >= 2 ? "auto" : "none",
          }}
          title={selected.size < 2 ? "Select 2+ runs to compare" : "Compare selected runs"}
        >
          Compare ({selected.size})
        </Link>
      </div>

      <div style={{ overflowX: "auto", boxShadow: "var(--shadow)", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", background: "var(--tile)" }}>
          <thead>
            <tr>
              <th style={{ borderBottom: "2px solid var(--border)", padding: "10px 12px" }} />
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    cursor: "pointer",
                    userSelect: "none",
                    borderBottom: "2px solid var(--border)",
                    color: "var(--green)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.label}
                  {sortBy === c.key ? (dir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
              <th style={{ borderBottom: "2px solid var(--border)" }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.run_id || r.run_key}
                style={{ background: i % 2 ? "var(--tile-alt)" : "var(--tile)" }}
              >
                <td style={cell}>
                  <input
                    type="checkbox"
                    checked={selected.has(r.run_id || r.run_key)}
                    onChange={() => toggleSelect(r.run_id || r.run_key)}
                    aria-label={`select ${r.condition}`}
                  />
                </td>
                <td style={cell}>{r.date}</td>
                <td style={cell}>{r.building}</td>
                <td style={cell}>{r.occupancy ?? "—"}</td>
                <td style={cell}>{r.condition}</td>
                <td style={cell}>{r.duration_h ?? "—"}</td>
                <td style={cell}>{r.co2_mean ?? "—"}</td>
                <td style={cell}>
                  {r.co2_peak ?? "—"}
                  {r.ashrae_exceed && (
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 11,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: "var(--red-light)",
                        color: "var(--red)",
                      }}
                    >
                      ASHRAE
                    </span>
                  )}
                </td>
                <td style={cell}>{r.n_rows}</td>
                <td style={cell}>
                  <Link to={`/run/${encodeURIComponent(r.run_id || r.run_key)}`}>
                    view →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const cell: React.CSSProperties = {
  padding: "9px 12px",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
};
