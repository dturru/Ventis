import { useEffect, useMemo, useRef, useState } from 'react'
import { getRun, type Run, type RunPoint } from '../data/runs'
import { Dodi } from './Dodi'

type Tier = 'green' | 'amber' | 'red'

const STEP_MS = 90

function fmtClock(hod: number): string {
  const h24 = ((Math.floor(hod) % 24) + 24) % 24
  const m = Math.round((hod - Math.floor(hod)) * 60)
  const ampm = h24 < 12 ? 'AM' : 'PM'
  let h = h24 % 12
  if (h === 0) h = 12
  return `${h}:${m.toString().padStart(2, '0')} ${ampm}`
}

// Device tier logic with hysteresis (ported from app/src/hooks/useTier.ts),
// precomputed across the whole run so scrubbing lands on the correct tier.
function computeTiers(pts: RunPoint[]): Tier[] {
  let cur: Tier = 'green'
  return pts.map((p) => {
    const ppm = p.co2
    if (cur === 'green') {
      if (ppm >= 1000) cur = 'red'
      else if (ppm >= 800) cur = 'amber'
    } else if (cur === 'amber') {
      if (ppm >= 1000) cur = 'red'
      else if (ppm < 780) cur = 'green'
    } else {
      if (ppm < 980) cur = 'amber'
    }
    return cur
  })
}

const SLEEP: Record<Tier, { label: string; title: string; sub: string }> = {
  green: { label: 'GOOD FOR SLEEP', title: 'Dodi is resting', sub: 'CO₂ is safe — sleep well' },
  amber: { label: 'SLEEP RISK', title: 'Dodi is restless', sub: 'High CO₂ can disrupt deep sleep' },
  red: { label: 'SLEEP ALERT', title: 'Dodi is struggling', sub: 'Fan running to protect your sleep' },
}
const CALLOUT_BG: Record<Tier, { background: string; borderColor: string }> = {
  green: { background: 'var(--green-light)', borderColor: '#bedfc4' },
  amber: { background: 'var(--amber-light)', borderColor: '#e8d28a' },
  red: { background: 'var(--red-light)', borderColor: '#e8a8a8' },
}
const TINT: Record<Tier, string> = { green: 'var(--green)', amber: 'var(--amber)', red: 'var(--red)' }
const BADGE: Record<Tier, string> = { green: 'GOOD', amber: 'AMBER', red: 'HIGH' }
const TILE_BG: Record<Tier, string> = {
  green: 'linear-gradient(180deg, var(--green-light) 0%, var(--tile) 100%)',
  amber: 'linear-gradient(180deg, var(--amber-light) 0%, var(--tile) 100%)',
  red: 'linear-gradient(180deg, var(--red-light) 0%, var(--tile) 100%)',
}
const TILE_BORDER: Record<Tier, string> = { green: '#bedfc4', amber: '#e8d28a', red: '#e8a8a8' }

function focusPct(co2: number): number {
  if (co2 <= 800) return 100
  if (co2 <= 1000) return Math.round(100 - ((co2 - 800) / 200) * 15)
  if (co2 <= 2000) return Math.round(85 - ((co2 - 1000) / 1000) * 30)
  return 55
}
function focusColor(pct: number): string {
  if (pct >= 85) return 'var(--green)'
  if (pct >= 70) return 'var(--amber)'
  return 'var(--red)'
}

// Honest, phase-keyed insight (per canon: closed-room climb = shut window,
// reopen flush = air-exchange proof; never the recirc fan "fixing" CO₂).
function insight(hod: number, co2: number, rising: boolean): string {
  if (hod < 26.5) return `Window's open and the night air is doing the work — ${co2} ppm and steady. Nothing to do yet.`
  if (hod < 35.667)
    return rising
      ? `Window just closed. With no air trading in or out, the CO₂ you re-breathe is climbing — ${co2} ppm and rising.`
      : `${co2} ppm with the window shut. In a sealed room, only swapping the air with outside brings this down.`
  return `Window's open again — there's the flush. ${co2} ppm and dropping fast. That exchange is the whole point of Ventis.`
}

