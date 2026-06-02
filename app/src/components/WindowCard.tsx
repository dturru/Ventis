interface Props {
  co2: number
  tempInF: number
  tempOutF: number | null
  fanOn: boolean
}

type Verdict = 'open' | 'boost' | 'maybe' | 'skip' | 'offline'

function getAdvice(co2: number, tempInF: number, tempOutF: number | null, fanOn: boolean): {
  verdict: Verdict; heading: string; body: string
} {
  if (!tempOutF) return {
    verdict: 'offline',
    heading: 'Outdoor sensor offline',
    body: "Can't compare indoor vs outdoor — cooling mode is disabled.",
  }

  const cooler = tempOutF < tempInF - 1.5
  const stuffy = co2 > 850

  if (co2 < 750) return {
    verdict: 'skip',
    heading: 'Air is fresh',
    body: 'No need to ventilate right now — CO₂ is well within range.',
  }
  if (fanOn && cooler && stuffy) return {
    verdict: 'boost',
    heading: 'Fan is running',
    body: `Opening a window would help too — outdoor air is ${(tempInF - tempOutF).toFixed(1)}°F cooler.`,
  }
  if (cooler && stuffy) return {
    verdict: 'open',
    heading: 'Open a window',
    body: `Outdoor air is ${(tempInF - tempOutF).toFixed(1)}°F cooler and CO₂ is elevated — good time to vent.`,
  }
  if (cooler) return {
    verdict: 'maybe',
    heading: 'Could help',
    body: `Outdoor air is cooler. CO₂ is borderline — a crack in the window wouldn't hurt.`,
  }
  if (co2 > 1000) return {
    verdict: 'maybe',
    heading: 'Tough call',
    body: `CO₂ is high but outdoor air is ${(tempOutF - tempInF).toFixed(1)}°F warmer — comfort vs air quality.`,
  }
  return {
    verdict: 'skip',
    heading: 'Not worth it',
    body: `Outdoor air is warmer and CO₂ is okay. Leave the window closed.`,
  }
}

const VERDICT_STYLE: Record<Verdict, { bg: string; border: string; iconColor: string }> = {
  open:    { bg: 'var(--green-light)', border: '#bedfc4', iconColor: 'var(--green)' },
  boost:   { bg: 'var(--green-light)', border: '#bedfc4', iconColor: 'var(--green)' },
  maybe:   { bg: 'var(--amber-light)', border: '#e8d28a', iconColor: 'var(--amber)' },
  skip:    { bg: 'var(--tile)',        border: 'var(--border)', iconColor: 'var(--muted)' },
  offline: { bg: 'var(--tile)',        border: 'var(--border)', iconColor: 'var(--muted)' },
}

function WindowIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="3" x2="12" y2="21" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  )
}

export function WindowCard({ co2, tempInF, tempOutF, fanOn }: Props) {
  const { verdict, heading, body } = getAdvice(co2, tempInF, tempOutF, fanOn)
  const style = VERDICT_STYLE[verdict]

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      background: style.bg,
      border: `1px solid ${style.border}`,
      borderRadius: 12,
      padding: '14px 16px',
      marginBottom: 12,
      boxShadow: 'var(--shadow)',
      transition: 'background 0.3s, border-color 0.3s',
    }}>
      <WindowIcon color={style.iconColor} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: style.iconColor, marginBottom: 3 }}>
          Open a window?
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)', marginBottom: 2 }}>{heading}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{body}</div>
      </div>
    </div>
  )
}
