import type { Tier, Sample } from '../types'
import { SparklineChart } from './SparklineChart'

interface Props {
  co2: number | null
  tier: Tier
  samples: Sample[]
  onTap: () => void
}

const BADGE = { green: 'GOOD', amber: 'AMBER', red: 'HIGH' }

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

const TILE_STYLE: Record<Tier, React.CSSProperties> = {
  green: { background: 'linear-gradient(180deg, var(--green-light) 0%, var(--tile) 100%)', borderColor: '#bedfc4' },
  amber: { background: 'linear-gradient(180deg, var(--amber-light) 0%, var(--tile) 100%)', borderColor: '#e8d28a' },
  red:   { background: 'linear-gradient(180deg, var(--red-light) 0%, var(--tile) 100%)',   borderColor: '#e8a8a8' },
}

const VALUE_COLOR: Record<Tier, string> = {
  green: 'var(--green)',
  amber: 'var(--amber)',
  red: 'var(--red)',
}

const BADGE_COLOR: Record<Tier, string> = {
  green: 'var(--green)',
  amber: 'var(--amber)',
  red: 'var(--red)',
}

export function Co2Card({ co2, tier, samples, onTap }: Props) {
  return (
    <div
      data-tour="co2"
      onClick={onTap}
      style={{
        background: 'var(--tile)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        boxShadow: 'var(--shadow)',
        transition: 'background 0.5s, border-color 0.5s',
        ...TILE_STYLE[tier],
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 600 }}>
            CO₂
          </div>
          <div style={{ fontSize: 48, fontWeight: 700, lineHeight: 1, margin: '6px 0 4px', color: VALUE_COLOR[tier] }}>
            {co2 ?? '--'}
          </div>
          <div style={{ fontSize: 16, color: 'var(--muted)' }}>
            ppm{tier === 'red' && <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--red)', marginLeft: 6 }}>· over ASHRAE 1,000</span>}
          </div>
          {co2 != null && (() => {
            const pct = focusPct(co2)
            const color = focusColor(pct)
            return (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--muted)' }}>Cognitive focus</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color }}>{pct}%</span>
                </div>
                <div style={{ height: 5, borderRadius: 3, background: 'rgba(0,0,0,0.08)' }}>
                  <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: color, transition: 'width 0.6s ease, background 0.4s' }} />
                </div>
              </div>
            )
          })()}
        </div>
        <div style={{
          padding: '5px 12px',
          borderRadius: 14,
          fontSize: 11,
          fontWeight: 700,
          color: 'white',
          background: BADGE_COLOR[tier],
          letterSpacing: '0.6px',
          flexShrink: 0,
        }}>
          {BADGE[tier]}
        </div>
      </div>
      <SparklineChart samples={samples} height={60} />
    </div>
  )
}
