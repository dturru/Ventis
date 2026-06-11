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
        <h1 className="section-title">We closed the window. The fan kept running. CO₂ climbed anyway.</h1>
        <p className="lede">
          One overnight run in a real Dartmouth dorm room, same person, same room, logged at
          30-second resolution. We changed one thing across the night, the window, and watched
          what the air did. It is the cleanest answer we have to the question every student asks:
          <em> doesn't a fan fix this?</em>
        </p>

        {run && (
          <div className="card run-card hero-run" style={{ marginTop: 28 }}>
            <div className="run-head">
              <span className="run-tag">Within-run experiment · Fahey single</span>
              <div className="run-name">One room, one night, one variable: the window</div>
              <div className="run-peak">
                peak <b>979 ppm</b> · reached while the fan was running
              </div>
            </div>
            <Legend />
            <RunChart run={run} />
          </div>
        )}

        <div className="eyebrow" style={{ marginTop: 40 }}>What the three phases show</div>
        <div className="cta-grid" style={{ marginTop: 14 }}>
          <div className="cta-card">
            <h3>1 · Window open</h3>
            <p>Fan off. CO₂ sits low and flat, around 600 ppm. Fresh air is doing the work on its own.</p>
          </div>
          <div className="cta-card">
            <h3>2 · Window closed, fan on</h3>
            <p>
              The recirculating fan runs the entire phase. CO₂ still climbs past the 1,000 ppm
              guideline to a peak of <b>979 ppm</b>. Moving stale air around the room does not
              remove it.
            </p>
          </div>
          <div className="cta-card">
            <h3>3 · Window reopened</h3>
            <p>Fan off again. CO₂ flushes back down toward 550 ppm within the hour. Air exchange, not the fan, is the lever.</p>
          </div>
        </div>

        <div className="callout" style={{ marginTop: 32 }}>
          <strong>Why this matters.</strong> Indoor CO₂ tracks how much fresh air a room is getting,
          and above roughly 1,000 ppm studies link the rise to measurably slower focus and
          decision-making. The common fix, turning on a fan, recirculates the same air instead of
          exchanging it, so the number barely moves. Ventis automates the one thing that does work:
          bringing outdoor air in, on its own, when the conditions actually help.
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
