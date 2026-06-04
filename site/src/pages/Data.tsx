import { Link } from 'react-router-dom'
import { getRuns, type Run } from '../data/runs'
import { RunChart } from '../components/RunChart'

function Legend({ run }: { run: Run }) {
  return (
    <div className="chart-legend">
      <span className="swatch"><i style={{ background: '#1e6e3a' }} /> CO₂ (ppm)</span>
      {run.phases && (
        <>
          <span className="swatch"><i style={{ background: 'rgba(30,110,58,0.4)' }} /> window open</span>
          <span className="swatch"><i style={{ background: 'rgba(198,66,44,0.45)' }} /> window closed · fan 100%</span>
        </>
      )}
      <span className="swatch"><i className="dash" /> ASHRAE 1,000 ppm</span>
    </div>
  )
}

function RunCard({ run, hero }: { run: Run; hero?: boolean }) {
  const showLegend = hero || !!run.phases
  return (
    <div className={`card run-card${hero ? ' hero-run' : ''}`}>
      <div className="run-head">
        <span className="run-tag">{run.tag}</span>
        <div className="run-name">{run.name}</div>
        <div className="run-peak">
          peak <b>{run.peakLabel.toLocaleString()} ppm</b> · {run.peakNote}
        </div>
        <p className="run-frame">{run.framing}</p>
        <p className="run-take">{run.takeaway}</p>
      </div>
      {showLegend && <Legend run={run} />}
      <RunChart run={run} />
    </div>
  )
}

export function Data() {
  const runs = getRuns()
  const hero = runs.find((r) => r.hero)
  const rest = runs.filter((r) => !r.hero)

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 900 }}>
        <div className="eyebrow">The Data</div>
        <h1 className="section-title">Real rooms. Real nights. Measured.</h1>
        <p className="lede">
          Every line below is measured CO₂ from a real Dartmouth-area room, logged at
          30-second resolution. We include the runs that help our case and the ones that don’t.
        </p>

        {hero && (
          <>
            <div style={{ marginTop: 32 }} className="eyebrow">What students are actually breathing</div>
            <RunCard run={hero} hero />
          </>
        )}

        <div style={{ marginTop: 40 }} className="eyebrow">The rest of the picture</div>
        {rest.map((run) => (
          <RunCard key={run.id} run={run} />
        ))}

        <p className="data-note">
          Lines are 5-minute averages of 30-second sensor readings; the peak figure is the
          absolute single-sample maximum. Outdoor temperature, fan state, and window state are
          logged alongside each run. No values are estimated or illustrative. The 1,000 ppm
          reference line follows widely used indoor-CO₂ guidance; the basis and full citations
          are on the{' '}
          <Link to="/problem" style={{ color: 'var(--green)', fontWeight: 600 }}>Problem page</Link>.
        </p>
      </div>
    </div>
  )
}
