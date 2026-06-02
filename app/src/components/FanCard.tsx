interface Props {
  fanOn: boolean
  dutyPct: number
  reason: string
  onTap: () => void
}

export function FanCard({ fanOn, dutyPct, reason, onTap }: Props) {
  const spinDur = fanOn ? `${(0.5 + (1 - dutyPct / 100) * 2.5).toFixed(2)}s` : undefined

  return (
    <div
      data-tour="fan"
      onClick={onTap}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        borderRadius: 12,
        marginBottom: 12,
        border: '1px solid',
        boxShadow: 'var(--shadow)',
        background: fanOn ? 'var(--green)' : 'var(--tile)',
        borderColor: fanOn ? 'var(--green)' : 'var(--border)',
        color: fanOn ? '#fff' : 'var(--fg)',
        transition: 'background 0.3s, border-color 0.3s, color 0.3s',
        cursor: 'pointer',
      }}
    >
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', opacity: 0.85 }}>
          {fanOn ? 'FAN RUNNING' : 'FAN IDLE'}
        </div>
        <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.3px', marginTop: 2 }}>
          {dutyPct}%<span style={{ fontSize: 14, fontWeight: 500, opacity: 0.75, marginLeft: 4 }}>duty</span>
        </div>
        {fanOn && reason && (
          <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>{reason}</div>
        )}
      </div>
      <div style={{
        width: 44, height: 44, borderRadius: '50%',
        background: fanOn ? 'rgba(255,255,255,0.18)' : 'var(--tile-alt)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <svg
          viewBox="0 0 32 32"
          style={{
            width: 26, height: 26,
            color: fanOn ? '#fff' : 'var(--muted)',
            animation: fanOn ? `fan-spin ${spinDur} linear infinite` : undefined,
          }}
        >
          <circle cx="16" cy="16" r="3" fill="currentColor" />
          <ellipse cx="16" cy="7" rx="2.5" ry="6" fill="currentColor" opacity="0.9" />
          <ellipse cx="25" cy="16" rx="6" ry="2.5" fill="currentColor" opacity="0.9" />
          <ellipse cx="16" cy="25" rx="2.5" ry="6" fill="currentColor" opacity="0.9" />
          <ellipse cx="7" cy="16" rx="6" ry="2.5" fill="currentColor" opacity="0.9" />
        </svg>
      </div>
    </div>
  )
}
