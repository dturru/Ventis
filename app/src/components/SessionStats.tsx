import type { Sample } from '../types'

interface Props {
  samples: Sample[]
}

function classifyPpm(co2: number): 'green' | 'amber' | 'red' {
  if (co2 < 800) return 'green'
  if (co2 < 1000) return 'amber'
  return 'red'
}

function fmtMin(ms: number): string {
  const m = Math.round(ms / 60000)
  if (m < 1) return '<1 min'
  return `${m} min`
}

export function SessionStats({ samples }: Props) {
  if (samples.length < 3) return null

  const intervalMs = samples.length > 1
    ? (samples[samples.length - 1].t - samples[0].t) / (samples.length - 1)
    : 30000

  let greenMs = 0, amberMs = 0, redMs = 0
  for (const s of samples) {
    const tier = classifyPpm(s.co2)
    if (tier === 'green') greenMs += intervalMs
    else if (tier === 'amber') amberMs += intervalMs
    else redMs += intervalMs
  }

  const totalMs = greenMs + amberMs + redMs
  const greenPct = (greenMs / totalMs) * 100
  const amberPct = (amberMs / totalMs) * 100
  const redPct   = (redMs   / totalMs) * 100

  return (
    <div style={{
      background: 'var(--tile)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '14px 16px',
      marginBottom: 12,
      boxShadow: 'var(--shadow)',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 10 }}>
        This session
      </div>

      {/* Stacked bar */}
      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 10, gap: 1 }}>
        {greenPct > 0 && <div style={{ width: `${greenPct}%`, background: 'var(--green)', opacity: 0.85 }} />}
        {amberPct > 0 && <div style={{ width: `${amberPct}%`, background: 'var(--amber)', opacity: 0.85 }} />}
        {redPct   > 0 && <div style={{ width: `${redPct}%`,   background: 'var(--red)',   opacity: 0.85 }} />}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14 }}>
        {[
          { color: 'var(--green)', label: 'Fresh', ms: greenMs },
          { color: 'var(--amber)', label: 'Stuffy', ms: amberMs },
          { color: 'var(--red)',   label: 'High CO₂', ms: redMs },
        ].filter(r => r.ms > 0).map(row => (
          <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: row.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              <span style={{ fontWeight: 600, color: 'var(--fg)' }}>{fmtMin(row.ms)}</span> {row.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
