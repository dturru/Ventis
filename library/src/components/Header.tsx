import { NavLink, Link } from "react-router-dom";

// Air-flow brand mark — mirrors the public site's nav (site/src/components/Nav.tsx).
const MARK = (
  <span className="lib-mark">
    <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M8 10 h11 a4 4 0 0 1 0 8 h-7" fill="none" stroke="#edf2ed" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M8 16 h14 a3.4 3.4 0 0 1 0 6.8 h-5" fill="none" stroke="#9fd9b0" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M8 22 h8" fill="none" stroke="#edf2ed" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  </span>
);

const LINKS = [
  { to: "/", label: "Runs", end: true },
  { to: "/coverage", label: "Coverage", end: false },
  { to: "/compare", label: "Compare", end: false },
  { to: "/about", label: "About", end: false },
  { to: "/operations", label: "Operations", end: false },
  { to: "/curate", label: "Curate", end: false },
];

export function Header() {
  return (
    <nav className="lib-nav">
      <div className="wrap">
        <Link to="/" className="lib-brand">
          {MARK}
          <span className="lib-word">
            Ventis<span className="sub">Data Library</span>
          </span>
        </Link>
        <div className="lib-right">
          <div className="lib-links">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? "active" : "")}>
                {l.label}
              </NavLink>
            ))}
          </div>
          <span className="lib-lock" title="Private research catalog — gated access">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            Private
          </span>
        </div>
      </div>
    </nav>
  );
}

export function Footer() {
  return (
    <footer className="lib-footer">
      <div className="wrap">
        <div>
          <div className="fb">Ventis</div>
          <p className="fn">
            Private research catalog. Air-quality runs are de-identified by design and recorded with consent provenance.
          </p>
        </div>
        <div className="lib-foot-links" style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <Link to="/about">About + export</Link>
          <Link to="/operations">Operations</Link>
          <a href="https://ventis.vercel.app" target="_blank" rel="noreferrer">ventis.vercel.app</a>
        </div>
      </div>
    </footer>
  );
}
