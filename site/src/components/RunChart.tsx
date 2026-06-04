import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ReferenceArea,
  Tooltip,
} from 'recharts'
import type { Run } from '../data/runs'

const GREEN = '#1e6e3a'
const RED = '#c6422c'
const FAINT = '#8a958a'

function fmtClock(hod: number): string {
  const h24 = ((Math.floor(hod) % 24) + 24) % 24
  const m = Math.round((hod - Math.floor(hod)) * 60)
  const ampm = h24 < 12 ? 'AM' : 'PM'
  let h = h24 % 12
  if (h === 0) h = 12
  return `${h}:${m.toString().padStart(2, '0')} ${ampm}`
}

function CustomTip({ active, payload }: { active?: boolean; payload?: any[] }) {
  if (!active || !payload || !payload.length) return null
  const p = payload[0].payload
  return (
    <div className="tip">
      <div className="tip-co2">{p.co2} ppm</div>
      <div className="tip-t">{fmtClock(p.hod)}</div>
      {p.fan !== undefined && <div className="tip-t">fan {p.fan}%</div>}
    </div>
  )
}

export function RunChart({ run }: { run: Run }) {
  const data = run.points
  const xs = data.map((d) => d.hod)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMax = Math.max(1200, Math.ceil((run.peakLabel + 120) / 100) * 100)

  // ~5 evenly spaced clock ticks
  const ticks: number[] = []
  const step = (xMax - xMin) / 4
  for (let i = 0; i <= 4; i++) ticks.push(Math.round((xMin + step * i) * 10) / 10)

  return (
    <div className="chart-box">
      <ResponsiveContainer width="100%" height={run.hero ? 300 : 240}>
        <ComposedChart data={data} margin={{ top: 10, right: 14, left: 0, bottom: 4 }}>
          <defs>
            <linearGradient id={`g-${run.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={GREEN} stopOpacity={0.22} />
              <stop offset="100%" stopColor={GREEN} stopOpacity={0.02} />
            </linearGradient>
          </defs>

          {/* window-phase shading (Fahey hero) */}
          {run.phases?.map((ph, i) => (
            <ReferenceArea
              key={i}
              x1={ph.from}
              x2={ph.to}
              fill={ph.kind === 'closed' ? RED : GREEN}
              fillOpacity={ph.kind === 'closed' ? 0.06 : 0.05}
              label={{
                value: ph.label,
                position: 'insideTop',
                fontSize: 10,
                fill: ph.kind === 'closed' ? RED : GREEN,
                fontWeight: 600,
              }}
            />
          ))}

          <CartesianGrid stroke="rgba(13,69,32,0.06)" vertical={false} />
          <XAxis
            dataKey="hod"
            type="number"
            domain={[xMin, xMax]}
            ticks={ticks}
            tickFormatter={fmtClock}
            tick={{ fontSize: 11, fill: FAINT }}
            tickLine={false}
            axisLine={{ stroke: 'rgba(13,69,32,0.12)' }}
          />
          <YAxis
            domain={[400, yMax]}
            tick={{ fontSize: 11, fill: FAINT }}
            tickLine={false}
            axisLine={false}
            width={42}
            label={{ value: 'ppm', angle: -90, position: 'insideLeft', fontSize: 10, fill: FAINT, dy: 20 }}
          />

          {/* ASHRAE 1,000 ppm guideline */}
          <ReferenceLine
            y={1000}
            stroke={RED}
            strokeDasharray="4 4"
            strokeOpacity={0.55}
            label={{
              value: 'ASHRAE 1,000 ppm',
              position: 'insideTopLeft',
              fontSize: 10,
              fontWeight: 600,
              fill: RED,
              dy: -5,
              dx: 6,
            }}
          />

          <Tooltip content={<CustomTip />} />

          <Area
            type="monotone"
            dataKey="co2"
            stroke={GREEN}
            strokeWidth={2.2}
            fill={`url(#g-${run.id})`}
            dot={false}
            isAnimationActive={true}
            animationDuration={900}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
