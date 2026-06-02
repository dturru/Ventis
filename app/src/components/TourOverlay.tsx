import { useEffect, useState } from 'react'
import { DodiMascot } from './DodiMascot'

interface TourStep {
  target?: string
  title: string
  body: string
}

const STEPS: TourStep[] = [
  {
    title: 'Welcome to Ventis',
    body: 'A smart air quality monitor that watches your CO₂ and automatically ventilates your space. Let us show you around.',
  },
  {
    target: 'dodi',
    title: 'Meet Dodi',
    body: "Your AI mascot. Dodi's mood reflects the air quality — calm when air is fresh, concerned when it's getting stuffy.",
  },
  {
    target: 'co2',
    title: 'CO₂ Level',
    body: 'The main number to watch. Below 800 ppm is fresh air. Above 1,000 ppm and focus quietly starts to drop.',
  },
  {
    target: 'metrics',
    title: 'Temp & Humidity',
    body: 'Inside conditions at a glance. Ventis compares indoor vs outdoor temperature to decide when to pull in fresh air.',
  },
  {
    target: 'fan',
    title: 'Smart Fan Control',
    body: 'Ventis only runs the fan when outdoor air is cooler and CO₂ is elevated — no wasted noise.',
  },
  {
    target: 'insight',
    title: "Dodi's Thinking",
    body: 'Every 25 seconds, Dodi reads the room and explains what it would do next — all on-device, no cloud required.',
  },
  {
    target: 'nav',
    title: 'Explore More',
    body: 'Tap Trends to see CO₂ history, or Controls to take manual override of the fan.',
  },
]

interface Rect { top: number; left: number; width: number; height: number }

const PAD = 10
const TOOLTIP_H = 170

export function TourOverlay({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)

  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  useEffect(() => {
    if (!current.target) {
      setRect(null)
      return
    }
    const el = document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`)
    if (!el) { setRect(null); return }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const t = setTimeout(() => {
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }, 300)
    return () => clearTimeout(t)
  }, [step, current.target])

  useEffect(() => {
    if (!current.target) return
    const update = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`)
      if (!el) return
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [current.target])

  function next() {
    if (isLast) onDone()
    else setStep(s => s + 1)
  }

  const vh = window.innerHeight || 800

  let tooltipTop: number
  if (!rect) {
    tooltipTop = vh * 0.3
  } else {
    const spaceBelow = vh - (rect.top + rect.height + PAD)
    tooltipTop = spaceBelow >= TOOLTIP_H + 16
      ? rect.top + rect.height + PAD + 14
      : rect.top - PAD - TOOLTIP_H - 14
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 100,
      pointerEvents: 'auto',
    }}>
      {/* Backdrop — only for welcome step */}
      {!rect && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)' }} />
      )}

      {/* Spotlight */}
      {rect && (
        <div style={{
          position: 'absolute',
          top: rect.top - PAD,
          left: rect.left - PAD,
          width: rect.width + PAD * 2,
          height: rect.height + PAD * 2,
          borderRadius: 14,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
          border: '2px solid rgba(255,255,255,0.3)',
          transition: 'top 0.35s cubic-bezier(0.4,0,0.2,1), left 0.35s cubic-bezier(0.4,0,0.2,1), width 0.35s cubic-bezier(0.4,0,0.2,1), height 0.35s cubic-bezier(0.4,0,0.2,1)',
          pointerEvents: 'none',
        }} />
      )}

      {/* Welcome card — step 0 only */}
      {step === 0 && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'calc(100% - 40px)',
          maxWidth: 360,
          background: '#fff',
          borderRadius: 20,
          overflow: 'hidden',
          boxShadow: '0 16px 48px rgba(0,0,0,0.3)',
        }}>
          {/* Green hero area */}
          <div style={{
            background: 'var(--green)',
            padding: '32px 24px 20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}>
            <div style={{ width: 88, height: 98 }}>
              <DodiMascot emotion="calm" flapping={false} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 4 }}>
                Introducing
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px', lineHeight: 1 }}>
                Ventis
              </div>
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: '22px 24px 20px' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--fg)', marginBottom: 8 }}>
              {current.title}
            </div>
            <div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 22 }}>
              {current.body}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                onClick={onDone}
                style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer', padding: '4px 0', fontWeight: 500 }}
              >
                Skip tour
              </button>
              <button
                onClick={next}
                style={{ background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.2px' }}
              >
                Show me around →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Compact tooltip — steps 1+ */}
      {step > 0 && (
        <div style={{
          position: 'absolute',
          top: tooltipTop,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'calc(100% - 48px)',
          maxWidth: 320,
          background: '#fff',
          borderRadius: 14,
          padding: '16px 18px 14px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
          transition: 'top 0.35s cubic-bezier(0.4,0,0.2,1)',
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)', marginBottom: 6 }}>
            {current.title}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.55, marginBottom: 14 }}>
            {current.body}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {STEPS.slice(1).map((_, i) => (
                <div key={i} style={{
                  width: i === step - 1 ? 16 : 5,
                  height: 5,
                  borderRadius: 3,
                  background: i === step - 1 ? 'var(--green)' : '#ddd',
                  transition: 'width 0.25s, background 0.25s',
                }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {!isLast && (
                <button
                  onClick={onDone}
                  style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12, cursor: 'pointer', padding: '5px 4px', fontWeight: 500 }}
                >
                  Skip
                </button>
              )}
              <button
                onClick={next}
                style={{ background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                {isLast ? 'Got it' : 'Next →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
