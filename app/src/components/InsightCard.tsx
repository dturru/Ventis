interface Props {
  text: string
  source: 'live' | 'fallback' | 'init'
  latencyMs?: number
  isController: boolean
  onTap: () => void
}

const SOURCE_LABEL: Record<string, string> = { live: 'LIVE', fallback: 'OFFLINE', init: 'INIT' }
const SOURCE_STYLE: Record<string, React.CSSProperties> = {
  live:     { background: '#e5f3e8', color: '#1e6e3a' },
  fallback: { background: '#fff7e0', color: '#7a5a00' },
  init:     { background: '#eef2f4', color: '#5c6b73' },
}

export function InsightCard({ text, source, latencyMs, isController, onTap }: Props) {
  return (
    <div
      data-tour="insight"
      onClick={onTap}
      style={{
        background: 'var(--green-light)',
        border: '1px solid #bedfc4',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        boxShadow: 'var(--shadow)',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
        <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 700, letterSpacing: '0.8px' }}>DODI · ON-DEVICE</span>
        <span style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.6px',
          padding: '2px 6px',
          borderRadius: 4,
          marginLeft: 'auto',
          ...SOURCE_STYLE[source],
        }}>
          {SOURCE_LABEL[source] ?? source.toUpperCase()}
        </span>
        {latencyMs && (
          <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 500 }}>{latencyMs} ms</span>
        )}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--fg)' }}>{text}</div>
      {isController && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>Tap to refresh</div>
      )}
    </div>
  )
}
