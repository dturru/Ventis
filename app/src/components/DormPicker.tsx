import { useState, useEffect, useRef } from 'react'
import { DodiMascot } from './DodiMascot'

const HOUSING: { cluster: string; halls: string[] }[] = [
  {
    cluster: 'Allen House',
    halls: ['Bissell Hall', 'Cohen Hall', 'Gile Hall', 'Lord Hall', 'Streeter Hall'],
  },
  {
    cluster: 'East Wheelock House',
    halls: ['Andres Hall', 'McCulloch Hall', 'Morton Hall', 'Zimmerman Hall'],
  },
  {
    cluster: 'North Park House',
    halls: ['Berry Hall', 'Bildner Hall', 'Byrne Hall', 'Goldstein Hall', 'McLaughlin Hall', 'Rauner Hall', 'Thomas Hall'],
  },
  {
    cluster: 'School House',
    halls: ['Brown Hall', 'Hitchcock Hall', 'Little Hall', 'Mid Mass Hall', 'North Mass Hall', 'South Mass Hall'],
  },
  {
    cluster: 'South House',
    halls: ['The Lodge', 'New Hampshire Hall', 'Richardson Hall', 'Topliff Hall', 'Wheeler Hall'],
  },
  {
    cluster: 'West House',
    halls: ['Butterfield Hall', 'Fahey & McLane Hall', 'French Hall', 'Judge Hall', 'Russell Sage Hall'],
  },
  {
    cluster: 'Living Learning Communities',
    halls: [
      'Chinese Language House',
      'Edgerton House',
      'Foley House',
      'La Casa',
      'Latin American, Latino & Caribbean House',
      'Max Kade German Center',
      'Native American House',
      'Shabazz Center for Intellectual Inquiry',
      'Sustainable Living Center',
      'Triangle House',
      'Wheelock House',
    ],
  },
  {
    cluster: 'Senior Apartments',
    halls: ['Maxwell & Channing Cox Apartments', 'North Park Apartments', 'Russo Apartments'],
  },
  {
    cluster: 'Off Campus',
    halls: ['Off Campus Housing'],
  },
]

const C = 'var(--green)'
const SW = 1.5

