import { useState } from 'react'
import { NavLink, Link } from 'react-router-dom'
import { residentsCTA } from '../site.config'

const LINKS = [
  { to: '/problem', label: 'The Problem' },
  { to: '/how', label: 'How It Works' },
  { to: '/proof', label: 'The Proof' },
  { to: '/data', label: 'The Data' },
  { to: '/demo', label: 'Demo' },
  { to: '/get-involved', label: 'Get Involved' },
]

export function Nav() {
  const [open, setOpen] = useState(false)
  return (
    <nav className="nav">
      <div className="wrap">
        <Link to="/" className="brand" onClick={() => setOpen(false)}>
          <span className="brand-mark">
            <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden>
              <path d="M8 10 h11 a4 4 0 0 1 0 8 h-7" fill="none" stroke="#edf2ed" strokeWidth="2.6" strokeLinecap="round" />
              <path d="M8 16 h14 a3.4 3.4 0 0 1 0 6.8 h-5" fill="none" stroke="#9fd9b0" strokeWidth="2.6" strokeLinecap="round" />
              <path d="M8 22 h8" fill="none" stroke="#edf2ed" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
          </span>
          <span className="brand-word">Ventis</span>
        </Link>

        <button className="nav-toggle" aria-label="Menu" onClick={() => setOpen((o) => !o)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {open ? <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /> : <><path d="M4 7h16" strokeLinecap="round" /><path d="M4 12h16" strokeLinecap="round" /><path d="M4 17h16" strokeLinecap="round" /></>}
          </svg>
        </button>

        <div className={`nav-links ${open ? 'open' : ''}`}>
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} onClick={() => setOpen(false)}>
              {l.label}
            </NavLink>
          ))}
          <a className="nav-cta" href={residentsCTA} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            Get early access
          </a>
        </div>
      </div>
    </nav>
  )
}
