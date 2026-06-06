import { useEffect, useRef, useState } from 'react'

interface Props {
  text: string | null
  onDismiss: () => void
}

export function DodiBubble({ text, onDismiss }: Props) {
  const [visible, setVisible] = useState(false)
  // Keep a stable handle to onDismiss so the auto-dismiss timer below does NOT
  // restart every time the parent re-renders (it re-renders on every sensor poll,
  // which previously reset the 5.2s timer forever → the bubble never closed).
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  useEffect(() => {
    if (!text) { setVisible(false); return }
    setVisible(true)
    const t = setTimeout(() => {
      setVisible(false)
      setTimeout(() => onDismissRef.current(), 250)
    }, 5200)
    return () => clearTimeout(t)
    // Depend ONLY on text — not onDismiss — so the timer survives parent re-renders.
  }, [text])

  if (!text && !visible) return null

  const dismiss = () => {
    setVisible(false)
    setTimeout(() => onDismissRef.current(), 200)
  }

  return (
    <div
      onClick={dismiss}
      role="button"
      aria-label="Dismiss tip"
      style={{
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
        // Tap the bubble to dismiss it instantly so it can't obstruct the screen.
        pointerEvents: visible ? 'auto' : 'none',
        cursor: 'pointer',
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
      <div style={{ fontSize: 10, opacity: 0.6, marginTop: 5, fontWeight: 500 }}>tap to dismiss</div>
    </div>
  )
}
