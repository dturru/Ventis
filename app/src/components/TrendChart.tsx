import type { Sample } from '../types'

interface Props {
  samples: Sample[]
}

export function TrendChart({ samples }: Props) {
  if (samples.length < 2) {
    return (
      <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 13 }}>
        Collecting data…
      </div>
    )
  }

  const W = 600, H = 240, padL = 34, padB = 16
  const maxCo2 = Math.max(1200, ...samples.map(s => s.co2))
  const minCo2 = 400
  const tMin = samples[0].t, tMax = samples[samples.length - 1].t
  const tRange = tMax - tMin || 1

  const x = (t: number) => padL + ((t - tMin) / tRange) * (W - padL)
  const y = (ppm: number) => (H - padB) - ((ppm - minCo2) / (maxCo2 - minCo2)) * (H - padB)

  const yRed = y(1000), yAmber = y(800)
  const pts = samples.map(s => `${x(s.t).toFixed(1)},${y(s.co2).toFixed(1)}`).join(' ')
  const last = samples[samples.length - 1]
  const fillPts = `${x(samples[0].t).toFixed(1)},${H - padB} ` + pts + ` ${x(last.t).toFixed(1)},${H - padB}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 240, display: 'block' }}>
      <defs>
        <linearGradient id="trend-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1e6e3a" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#1e6e3a" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x={padL} y="0" width={W - padL} height={yRed} fill="#ffebee" opacity="0.6" />
      <rect x={padL} y={yRed} width={W - padL} height={yAmber - yRed} fill="#fff7e0" opacity="0.6" />
      <rect x={padL} y={yAmber} width={W - padL} height={(H - padB) - yAmber} fill="#e8f5e9" opacity="0.6" />
      <line x1={padL} y1={yRed} x2={W} y2={yRed} stroke="#c62828" strokeDasharray="4 4" opacity="0.5" />
      <line x1={padL} y1={yAmber} x2={W} y2={yAmber} stroke="#b87900" strokeDasharray="4 4" opacity="0.5" />
      <text x="2" y={yRed + 4} fontSize="13" fill="#5e6b5e">1000</text>
      <text x="6" y={yAmber + 4} fontSize="13" fill="#5e6b5e">800</text>
      <polygon points={fillPts} fill="url(#trend-grad)" />
      <polyline points={pts} fill="none" stroke="#1e6e3a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(last.t).toFixed(1)} cy={y(last.co2).toFixed(1)} r="5" fill="#1e6e3a" />
    </svg>
  )
}
