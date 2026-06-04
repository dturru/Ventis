import { useEffect, useRef, useState } from 'react'
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ReferenceDot,
} from 'recharts'
import { getRun } from '../data/runs'
import { Dodi } from './Dodi'

const GREEN = '#1e6e3a'
const AMBER = '#b87900'
const RED = '#c6422c'
const FAINT = '#8a958a'

const STEP_MS = 85 // ~18s for the full night

function fmtClock(hod: number): string {
  const h24 = ((Math.floor(hod) % 24) + 24) % 24
  const m = Math.round((hod - Math.floor(hod)) * 60)
  const ampm = h24 < 12 ? 'AM' : 'PM'
  let h = h24 % 12
  if (h === 0) h = 12
  return `${h}:${m.toString().padStart(2, '0')} ${ampm}`
}

type Level = { word: string; color: string; cls: string }
function level(co2: number): Level {
  if (co2 >= 1000) return { word: 'High', color: RED, cls: 'high' }
  if (co2 >= 800) return { word: 'Elevated', color: AMBER, cls: 'elev' }
  return { word: 'Fresh', color: GREEN, cls: 'fresh' }
}

// Dodi's line — keyed to the window phase. Honest: the closed-room climb is the
// shut window, never a fan "failing"; the reopen flush is the air-exchange proof.
function narrate(hod: number, co2: number, rising: boolean, atEnd: boolean): string {
  if (atEnd)
    return `Down to ${co2} ppm by afternoon. The lesson: it’s trading the air with outside — not a fan in a sealed room — that clears CO₂. Ventis automates that exchange, so you never choose between fresh air and a warm room.`
  if (hod < 26.5)
    return `The window’s open and the night air is doing the work — about ${co2} ppm and steady. Nothing for me to do yet.`
  if (hod < 35.667)
    return rising
      ? `The window just closed for the night. With no air trading in or out, the CO₂ you keep re-breathing climbs — ${co2} ppm and rising.`
      : `${co2} ppm, window still shut. In a sealed room, only swapping the air with outside brings this down.`
  return `The window’s open again — there’s the flush. ${co2} ppm and dropping fast. That exchange is the whole point of Ventis.`
}

export function DemoPlayer() {
  const run = getRun('fahey')!
  const pts = run.points
  const last = pts.length - 1
  const xMin = pts[0].hod
  const xMax = pts[last].hod
  const yMax = Math.max(1200, Math.ceil((run.peakLabel + 120) / 100) * 100)

  // 5 evenly spaced clock ticks across the night
  const ticks: number[] = []
  const tstep = (xMax - xMin) / 4
  for (let i = 0; i <= 4; i++) ticks.push(Math.round((xMin + tstep * i) * 10) / 10)

  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (!playing) return
    timer.current = window.setInterval(() => {
      setIdx((i) => {
        if (i >= last) {
          setPlaying(false)
          return last
        }
        return i + 1
      })
    }, STEP_MS)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [playing, last])

  const cur = pts[idx]
  const prev = pts[Math.max(0, idx - 4)]
  const rising = cur.co2 - prev.co2 > 4
  const trend = cur.co2 - prev.co2 > 4 ? '↑' : cur.co2 - prev.co2 < -4 ? '↓' : '·'
  const atEnd = idx >= last
  const lvl = level(cur.co2)
  const fanOn = (cur.fan ?? 0) > 0

  const revealed = pts.slice(0, idx + 1)

  function toggle() {
    if (atEnd) {
      setIdx(0)
      setPlaying(true)
    } else {
      setPlaying((p) => !p)
    }
  }

  return (
    <div className="demo-player">
      {/* ── Device readout ───────────────────────────────────────────────── */}
      <div className="dp-screen">
        <div className="dp-readout">
          <div className={`dp-co2 ${lvl.cls}`}>
            <span className="dp-num">{cur.co2}</span>
            <span className="dp-unit">ppm CO₂</span>
            <span className="dp-trend" style={{ color: lvl.color }}>{trend}</span>
          </div>
          <div className="dp-meta">
            <span className="dp-pill" style={{ color: lvl.color, borderColor: lvl.color }}>
              {lvl.word}
            </span>
            <span className={`dp-pill ${fanOn ? 'on' : 'off'}`}>
              Fan {fanOn ? `${cur.fan}%` : 'off'}
            </span>
            <span className="dp-clock">{fmtClock(cur.hod)}</span>
          </div>
        </div>

        <div className="dp-dodi">
          <Dodi size={58} className="dp-dodi-sprite" />
          <div className="dp-bubble">
            <div className="dp-who">Dodi</div>
            <p key={Math.floor(cur.hod < 26.5 ? 0 : cur.hod < 35.667 ? 1 : atEnd ? 3 : 2)}>
              {narrate(cur.hod, cur.co2, rising, atEnd)}
            </p>
          </div>
        </div>
      </div>

      {/* ── Progressive chart ────────────────────────────────────────────── */}
      <div className="dp-chart">
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={revealed} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
            <defs>
              <linearGradient id="dp-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={GREEN} stopOpacity={0.24} />
                <stop offset="100%" stopColor={GREEN} stopOpacity={0.02} />
              </linearGradient>
            </defs>

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
              allowDataOverflow
            />
            <YAxis
              domain={[400, yMax]}
              tick={{ fontSize: 11, fill: FAINT }}
              tickLine={false}
              axisLine={false}
              width={42}
              label={{ value: 'ppm', angle: -90, position: 'insideLeft', fontSize: 10, fill: FAINT, dy: 20 }}
            />

            <ReferenceLine
              y={1000}
              stroke={RED}
              strokeDasharray="4 4"
              strokeOpacity={0.55}
              label={{ value: 'ASHRAE 1,000 ppm', position: 'insideTopLeft', fontSize: 10, fontWeight: 600, fill: RED, dy: -5, dx: 6 }}
            />

            <Area
              type="monotone"
              dataKey="co2"
              stroke={GREEN}
              strokeWidth={2.2}
              fill="url(#dp-grad)"
              dot={false}
              isAnimationActive={false}
            />

            {/* playhead */}
            <ReferenceLine x={cur.hod} stroke={lvl.color} strokeOpacity={0.5} strokeWidth={1.5} />
            <ReferenceDot x={cur.hod} y={cur.co2} r={4.5} fill={lvl.color} stroke="#fff" strokeWidth={2} isFront />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ── Transport ────────────────────────────────────────────────────── */}
      <div className="dp-controls">
        <button className="dp-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d={atEnd ? 'M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z' : 'M8 5v14l11-7z'} /></svg>
          )}
        </button>
        <input
          className="dp-scrub"
          type="range"
          min={0}
          max={last}
          value={idx}
          onChange={(e) => {
            setPlaying(false)
            setIdx(Number(e.target.value))
          }}
          aria-label="Scrub through the night"
        />
        <span className="dp-time">{fmtClock(cur.hod)}</span>
      </div>

      <p className="dp-caption">
        A <strong>real overnight run</strong> from a Fahey Hall single — measured, not simulated.
        The occupant kept the window open (CO₂ low), closed it at 2:30 AM for warmth, then reopened
        it mid-morning. It’s the clearest proof in our data that <strong>air exchange — not a
        recirculating fan — controls CO₂</strong>.
      </p>
    </div>
  )
}
