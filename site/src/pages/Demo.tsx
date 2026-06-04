import { Link } from 'react-router-dom'
import { DemoPlayer } from '../components/DemoPlayer'

export function Demo() {
  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 860 }}>
        <div className="eyebrow">Interactive Demo</div>
        <h1 className="section-title">Watch the room breathe.</h1>
        <p className="lede">
          Press play to replay a real overnight run — the CO₂ climbing, the window phases,
          and Dodi reacting to what it senses. Scrub anywhere in the night. No hardware needed.
        </p>

        <DemoPlayer />

        <p className="prose" style={{ color: 'var(--muted)', marginTop: 28 }}>
          Want the rest of the nights? The{' '}
          <Link to="/data" style={{ color: 'var(--green)', fontWeight: 600 }}>data page</Link>{' '}
          shows every run we’ve measured — Choates, the apartment, East Wheelock — all real,
          none simulated.
        </p>
      </div>
    </div>
  )
}
