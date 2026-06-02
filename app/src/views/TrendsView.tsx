import { useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Sample } from '../types'
import { TrendChart } from '../components/TrendChart'
import { DodiMascot } from '../components/DodiMascot'

type TimeRange = '1h' | '24h' | '7d' | '30d'

const RANGE_CONFIG: Record<TimeRange, { label: string; longLabel: string; count: number; intervalMs: number; axisLabel: string }> = {
  '1h':  { label: '1H',  longLabel: 'Last Hour',     count: 120, intervalMs: 30_000,      axisLabel: '1 hr ago' },
  '24h': { label: '24H', longLabel: 'Last 24 Hours', count: 144, intervalMs: 600_000,     axisLabel: '24 hr ago' },
  '7d':  { label: '7D',  longLabel: 'Last 7 Days',   count: 168, intervalMs: 3_600_000,   axisLabel: '7 days ago' },
  '30d': { label: '30D', longLabel: 'Last 30 Days',  count: 120, intervalMs: 21_600_000,  axisLabel: '30 days ago' },
}

function RangeDropdown({ value, onChange }: { value: TimeRange; onChange: (r: TimeRange) => void }) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  function toggle() {
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect())
    setOpen(o => !o)
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          background: 'rgba(30,110,58,0.08)',
          border: 'none',
          borderRadius: 20,
          padding: '5px 10px 5px 12px',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--green)',
          cursor: 'pointer',
          letterSpacing: '0.1px',
          whiteSpace: 'nowrap',
        }}
      >
        {RANGE_CONFIG[value].longLabel}
        <svg width="10" height="7" viewBox="0 0 10 7" fill="none" style={{ marginTop: 1, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none' }}>
          <path d="M1 1.5L5 5.5L9 1.5" stroke="var(--green)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && rect && createPortal(
        <div
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: rect.bottom + 6,
            right: window.innerWidth - rect.right,
            background: '#ffffff',
            borderRadius: 14,
            boxShadow: '0 8px 40px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08)',
            overflow: 'hidden',
            zIndex: 999,
            minWidth: 178,
          }}
        >
          {(Object.keys(RANGE_CONFIG) as TimeRange[]).map((r, i) => (
            <button
              key={r}
              onClick={() => { onChange(r); setOpen(false) }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '13px 16px',
                background: 'none',
                border: 'none',
                borderTop: i > 0 ? '1px solid rgba(0,0,0,0.06)' : 'none',
                fontSize: 15,
                color: 'var(--fg)',
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'inherit',
              }}
            >
              <span style={{ fontWeight: r === value ? 600 : 400 }}>
                {RANGE_CONFIG[r].longLabel}
              </span>
              {r === value && (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8.5L6.5 12L13 5" stroke="var(--green)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}

function seededRand(seed: number) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646 }
}

function generateSamples(range: TimeRange): Sample[] {
  const { count, intervalMs } = RANGE_CONFIG[range]
  const now = Date.now()
  const startT = now - (count - 1) * intervalMs
  const rand = seededRand(range.charCodeAt(0) * 31 + range.charCodeAt(1))

  return Array.from({ length: count }, (_, i) => {
    const t = startT + i * intervalMs
    const date = new Date(t)
    const hour = date.getHours()
    const dow = date.getDay()
    const weekend = dow === 0 || dow === 6

    // CO2 pattern by time of day
    let base
    if (hour < 7)       base = 650          // sleeping
    else if (hour < 9)  base = 780          // waking up
    else if (hour < 12) base = 870          // morning study
    else if (hour < 14) base = 960          // post-lunch peak
    else if (hour < 17) base = 900          // afternoon
    else if (hour < 20) base = 980          // evening
    else if (hour < 22) base = 1020         // late evening peak
    else                base = 720          // winding down
    if (weekend) base -= 90

    // For 7d/30d add week-level variation
    const weekNoise = range === '7d' || range === '30d'
      ? Math.sin(i / count * Math.PI * 2) * 60
      : 0

    const co2 = Math.round(Math.max(420, base + weekNoise + rand() * 80 - 40))
    const fanOn = co2 > 960

    const tempCycle = Math.sin((hour - 14) * Math.PI / 12) * 1.4
    const tempIn  = +(22.0 + tempCycle + rand() * 0.4 - 0.2).toFixed(1)
    const tempOut = +(19.8 + rand() * 0.8 - 0.4).toFixed(1)
    const humidity = Math.round(50 + Math.sin(i * 0.15) * 4 + rand() * 4 - 2)

    return { t, co2, tempIn, humidity, tempOut, fanOn }
  })
}

function dodiComment(samples: Sample[], range: TimeRange): string {
  if (samples.length < 5) return "Collecting data…"
  const latest = samples[samples.length - 1].co2
  const peak   = Math.max(...samples.map(s => s.co2))
  const avg    = Math.round(samples.reduce((a, s) => a + s.co2, 0) / samples.length)
  const fanMin = Math.round(samples.filter(s => s.fanOn).length * RANGE_CONFIG[range].intervalMs / 60000)

  if (range === '30d') return `Over the past month the room averaged ${avg} ppm. I ran the fan for ${fanMin} minutes total to keep CO₂ in check.`
  if (range === '7d')  return `This week peaked at ${peak} ppm. Average was ${avg} ppm — fan ran ${fanMin} min across the week.`
  if (range === '24h') return `Over the last 24 hours CO₂ hit ${peak} ppm. I ran the fan ${fanMin} min to keep levels comfortable.`
  if (peak > 1000 && latest < peak - 50) return `CO₂ peaked at ${peak} ppm. I ran the fan and brought it back to ${latest} ppm — and it's still dropping.`
  if (latest > 1000) return `CO₂ is at ${latest} ppm — above ASHRAE 1,000 ppm. Fan has been running to flush this out.`
  return `CO₂ is ${latest} ppm and looking steady — fan ran ${fanMin} min this hour.`
}

function fmtFanTime(ms: number): string {
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60), rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; btnCenterX: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
    }
  }, [open])

  function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ top: r.top - 10, btnCenterX: r.left + r.width / 2 })
    setOpen(o => !o)
  }

  const TIP_W = Math.min(272, window.innerWidth - 32)

  return (
    <>
      <button ref={btnRef} onClick={toggle} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        padding: '1px 0 1px 4px', color: 'var(--muted)',
        display: 'inline-flex', alignItems: 'center', flexShrink: 0,
      }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M7 6.5v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="7" cy="4.5" r="0.8" fill="currentColor" />
        </svg>
      </button>

      {open && pos && createPortal(
        <div
          onMouseDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
          style={{
            position: 'fixed',
            zIndex: 999,
            top: pos.top,
            left: Math.max(16, Math.min(pos.btnCenterX - TIP_W / 2, window.innerWidth - TIP_W - 16)),
            transform: 'translateY(-100%)',
            width: TIP_W,
            background: '#1c1c1e',
            color: '#ebebf5',
            borderRadius: 12,
            padding: '11px 14px',
            fontSize: 13,
            lineHeight: 1.55,
            boxShadow: '0 8px 32px rgba(0,0,0,0.28)',
          }}
        >
          {text}
          {/* Arrow */}
          <div style={{
            position: 'absolute',
            bottom: -5,
            left: Math.max(10, Math.min(
              pos.btnCenterX - Math.max(16, Math.min(pos.btnCenterX - TIP_W / 2, window.innerWidth - TIP_W - 16)) - 6,
              TIP_W - 22
            )),
            width: 12, height: 6, overflow: 'hidden',
          }}>
            <div style={{ width: 10, height: 10, background: '#1c1c1e', transform: 'rotate(45deg)', margin: '-5px auto 0' }} />
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

function fmtHour(h: number): string {
  if (h === 0) return '12 am'
  if (h < 12) return `${h} am`
  if (h === 12) return '12 pm'
  return `${h - 12} pm`
}

interface Props { samples: Sample[] }

export function TrendsView({ samples }: Props) {
  const [range, setRange] = useState<TimeRange>('1h')

  const generated = useMemo(() => generateSamples(range), [range])
  const data = range === '1h' ? samples : generated

  if (data.length === 0) return (
    <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
      Collecting data…
    </div>
  )

  const intervalMs = RANGE_CONFIG[range].intervalMs
  const peak    = Math.max(...data.map(s => s.co2))
  const avg     = Math.round(data.reduce((a, s) => a + s.co2, 0) / data.length)
  const current = data[data.length - 1].co2
  const fanMs   = data.filter(s => s.fanOn).length * intervalMs
  const hasFan  = data.some(s => s.fanOn)

  // Air quality breakdown
  const greenMs = data.filter(s => s.co2 < 800).length * intervalMs
  const amberMs = data.filter(s => s.co2 >= 800 && s.co2 < 1000).length * intervalMs
  const redMs   = data.filter(s => s.co2 >= 1000).length * intervalMs
  const totalMs = data.length * intervalMs
  const fmtTime = (ms: number) => {
    const m = Math.round(ms / 60000)
    return m < 60 ? `${m}m` : `${Math.floor(m/60)}h ${m%60 ? `${m%60}m` : ''}`.trim()
  }

  // Sleep quality (10pm–7am)
  const sleepSamples = data.filter(s => { const h = new Date(s.t).getHours(); return h >= 22 || h < 7 })
  const sleepAvg = sleepSamples.length >= 3
    ? Math.round(sleepSamples.reduce((a, s) => a + s.co2, 0) / sleepSamples.length)
    : null
  const sleepRating = sleepAvg == null ? null
    : sleepAvg < 700 ? { label: 'Excellent', color: 'var(--green)' }
    : sleepAvg < 800 ? { label: 'Good',      color: 'var(--green)' }
    : sleepAvg < 900 ? { label: 'Fair',       color: 'var(--amber)' }
    : { label: 'Poor', color: 'var(--red)' }

  // Fan effectiveness — complete cycles only
  const cycles: number[] = [] // ppm reduction per cycle
  for (let i = 1; i < data.length; i++) {
    if (data[i].fanOn && !data[i - 1].fanOn) {
      let end = i
      while (end < data.length - 1 && data[end].fanOn) end++
      if (!data[end].fanOn && i >= 2 && end + 2 < data.length) {
        const before = (data[i-2].co2 + data[i-1].co2) / 2
        const after  = (data[end].co2 + data[end+1].co2) / 2
        cycles.push(Math.round(before - after))
      }
      i = end
    }
  }
  const avgReduction = cycles.length ? Math.round(cycles.reduce((a, v) => a + v, 0) / cycles.length) : null

  // Peak hour (24h+ only)
  const hourBuckets: Record<number, number[]> = {}
  for (const s of data) {
    const h = new Date(s.t).getHours()
    if (!hourBuckets[h]) hourBuckets[h] = []
    hourBuckets[h].push(s.co2)
  }
  const hourAvgs = Object.entries(hourBuckets)
    .map(([h, vals]) => ({ hour: +h, avg: Math.round(vals.reduce((a, v) => a + v, 0) / vals.length) }))
    .sort((a, b) => b.avg - a.avg)
  const worstHour = hourAvgs[0] ?? null

  return (
    <div style={{ padding: '0 16px 16px' }}>

      {/* Dodi commentary */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 14,
        background: 'var(--green-light)', border: '1px solid #bedfc4',
        borderRadius: 12, padding: '14px 16px', marginBottom: 12, boxShadow: 'var(--shadow)',
      }}>
        <div style={{ flexShrink: 0, width: 52, height: 58 }}>
          <DodiMascot emotion="calm" flapping={hasFan} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--green)', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 4 }}>
            DODI · TREND SUMMARY
          </div>
          <div style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.5 }}>{dodiComment(data, range)}</div>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
        {[
          { label: 'Peak CO₂', value: `${peak}`,              unit: 'ppm', warn: peak > 1000 },
          { label: 'Average',  value: `${avg}`,               unit: 'ppm', warn: avg > 800 },
          { label: 'Fan ran',  value: fmtFanTime(fanMs),       unit: '',    warn: false },
          { label: 'Current',  value: `${current}`,           unit: 'ppm', warn: current > 1000 },
        ].map(s => (
          <div key={s.label} style={{
            background: 'var(--tile)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '10px 8px 8px', boxShadow: 'var(--shadow)', textAlign: 'center',
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>
              {s.label}
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: s.warn ? 'var(--amber)' : 'var(--fg)', lineHeight: 1 }}>
              {s.value}
            </div>
            {s.unit && <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>{s.unit}</div>}
          </div>
        ))}
      </div>

      {/* CO₂ chart */}
      <div style={{
        background: 'var(--tile)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: 'var(--shadow)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 600 }}>
            CO₂
          </div>
          <RangeDropdown value={range} onChange={setRange} />
        </div>
        <TrendChart samples={data} />
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, textAlign: 'center' }}>
          Shaded bands: green &lt;800 · amber 800–1000 · red &gt;1000 ppm
        </div>

        {/* Fan activity timeline */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 5 }}>
            Fan activity
          </div>
          <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 1 }}>
            {data.map((s, i) => (
              <div key={i} style={{ flex: 1, background: s.fanOn ? 'var(--green)' : 'var(--border)' }} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>{RANGE_CONFIG[range].axisLabel}</span>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>now</span>
          </div>
        </div>
      </div>

      {/* Air quality breakdown */}
      <div style={{
        background: 'var(--tile)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '14px 16px', marginBottom: 12, boxShadow: 'var(--shadow)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--muted)' }}>
            Time at each level
          </span>
          <InfoTip text="We classify each reading as Fresh (<800 ppm), Stuffy (800–1000 ppm), or High CO₂ (>1000 ppm) based on ASHRAE ventilation standards, then total the time spent in each zone." />
        </div>
        <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2, marginBottom: 12 }}>
          {greenMs > 0 && <div style={{ flex: greenMs, background: 'var(--green)', opacity: 0.85 }} />}
          {amberMs > 0 && <div style={{ flex: amberMs, background: 'var(--amber)', opacity: 0.85 }} />}
          {redMs   > 0 && <div style={{ flex: redMs,   background: 'var(--red)',   opacity: 0.85 }} />}
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {[
            { ms: greenMs, label: 'Fresh',    color: 'var(--green)' },
            { ms: amberMs, label: 'Stuffy',   color: 'var(--amber)' },
            { ms: redMs,   label: 'High CO₂', color: 'var(--red)' },
          ].filter(r => r.ms > 0).map(r => (
            <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: r.color, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                <span style={{ fontWeight: 700, color: 'var(--fg)' }}>{fmtTime(r.ms)}</span> {r.label}
                <span style={{ fontSize: 10, marginLeft: 4 }}>({Math.round(r.ms / totalMs * 100)}%)</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Sleep quality + Peak hour, side by side */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        {/* Sleep quality */}
        <div style={{
          flex: 1, background: 'var(--tile)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '14px 14px 12px', boxShadow: 'var(--shadow)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--muted)' }}>Sleep air</span>
            <InfoTip text="Average CO₂ between 10pm and 7am. Above 800 ppm during sleep is linked to restlessness and reduced deep sleep quality." />
          </div>
          {sleepAvg != null && sleepRating ? (
            <>
              <div style={{ fontSize: 22, fontWeight: 700, color: sleepRating.color, lineHeight: 1 }}>{sleepAvg}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>ppm avg</div>
              <div style={{
                marginTop: 8, display: 'inline-block',
                background: sleepRating.color === 'var(--green)' ? 'var(--green-light)' : sleepRating.color === 'var(--amber)' ? 'var(--amber-light)' : 'var(--red-light)',
                color: sleepRating.color,
                borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 700,
              }}>
                {sleepRating.label}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.4, marginTop: 4 }}>
              No night-time data in this range yet.
            </div>
          )}
        </div>

        {/* Peak hour */}
        <div style={{
          flex: 1, background: 'var(--tile)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '14px 14px 12px', boxShadow: 'var(--shadow)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--muted)' }}>Worst hour</span>
            <InfoTip text="We group every reading by the hour it was taken, average them, then find the hour with the highest mean CO₂ across the selected period." />
          </div>
          {worstHour ? (
            <>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg)', lineHeight: 1 }}>{fmtHour(worstHour.hour)}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>typically peaks</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>avg {worstHour.avg} ppm</div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.4, marginTop: 4 }}>Not enough data.</div>
          )}
        </div>
      </div>

      {/* Fan effectiveness */}
      <div style={{
        background: 'var(--tile)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '14px 16px', boxShadow: 'var(--shadow)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--muted)' }}>Fan effectiveness</span>
          <InfoTip text="We find each complete fan cycle (on→off), average the CO₂ in the two readings just before it turned on, and the two readings just after it turned off, then calculate the difference." />
        </div>
        {avgReduction != null ? (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20 }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: avgReduction > 0 ? 'var(--green)' : 'var(--muted)', lineHeight: 1 }}>
                {avgReduction > 0 ? `−${avgReduction}` : `+${Math.abs(avgReduction)}`}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>ppm per cycle</div>
            </div>
            <div style={{ paddingBottom: 2 }}>
              <div style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>{cycles.length} cycle{cycles.length !== 1 ? 's' : ''}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>this period</div>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            {hasFan ? 'Fan ran but no complete cycles to measure.' : 'Fan didn\'t run during this period.'}
          </div>
        )}
      </div>

    </div>
  )
}
