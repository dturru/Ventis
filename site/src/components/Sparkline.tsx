import type { Run } from '../data/runs'

const GREEN = '#1e6e3a'
const RED = '#c6422c'

// Compact, axis-free trace for supporting runs on /data. The full RunChart is
// reserved for the hero + causal (window-experiment) runs; secondary rooms get
// this so four near-identical full charts don't dull the reader's focus.
export function Sparkline({ run }: { run: Run }) {
  const W = 200
  const H = 52
  const padX = 2
  const padTop = 6
  const padBot = 4

  const pts = run.points
  if (pts.length === 0) return null

  const xs = pts.map((p) => p.hod)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMin = 400
  const yMax = Math.max(1200, Math.ceil((run.peakLabel + 120) / 100) * 100)

  const sx = (x: number) => padX + ((x - xMin) / (xMax - xMin || 1)) * (W - 2 * padX)
  const sy = (y: number) =>
    padTop + (1 - (Math.min(Math.max(y, yMin), yMax) - yMin) / (yMax - yMin)) * (H - padTop - padBot)

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.hod).toFixed(1)},${sy(p.co2).toFixed(1)}`).join(' ')
  const area = `${line} L${sx(xMax).toFixed(1)},${(H - padBot).toFixed(1)} L${sx(xMin).toFixed(1)},${(H - padBot).toFixed(1)} Z`

  const yAsh = sy(1000)
  const peak = pts.reduce((a, b) => (b.co2 > a.co2 ? b : a), pts[0])

  return (
    <svg
      className="spark"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${run.name}: CO₂ peaked at ${run.peakLabel.toLocaleString()} ppm`}
    >
      <defs>
        <linearGradient id={`sg-${run.id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={GREEN} stopOpacity={0.18} />
          <stop offset="100%" stopColor={GREEN} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      {yAsh > padTop && yAsh < H - padBot && (
        <line
          x1={padX}
          x2={W - padX}
          y1={yAsh}
          y2={yAsh}
          stroke={RED}
          strokeOpacity={0.5}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      )}
      <path d={area} fill={`url(#sg-${run.id})`} />
      <path d={line} fill="none" stroke={GREEN} strokeWidth={1.6} strokeLinejoin="round" />
      <circle cx={sx(peak.hod)} cy={sy(peak.co2)} r={2.6} fill={RED} />
    </svg>
  )
}
