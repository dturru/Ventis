import { Link } from 'react-router-dom'

export function Problem() {
  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 860 }}>
        <div className="eyebrow">The Problem</div>
        <h1 className="section-title">You can’t manage the air you can’t feel.</h1>
        <p className="lede">
          Every Dartmouth dorm was built before central air. Overnight, a closed room
          fills with the CO₂ you breathe back out — and nothing about it feels wrong
          until your sleep and your focus have already paid for it.
        </p>

        <div className="points-grid">
          <div className="point">
            <div className="point-k">01</div>
            <div className="point-h">CO₂ is invisible</div>
            <p className="point-p">
              No human sensation maps to 1,100 ppm. There’s no smell, no alarm, no
              cue. You can’t manage what you can’t measure — so nobody does.
            </p>
          </div>
          <div className="point">
            <div className="point-k">02</div>
            <div className="point-h">It peaks while you sleep</div>
            <p className="point-p">
              The window is a one-shot decision at bedtime. CO₂, outdoor temperature,
              rain and noise all change over the next eight hours — and you’re
              unconscious for every one of them.
            </p>
          </div>
          <div className="point">
            <div className="point-k">03</div>
            <div className="point-h">The cost is real</div>
            <p className="point-p">
              Elevated overnight CO₂ measurably degrades sleep and next-day cognition
              (Harvard’s Healthy Buildings / COGfx work, Joseph Allen). The honest
              framing isn’t “stuffy vs. fresh” — it’s <strong>impaired vs. sharp.</strong>
            </p>
          </div>
        </div>

        <div className="prose">
          <h2 className="section-title" style={{ fontSize: 26, marginTop: 8 }}>
            “Why not just open a window?”
          </h2>
          <p>
            A window is <strong>excellent</strong> ventilation — Ventis doesn’t claim to
            beat one on physics. It competes against human behavior. An open window only
            works <em>if</em> you know when you need it and you’re awake to act on it. For
            the eight hours that matter, you’re neither.
          </p>
          <p>
            And for seven months a year in Hanover, an open window overnight means a
            freezing room. The real student choice is “freeze vs. stuffy,” and people
            reliably pick warm — exactly when ventilation is needed most.
          </p>
        </div>

        <div className="callout">
          We watched a real occupant do exactly this: window open and ventilating
          perfectly at ~650 ppm, then closed at bedtime for warmth — and CO₂ climbed all
          night, even with the fan running. The free option was right there, and a real
          person turned it off. <Link to="/data" style={{ color: 'var(--green)', fontWeight: 600 }}>See that run →</Link>
        </div>

        <div className="callout amber">
          <strong>We’re honest about the limit.</strong> CO₂ only leaves through air
          exchange with outdoors — filters and AC don’t remove it. So v1/v2 are a
          shoulder-season product; the year-round winter answer is heat-recovery
          ventilation (v3). We don’t pretend otherwise.
        </div>
      </div>
    </div>
  )
}