function Sparkline({ pts }: { pts: RunPoint[] }) {
  if (pts.length < 2) return <svg style={{ width: '100%', height: 60 }} />
  const W = 600, H = 600
  const maxCo2 = Math.max(1200, ...pts.map((s) => s.co2))
  const minCo2 = 400
  const tMin = pts[0].hod, tMax = pts[pts.length - 1].hod
  const tRange = tMax - tMin || 1
  const x = (t: number) => ((t - tMin) / tRange) * W
  const y = (ppm: number) => H - ((ppm - minCo2) / (maxCo2 - minCo2)) * H
  const yRed = y(1000), yAmber = y(800)
  const line = pts.map((s) => `${x(s.hod).toFixed(1)},${y(s.co2).toFixed(1)}`).join(' ')
  const last = pts[pts.length - 1]
  const fill = `${x(pts[0].hod).toFixed(1)},${H} ${line} ${x(last.hod).toFixed(1)},${H}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 60, display: 'block', marginTop: 6 }}>
      <defs>
        <linearGradient id="dd-spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1e6e3a" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#1e6e3a" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={W} height={yRed} fill="#ffebee" opacity="0.7" />
      <rect x="0" y={yRed} width={W} height={yAmber - yRed} fill="#fff7e0" opacity="0.7" />
      <rect x="0" y={yAmber} width={W} height={H - yAmber} fill="#e8f5e9" opacity="0.7" />
      <line x1="0" y1={yRed} x2={W} y2={yRed} stroke="#c62828" strokeDasharray="4 4" opacity="0.4" />
      <line x1="0" y1={yAmber} x2={W} y2={yAmber} stroke="#b87900" strokeDasharray="4 4" opacity="0.4" />
      <polygon points={fill} fill="url(#dd-spark)" />
      <polyline points={line} fill="none" stroke="#1e6e3a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(last.hod).toFixed(1)} cy={y(last.co2).toFixed(1)} r="6" fill="#1e6e3a" />
    </svg>
  )
}

export function DeviceDemo() {
  const run = getRun('fahey') as Run
  const pts = run.points
  const last = pts.length - 1
  const tiers = useMemo(() => computeTiers(pts), [pts])

  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (!playing) return
    timer.current = window.setInterval(() => {
      setIdx((i) => {
        if (i >= last) { setPlaying(false); return last }
        return i + 1
      })
    }, STEP_MS)
    return () => { if (timer.current) window.clearInterval(timer.current) }
  }, [playing, last])

  const cur = pts[idx]
  const prev = pts[Math.max(0, idx - 4)]
  const rising = cur.co2 - prev.co2 > 4
  const atEnd = idx >= last
  const tier = tiers[idx]
  const callout = SLEEP[tier]
  const tempF = cur.tempC != null ? cur.tempC * 9 / 5 + 32 : null
  const fanPct = cur.fan ?? 0
  const fanOn = fanPct > 0
  const focus = focusPct(cur.co2)
  const focusCol = focusColor(focus)
  const spinDur = fanOn ? `${(0.5 + (1 - fanPct / 100) * 2.5).toFixed(2)}s` : undefined
  const windowPhase = cur.hod < 26.5 ? 'open' : cur.hod < 35.667 ? 'closed' : 'open'

  const sparkPts = pts.slice(Math.max(0, idx - 47), idx + 1)

  function toggle() {
    if (atEnd) { setIdx(0); setPlaying(true) } else setPlaying((p) => !p)
  }

  return (
    <div className="device-demo">
      <div className="device-frame">
        <div className="device-notch" />
        <div className="device-screen">
          {/* status bar */}
          <div className="dd-status">
            <span className="dd-time">{fmtClock(cur.hod)}</span>
            <span className="dd-statbar">
              <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor"><rect x="0" y="7" width="3" height="4" rx="0.5"/><rect x="4.5" y="5" width="3" height="6" rx="0.5"/><rect x="9" y="2.5" width="3" height="8.5" rx="0.5"/><rect x="13" y="0" width="3" height="11" rx="0.5"/></svg>
              <svg width="22" height="11" viewBox="0 0 24 12" fill="none"><rect x="0.5" y="0.5" width="20" height="11" rx="3" stroke="currentColor" opacity="0.5"/><rect x="2" y="2" width="15" height="8" rx="1.5" fill="currentColor"/><rect x="21.5" y="3.5" width="1.8" height="5" rx="0.9" fill="currentColor" opacity="0.5"/></svg>
            </span>
          </div>

          {/* app header */}
          <div className="dd-appbar">
            <span className="dd-brand"><span className="dd-dot" /> Ventis</span>
            <span className="dd-live">VIEWER</span>
          </div>

          <div className="dd-body">
            {/* Dodi callout */}
            <div className="dd-card dd-dodi" style={{ ...CALLOUT_BG[tier] }}>
              <Dodi size={48} className="dd-dodi-sprite" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="dd-uplabel" style={{ color: TINT[tier] }}>{callout.label}</div>
                <div className="dd-title">{callout.title}</div>
                <div className="dd-sub">{callout.sub}</div>
              </div>
            </div>

            {/* CO2 card */}
            <div className="dd-card" style={{ background: TILE_BG[tier], borderColor: TILE_BORDER[tier] }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div className="dd-eyebrow">CO₂</div>
                  <div className="dd-co2-num" style={{ color: TINT[tier] }}>{cur.co2}</div>
                  <div className="dd-co2-unit">
                    ppm{tier === 'red' && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--red)', marginLeft: 6 }}>· over ASHRAE 1,000</span>}
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span className="dd-mini">Cognitive focus</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: focusCol }}>{focus}%</span>
                    </div>
                    <div style={{ height: 5, borderRadius: 3, background: 'rgba(0,0,0,0.08)' }}>
                      <div style={{ height: '100%', width: `${focus}%`, borderRadius: 3, background: focusCol, transition: 'width 0.3s ease, background 0.3s' }} />
                    </div>
                  </div>
                </div>
                <div className="dd-badge" style={{ background: TINT[tier] }}>{BADGE[tier]}</div>
              </div>
              <Sparkline pts={sparkPts} />
            </div>

            {/* Temp + Humidity */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
              <div className="dd-card dd-metric">
                <div className="dd-metric-h">
                  <svg width="12" height="14" viewBox="0 0 12 20" fill="none"><rect x="4.5" y="0" width="3" height="12" rx="1.5" fill="var(--muted)" opacity="0.5"/><rect x="5" y="8" width="2" height="6" fill="var(--red)" opacity="0.8"/><circle cx="6" cy="16" r="4" fill="var(--red)" opacity="0.8"/><circle cx="6" cy="16" r="2.2" fill="var(--red)"/></svg>
                  <span>INDOOR</span>
                </div>
                <div className="dd-metric-v">{tempF != null ? `${tempF.toFixed(1)}°F` : '--'}</div>
                <div className="dd-metric-s">
                  {windowPhase === 'closed' ? 'AC on, window shut' : 'window open'}
                </div>
              </div>
              <div className="dd-card dd-metric">
                <div className="dd-metric-h">
                  <svg width="11" height="14" viewBox="0 0 11 16" fill="none"><path d="M5.5 0 C5.5 0 0 7 0 10.5 a5.5 5.5 0 0 0 11 0 C11 7 5.5 0 5.5 0 Z" fill="#4a90d9" opacity="0.7"/></svg>
                  <span>HUMIDITY</span>
                </div>
                <div className="dd-metric-v">{cur.hum != null ? `${cur.hum}%` : '--'}</div>
                <div className="dd-metric-s">{cur.hum != null ? (cur.hum < 40 ? 'a bit dry' : cur.hum > 60 ? 'quite humid' : 'comfortable') : ''}</div>
              </div>
            </div>

            {/* Fan card */}
            <div className="dd-card dd-fan" style={{ background: fanOn ? 'var(--green)' : 'var(--tile)', borderColor: fanOn ? 'var(--green)' : 'var(--border)', color: fanOn ? '#fff' : 'var(--fg)' }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', opacity: 0.85 }}>{fanOn ? 'FAN RUNNING' : 'FAN IDLE'}</div>
                <div style={{ fontSize: 24, fontWeight: 700, marginTop: 2 }}>{fanPct}%<span style={{ fontSize: 13, fontWeight: 500, opacity: 0.75, marginLeft: 4 }}>duty</span></div>
                {fanOn && <div style={{ fontSize: 11, opacity: 0.78, marginTop: 2 }}>responding to elevated CO₂</div>}
              </div>
              <div style={{ width: 42, height: 42, borderRadius: '50%', background: fanOn ? 'rgba(255,255,255,0.18)' : 'var(--tile-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg viewBox="0 0 32 32" style={{ width: 25, height: 25, color: fanOn ? '#fff' : 'var(--muted)', animation: fanOn ? `fan-spin ${spinDur} linear infinite` : undefined }}>
                  <circle cx="16" cy="16" r="3" fill="currentColor" />
                  <ellipse cx="16" cy="7" rx="2.5" ry="6" fill="currentColor" opacity="0.9" />
                  <ellipse cx="25" cy="16" rx="6" ry="2.5" fill="currentColor" opacity="0.9" />
                  <ellipse cx="16" cy="25" rx="2.5" ry="6" fill="currentColor" opacity="0.9" />
                  <ellipse cx="7" cy="16" rx="6" ry="2.5" fill="currentColor" opacity="0.9" />
                </svg>
              </div>
            </div>

            {/* Insight card */}
            <div className="dd-card dd-insight">
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
                <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 700, letterSpacing: '0.8px' }}>DODI · ON-DEVICE</span>
                <span className="dd-replay">REPLAY</span>
              </div>
              <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--fg)' }}>{insight(cur.hod, cur.co2, rising)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* transport */}
      <div className="dd-controls">
        <button className="dd-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
          {playing
            ? <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
            : <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d={atEnd ? 'M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z' : 'M8 5v14l11-7z'} /></svg>}
        </button>
        <input className="dd-scrub" type="range" min={0} max={last} value={idx}
          onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)) }} aria-label="Scrub through the night" />
        <span className="dd-clock">{fmtClock(cur.hod)}</span>
      </div>

      <p className="dd-caption">
        The actual Ventis dashboard, replaying a <strong>real overnight run</strong> from a Fahey
        Hall single — every reading measured, not simulated. The occupant kept the window open
        (CO₂ low), closed it at 2:30 AM for the AC — you can watch the room cool as the CO₂ climbs —
        then reopened it mid-morning. It’s the clearest proof in our data that <strong>air exchange,
        not a recirculating fan, controls CO₂</strong>.
      </p>
    </div>
  )
}