function ClusterIcon({ cluster }: { cluster: string }) {
  const p = { width: 18, height: 18, fill: 'none', style: { flexShrink: 0 as const } }

  if (cluster === 'Allen House') return (
    <svg {...p} viewBox="0 0 18 18">
      <path d="M2 14.5h14" stroke={C} strokeWidth={SW} strokeLinecap="round"/>
      <path d="M2 14.5V9L5.5 12L9 5L12.5 12L16 9V14.5" stroke={C} strokeWidth={SW} strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx="9" cy="5" r="1" fill={C}/>
      <circle cx="2" cy="9" r="1" fill={C}/>
      <circle cx="16" cy="9" r="1" fill={C}/>
    </svg>
  )
  if (cluster === 'East Wheelock House') return (
    <svg {...p} viewBox="0 0 18 18">
      <circle cx="9" cy="9" r="7" stroke={C} strokeWidth="1.4"/>
      <line x1="2.5" y1="9" x2="9" y2="9" stroke={C} strokeWidth="1.2" strokeLinecap="round" opacity="0.35"/>
      <path d="M9 9L14 9" stroke={C} strokeWidth={SW} strokeLinecap="round"/>
      <path d="M11.8 6.8L14.5 9L11.8 11.2" stroke={C} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx="9" cy="9" r="1.3" fill={C}/>
    </svg>
  )
  if (cluster === 'North Park House') return (
    <svg {...p} viewBox="0 0 18 18">
      <path d="M9 1.5L15.5 11.5H2.5L9 1.5Z" stroke={C} strokeWidth={SW} strokeLinejoin="round"/>
      <rect x="7.5" y="11.5" width="3" height="5" rx="0.5" stroke={C} strokeWidth="1.4"/>
    </svg>
  )
  if (cluster === 'School House') return (
    <svg {...p} viewBox="0 0 18 18">
      <path d="M9 5V15.5" stroke={C} strokeWidth="1.3" strokeLinecap="round"/>
      <path d="M9 5.5C7 4.8 4 4.8 2 5.8V16C4 15 7 15 9 15.8" stroke={C} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M9 5.5C11 4.8 14 4.8 16 5.8V16C14 15 11 15 9 15.8" stroke={C} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
  if (cluster === 'South House') return (
    <svg {...p} viewBox="0 0 18 18">
      <circle cx="9" cy="9" r="3.2" stroke={C} strokeWidth="1.4"/>
      {[0,45,90,135,180,225,270,315].map(deg => {
        const r = deg * Math.PI / 180
        return <line key={deg}
          x1={(9+4.8*Math.cos(r)).toFixed(1)} y1={(9+4.8*Math.sin(r)).toFixed(1)}
          x2={(9+6.8*Math.cos(r)).toFixed(1)} y2={(9+6.8*Math.sin(r)).toFixed(1)}
          stroke={C} strokeWidth="1.3" strokeLinecap="round"/>
      })}
    </svg>
  )
  if (cluster === 'West House') return (
    <svg {...p} viewBox="0 0 18 18">
      <path d="M1 14.5L6 6.5L9.5 11L12 8L17 14.5" stroke={C} strokeWidth={SW} strokeLinejoin="round" strokeLinecap="round"/>
      <line x1="1" y1="14.5" x2="17" y2="14.5" stroke={C} strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
  if (cluster === 'Living Learning Communities') return (
    <svg {...p} viewBox="0 0 18 18">
      <circle cx="9" cy="5.5" r="2.5" stroke={C} strokeWidth="1.4"/>
      <path d="M3.5 17c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5" stroke={C} strokeWidth="1.4" strokeLinecap="round"/>
      <circle cx="14.5" cy="5" r="1.8" stroke={C} strokeWidth="1.3"/>
      <circle cx="3.5" cy="5" r="1.8" stroke={C} strokeWidth="1.3"/>
      <path d="M9 11.5c1-.4 3.5-.5 5.5 1" stroke={C} strokeWidth="1.2" strokeLinecap="round" opacity="0.6"/>
      <path d="M9 11.5c-1-.4-3.5-.5-5.5 1" stroke={C} strokeWidth="1.2" strokeLinecap="round" opacity="0.6"/>
    </svg>
  )
  if (cluster === 'Senior Apartments') return (
    <svg {...p} viewBox="0 0 18 18">
      <rect x="2" y="2.5" width="14" height="15" rx="1" stroke={C} strokeWidth="1.4"/>
      <line x1="2" y1="7" x2="16" y2="7" stroke={C} strokeWidth="1.2"/>
      <line x1="2" y1="11.5" x2="16" y2="11.5" stroke={C} strokeWidth="1.2"/>
      <rect x="4.5" y="4" width="2" height="2" rx="0.3" fill={C} opacity="0.5"/>
      <rect x="8" y="4" width="2" height="2" rx="0.3" fill={C} opacity="0.5"/>
      <rect x="11.5" y="4" width="2" height="2" rx="0.3" fill={C} opacity="0.5"/>
      <rect x="4.5" y="8.5" width="2" height="2" rx="0.3" fill={C} opacity="0.5"/>
      <rect x="11.5" y="8.5" width="2" height="2" rx="0.3" fill={C} opacity="0.5"/>
      <rect x="7.5" y="13" width="3" height="4.5" rx="0.5" stroke={C} strokeWidth="1.3"/>
    </svg>
  )
  return (
    <svg width="18" height="20" viewBox="0 0 18 20" fill="none" style={{ flexShrink: 0 }}>
      <path d="M9 1C5.686 1 3 3.686 3 7c0 4.667 6 12 6 12S15 11.667 15 7c0-3.314-2.686-6-6-6z" stroke={C} strokeWidth="1.4"/>
      <circle cx="9" cy="7" r="2.3" stroke={C} strokeWidth="1.3"/>
    </svg>
  )
}

interface Props {
  onSelect: (dorm: string) => void
}

export function DormPicker({ onSelect }: Props) {
  const [phase, setPhase] = useState<'flying' | 'asking'>('flying')
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const dodiRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const t = setTimeout(() => setPhase('asking'), 1800)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (phase === 'asking') {
      const t = setTimeout(() => inputRef.current?.focus(), 350)
      return () => clearTimeout(t)
    }
  }, [phase])

  // JS-driven sine wave flight path — smooth, visible, organic
  useEffect(() => {
    if (phase !== 'asking') return
    const start = performance.now()

    const tick = (now: number) => {
      const t = (now - start) / 1000
      // X sweeps ±88px with 5s period, Y bobs ±18px with 3s period
      // Different frequencies = Lissajous figure, never boring
      const x = Math.sin(t * 0.62) * 88
      const y = Math.sin(t * 1.05) * 18
      const rot = Math.sin(t * 0.62) * 11  // lean into turns
      if (dodiRef.current) {
        dodiRef.current.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${rot.toFixed(1)}deg)`
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [phase])

  const q = search.toLowerCase().trim()
  const filtered = HOUSING.map(g => ({
    ...g,
    halls: q ? g.halls.filter(h => h.toLowerCase().includes(q)) : g.halls,
  })).filter(g => g.halls.length > 0)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 110,
      display: 'flex', flexDirection: 'column',
    }}>

      {/* ── Green header — Dodi flies around, text pinned to bottom ── */}
      <div style={{
        background: 'var(--green)',
        position: 'relative',
        height: 296,
        paddingTop: 'var(--header-h)',
        flexShrink: 0,
        overflow: 'hidden',
      }}>
        {/* Dodi — fly-in via CSS, then JS sine wave takes over */}
        <div style={{
          position: 'absolute',
          top: 'calc(var(--header-h) + 12px)',
          left: '50%',
          marginLeft: -60,
          width: 120, height: 134,
          animation: phase === 'flying'
            ? 'dodi-fly-in 1.8s cubic-bezier(0.34,1.4,0.64,1) forwards'
            : undefined,
        }}>
          <div ref={dodiRef} style={{ width: '100%', height: '100%' }}>
            <DodiMascot emotion="calm" flapping={true} />
          </div>
        </div>

        {/* Text — pinned to bottom of green header */}
        <div style={{
          position: 'absolute',
          bottom: 22,
          left: 0, right: 0,
          textAlign: 'center',
          padding: '0 32px',
          opacity: phase === 'asking' ? 1 : 0,
          transform: phase === 'asking' ? 'translateY(0)' : 'translateY(10px)',
          transition: 'opacity 0.45s ease, transform 0.45s ease',
        }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 5 }}>
            Hey! I'm Dodi.
          </div>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>
            Which dorm are you in?<br />I'll load your building's air data.
          </div>
        </div>
      </div>

      {/* ── White sheet — search + list ── */}
      <div style={{
        flex: 1,
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transform: phase === 'asking' ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.45s cubic-bezier(0.34,1.1,0.64,1)',
      }}>

        {/* Search */}
        <div style={{
          padding: '14px 16px 10px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--bg)', borderRadius: 10, padding: '9px 12px',
          }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="6" cy="6" r="5" stroke="var(--muted)" strokeWidth="1.4"/>
              <path d="M10 10l2.5 2.5" stroke="var(--muted)" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            <input
              ref={inputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search dorms…"
              style={{
                flex: 1, background: 'none', border: 'none', outline: 'none',
                fontSize: 14, color: 'var(--fg)',
              }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                style={{ background: 'none', border: 'none', padding: 0, color: 'var(--muted)', fontSize: 18, lineHeight: 1, cursor: 'pointer' }}
              >×</button>
            )}
          </div>
        </div>

        {/* Dorm list */}
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 40 }}>
          {filtered.map(group => (
            <div key={group.cluster}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '12px 16px 5px',
                borderTop: '1px solid var(--border)',
                marginTop: 4,
              }}>
                <ClusterIcon cluster={group.cluster} />
                <span style={{
                  fontSize: 11, fontWeight: 700,
                  letterSpacing: '0.6px', textTransform: 'uppercase',
                  color: 'var(--green)',
                }}>
                  {group.cluster}
                </span>
              </div>

              {group.halls.map((hall, i) => (
                <button
                  key={hall}
                  onClick={() => onSelect(hall)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '13px 16px 13px 41px',
                    background: 'none', border: 'none',
                    borderTop: i === 0 ? 'none' : '1px solid rgba(0,0,0,0.05)',
                    fontSize: 15, color: 'var(--fg)', textAlign: 'left', cursor: 'pointer',
                  }}
                >
                  <span>{hall}</span>
                  <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
                    <path d="M1 1l5 5-5 5" stroke="var(--border)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              ))}
            </div>
          ))}

          {filtered.length === 0 && (
            <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
              No results for "{search}"
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
