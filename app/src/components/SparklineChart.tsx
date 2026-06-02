import type { Sample } from '../types'

interface Props {
  samples: Sample[]
  height?: number
}

export function SparklineChart({ samples, height = 60 }: Props) {
  if (samples.length < 2) return <svg style={{ width: '100%', height }} />

  const W = 600, H = height * 10
  const maxCo2 = Math.max(1200, ...samples.map(s => s.co2))
  const minCo2 = 400
  const tMin = samples[0].t, tMax = samples[samples.length - 1].t
  const tRange = tMax - tMin || 1

  const x = (t: number) => ((t - tMin) / tRange) * W
  const y = (ppm: number) => H - ((ppm - minCo2) / (maxCo2 - minCo2)) * H

  const yRed = y(1000), yAmber = y(800)
  const pts = samples.map(s => `${x(s.t).toFixed(1)},${y(s.co2).toFixed(1)}`).join(' ')
  const last = samples[samples.length - 1]
  const fillPts = `${x(samples[0].t).toFixed(1)},${H} ` + pts + ` ${x(last.t).toFixed(1)},${H}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block', marginTop: 6 }}>
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1e6e3a" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#1e6e3a" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={W} height={yRed} fill="#ffebee" opacity="0.7" />
      <rect x="0" y={yRed} width={W} height={yAmber - yRed} fill="#fff7e0" opacity="0.7" />
      <rect x="0" y={yAmber} width={W} height={H - yAmber} fill="#e8f5e9" opacity="0.7" />
      <line x1="0" y1={yRed} x2={W} y2={yRed} stroke="#c62828" strokeDasharray="4 4" opacity="0.4" />
      <line x1="0" y1={yAmber} x2={W} y2={yAmber} stroke="#b87900" strokeDasharray="4 4" opacity="0.4" />
      <polygon points={fillPts} fill="url(#spark-grad)" />
      <polyline points={pts} fill="none" stroke="#1e6e3a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(last.t).toFixed(1)} cy={y(last.co2).toFixed(1)} r="5" fill="#1e6e3a" />
    </svg>
  )
}
