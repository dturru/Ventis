import { Link } from 'react-router-dom'
import { getRun, type Run } from '../data/runs'
import { RunChart } from '../components/RunChart'
import { residentsCTA } from '../site.config'

function Legend() {
  return (
    <div className="chart-legend">
      <span className="swatch"><i style={{ background: '#1e6e3a' }} /> CO₂ (ppm)</span>
      <span className="swatch"><i style={{ background: 'rgba(30,110,58,0.4)' }} /> window open</span>
      <span className="swatch"><i style={{ background: 'rgba(198,66,44,0.45)' }} /> window closed · fan running</span>
      <span className="swatch"><i className="dash" /> ASHRAE 1,000 ppm</span>
    </div>
  )
}

export function Proof() {
  const fahey = getRun('fahey')
  const run: Run | undefined = fahey ? { ...fahey, hero: true } : undefined

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 900 }}>
        <div className="eyebrow">The proof</div>
        <h1 className="section-title">The window was open. Then it closed for the night.</h1>
        <p className="lede">
          One real overnight run in a Dartmouth dorm, logged at 30-second resolution. Early on the
          window is open and the air is fine. Then, the way it goes most nights, it closes, for
          warmth, for quiet, for sleep. The fix was free and right there, and a real person stopped
          using it at exactly the hours it mattered most. Watch what the air does over the next
          eight hours, while no one is awake to notice.
        </p>

        {run && (
          <div className="card run-card hero-run" style={{ marginTop: 28 }}>
            <div className="run-head">
              <span className="run-tag">Within-run experiment · Fahey single</span>
              <div className="run-name">One overnight run, a real dorm, a free fix left unused</div>
              <div className="run-peak">
                peak <b>979 ppm</b> · reached overnight, while the room slept
              </div>
            </div>
            <Legend />
            <RunChart run={run} />
          </div>
        )}

        <h2 className="section-title" style={{ marginTop: 40, fontSize: 26 }}>What the three phases show</h2>
        <div className="cta-grid" style={{ marginTop: 14 }}>
          <div className="cta-card">
            <h3>1 · Window open</h3>
            <p>The air is fine. CO₂ sits low and flat, around 600 ppm. The free fix works, while it is actually in use.</p>
          </div>
          <div className="cta-card">
            <h3>2 · Closed for the night</h3>
            <p>
              The window shuts for warmth and sleep. Over the next hours CO₂ climbs toward the
              1,000 ppm guideline, peaking at <b>979 ppm</b>, and no one is awake to notice.
              (A fan ran the whole time. Moving air around a closed room is not the same as
              bringing fresh air in, so it barely moved the number.)
            </p>
          </div>
          <div className="cta-card">
            <h3>3 · Morning, window reopened</h3>
            <p>CO₂ flushes back toward 550 ppm within the hour. The fix still works. It just was not in use for the eight hours that counted.</p>
          </div>
        </div>

        <div className="callout" style={{ marginTop: 32 }}>
          <strong>Why this matters.</strong> Ventis does not compete with an open window. It
          competes with forgetting it, with freezing if you leave it open in January, and with not
          being able to feel the problem in the first place, since nothing about 1,000 ppm registers
          as you fall asleep. Above that level studies link rising indoor CO₂ to measurably slower
          focus and decision-making. Ventis senses the air and brings in outdoor air on its own,
          only when the conditions make it worth it, so the room stays fresh through the hours you
          are not awake to manage it.
        </div>

        <div className="cta-card feature" style={{ marginTop: 32 }}>
          <h3>See this in your building</h3>
          <p>
            We are running this measurement in more rooms across campus. If you manage housing or
            study indoor air quality and want to see what your spaces are actually doing, we will
            bring a logger to you.
          </p>
          <div className="hero-actions" style={{ marginTop: 16 }}>
            <Link to="/contact" className="btn btn-primary">
              Replicate this in your building <span className="btn-arrow">→</span>
            </Link>
            <a href={residentsCTA} target="_blank" rel="noreferrer" className="btn btn-ghost">
              Get early access
            </a>
          </div>
        </div>

        <p className="data-note">
          One run, shown to demonstrate the mechanism, not a population statistic. CO₂, temperature,
          humidity, and fan state are device-logged at 30-second resolution; the line is a 5-minute
          average and the peak is the absolute single-sample maximum. Window state (open, closed,
          reopened) is recorded by the operator, not the sensor. The CO₂ sensor is accurate to about
          ±50 ppm, so the story is in the relative shape, not any single absolute value. The 1,000 ppm
          reference follows widely used indoor-air guidance, cited on the{' '}
          <Link to="/problem" style={{ color: 'var(--green)', fontWeight: 600 }}>Problem page</Link>.
        </p>
      </div>
    </div>
  )
}
