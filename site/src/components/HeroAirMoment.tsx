import { useEffect, useState } from 'react'

// Counts from a calm baseline up to the real measured peak, easing out.
// Honors prefers-reduced-motion by jumping straight to the final value.
function useCountUp(target: number, from = 450, dur = 1600) {
  const [v, setV] = useState(from)
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setV(target)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur)
      const e = 1 - Math.pow(1 - p, 3) // easeOutCubic
      setV(Math.round(from + (target - from) * e))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, from, dur])
  return v
}

// The signature hero data-moment: a real measured overnight CO₂ rise crossing
// the ASHRAE 1,000 ppm line. Numbers trace to the Little Hall single (1,111 ppm
// peak, ~4 h over the line). See site/DESIGN.md claim-integrity.
export function HeroAirMoment() {
  const v = useCountUp(1111)
  const tier = v >= 1000 ? 'red' : v >= 800 ? 'amber' : 'green'

  return (
    <div
      className="air-moment"
      role="img"
      aria-label="A Little Hall dorm single reached 1,111 ppm of CO₂ overnight, four hours above the ASHRAE 1,000 ppm guideline, while one person slept."
    >
      <svg className="air-svg" viewBox="0 0 330 124" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="air-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="rgba(198,66,44,0.20)" />
            <stop offset="0.55" stopColor="rgba(184,121,0,0.10)" />
            <stop offset="1" stopColor="rgba(30,110,58,0.03)" />
          </linearGradient>
        </defs>
        <line x1="10" y1="34" x2="320" y2="34" stroke="var(--amber)" strokeWidth="1.4" strokeDasharray="4 4" opacity="0.75" />
        <text x="12" y="28" className="air-ashrae">ASHRAE 1,000</text>
        <path d="M10 98 C 70 94 104 88 150 74 S 250 40 306 26 L 306 124 L 10 124 Z" fill="url(#air-fill)" />
        <path className="air-trace" pathLength={1} d="M10 98 C 70 94 104 88 150 74 S 250 40 306 26" stroke="var(--green)" strokeWidth="2.6" strokeLinecap="round" />
        <circle className="air-dot" cx="306" cy="26" r="4.5" fill="var(--red)" />
      </svg>

      <div className="air-read">
        <div className="air-eyebrow">Little Hall single · one night</div>
        <div className={`air-num ${tier}`}>
          {v.toLocaleString()}
          <span className="air-unit">ppm CO₂</span>
        </div>
        <div className="air-foot">Four hours past the ASHRAE line, while one person slept.</div>
      </div>
    </div>
  )
}
