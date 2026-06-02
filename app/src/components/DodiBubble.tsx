import { useEffect, useState } from 'react'

interface Props {
  text: string | null
  onDismiss: () => void
}

export function DodiBubble({ text, onDismiss }: Props) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!text) { setVisible(false); return }
    setVisible(true)
    const t = setTimeout(() => { setVisible(false); setTimeout(onDismiss, 250) }, 5200)
    return () => clearTimeout(t)
  }, [text, onDismiss])

  if (!text && !visible) return null

  return (
    <div style={{
      position: 'fixed',
      left: '50%',
      top: 'calc(var(--header-h) + env(safe-area-inset-top) + 8px)',
      transform: `translateX(-50%) translateY(${visible ? '0' : '8px'})`,
      width: 'calc(100% - 40px)',
      maxWidth: 320,
      background: 'var(--fg)',
      color: '#fff',
      padding: '11px 14px',
      borderRadius: 12,
      fontSize: 13,
      lineHeight: 1.45,
      boxShadow: '0 6px 20px rgba(0,0,0,0.24)',
      opacity: visible ? 1 : 0,
      pointerEvents: 'none',
      transition: 'opacity 0.2s, transform 0.2s',
      zIndex: 60,
    }}>
      <div style={{
        position: 'absolute',
        top: -6,
        left: '50%',
        transform: 'translateX(-50%)',
        borderLeft: '7px solid transparent',
        borderRight: '7px solid transparent',
        borderBottom: '7px solid var(--fg)',
      }} />
      {text}
    </div>
  )
}
