import type { Tab } from '../types'

interface Props {
  active: Tab
  isController: boolean
  onSelect: (tab: Tab) => void
}

const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'live', label: 'Live', icon: '⊙' },
  { id: 'trend', label: 'Trends', icon: '↗' },
  { id: 'controls', label: 'Controls', icon: '⊕' },
]

export function BottomNav({ active, isController, onSelect }: Props) {
  const visible = isController ? tabs : tabs.filter(t => t.id !== 'controls')

  return (
    <nav data-tour="nav" style={{
      position: 'fixed',
      bottom: 0,
      left: '50%',
      transform: 'translateX(-50%)',
      width: '100%',
      maxWidth: 480,
      height: 'calc(var(--nav-h) + env(safe-area-inset-bottom))',
      paddingBottom: 'env(safe-area-inset-bottom)',
      background: 'var(--tile)',
      borderTop: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'stretch',
      zIndex: 30,
    }}>
      {visible.map(tab => {
        const isActive = active === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              background: 'none',
              border: 'none',
              color: isActive ? 'var(--green)' : 'var(--muted)',
              fontSize: 11,
              fontWeight: isActive ? 700 : 500,
              letterSpacing: '0.3px',
              transition: 'color 0.12s',
              paddingBottom: 4,
            }}
          >
            <span style={{ fontSize: 20, lineHeight: 1 }}>{tab.icon}</span>
            {tab.label}
            {isActive && (
              <span style={{
                position: 'absolute',
                bottom: 'calc(var(--nav-h) + env(safe-area-inset-bottom) - 2px)',
                width: 32,
                height: 2,
                borderRadius: 1,
                background: 'var(--green)',
              }} />
            )}
          </button>
        )
      })}
    </nav>
  )
}
