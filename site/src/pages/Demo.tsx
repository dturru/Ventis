import { Link } from 'react-router-dom'

export function Demo() {
  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 860 }}>
        <div className="eyebrow">Interactive Demo</div>
        <h1 className="section-title">Watch the room breathe.</h1>
        <p className="lede">
          A live, playable version of the Ventis dashboard — CO₂ climbing, the fan kicking
          on, Dodi reacting in real time — is coming here next.
        </p>

        <div className="demo-shell">
          <div>
            <span className="badge">▶ Interactive demo coming soon</span>
            <div className="play" aria-hidden>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="#1e6e3a">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <h3>The dashboard, playable</h3>
            <p>
              We’ll drop the real Ventis dashboard here running on a recorded overnight
              run — no hardware needed. You’ll scrub through a night and see exactly what
              Dodi sees.
            </p>
          </div>
        </div>

        <p className="prose" style={{ color: 'var(--muted)' }}>
          In the meantime, the <Link to="/data" style={{ color: 'var(--green)', fontWeight: 600 }}>data page</Link> shows
          the same overnight runs the demo will replay — measured, not simulated.
        </p>
      </div>
    </div>
  )
}
