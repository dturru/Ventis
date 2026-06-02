import { useState, useRef, useCallback, useEffect } from 'react'
import type { Tab, Tier } from './types'
import { useSensorData } from './hooks/useSensorData'
import { useHistory } from './hooks/useHistory'
import { useTier } from './hooks/useTier'
import { fetchInsight, postControl } from './api'
import { BottomNav } from './components/BottomNav'
import { DodiBubble } from './components/DodiBubble'
import { TourOverlay } from './components/TourOverlay'
import { DormPicker } from './components/DormPicker'
import { LiveView } from './views/LiveView'
import { TrendsView } from './views/TrendsView'
import { ControlsView } from './views/ControlsView'

const params = new URLSearchParams(window.location.search)
const IS_CONTROLLER = params.get('ctl') === '1'
const USE_MOCK = params.get('mock') === '1'

const DODI_TIPS: Record<string, string> = {
  co2: "The CO₂ you're breathing back in. Past 1,000 ppm your focus quietly drops. I watch it so you don't have to.",
  temp: "Inside versus outside. When it's cooler out there, that's my cue to pull fresh air in.",
  fan: "How hard I'm running the fan, 0 to 100%. I only spin up when it'll actually help — no wasted noise.",
  insight: "This is me, thinking. I read the room every few seconds and say what I'd do and why — all on the chip, no server.",
  manual: "Auto means I'm driving. Switch to manual to take the wheel — set a target and I'll hold it.",
}

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('live')
  const [showTour, setShowTour] = useState(() => !localStorage.getItem('ventis-toured'))
  const [showDormPicker, setShowDormPicker] = useState(() => !localStorage.getItem('ventis-dorm'))
  const [selectedDorm, setSelectedDorm] = useState(() => localStorage.getItem('ventis-dorm') ?? '')
  const [bubbleText, setBubbleText] = useState<string | null>(null)
  const [insightText, setInsightText] = useState('Just settling in. Let me get a read on the room...')
  const [insightSource, setInsightSource] = useState<'live' | 'fallback' | 'init'>('init')
  const [insightLatencyMs, setInsightLatencyMs] = useState<number | undefined>()
  const insightInFlight = useRef(false)
  const lastInsightAt = useRef(0)
  const lastTierRef = useRef<Tier>('green')

  const { data } = useSensorData()
  const { history, refresh: refreshHistory } = useHistory()
  const { getTier } = useTier()

  const tier: Tier = data ? getTier(data.co2) : 'green'
  const samples = history?.samples ?? []

  const getInsight = useCallback(async (force = false) => {
    const now = Date.now()
    if (!force && now - lastInsightAt.current < 25000) return
    if (insightInFlight.current) return
    insightInFlight.current = true
    lastInsightAt.current = now
    const t0 = performance.now()
    try {
      const d = await fetchInsight()
      setInsightText(d.text)
      setInsightSource(d.source as 'live' | 'fallback' | 'init')
      setInsightLatencyMs(Math.round(performance.now() - t0))
    } catch {
      setInsightText('Insight unavailable right now.')
    } finally {
      insightInFlight.current = false
    }
  }, [])

  // Sync insight text from server for viewer mode
  useEffect(() => {
    if (!IS_CONTROLLER && data?.insightText) {
      setInsightText(data.insightText)
    }
    if (data?.insightSource) {
      setInsightSource(data.insightSource)
    }
  }, [data])

  // Auto-fetch insight on tier change (controller only)
  useEffect(() => {
    if (!IS_CONTROLLER) return
    if (tier !== lastTierRef.current) {
      lastTierRef.current = tier
      getInsight(true)
    }
  }, [tier, getInsight])

  // Initial insight fetch
  useEffect(() => {
    if (IS_CONTROLLER) getInsight(true)
  }, [getInsight])

  function handleTip(key: string) {
    setBubbleText(DODI_TIPS[key] ?? null)
  }

  async function handleSetpointChange(delta: number) {
    if (!data) return
    const v = Math.max(60, Math.min(90, Math.round(data.setpointF ?? 75) + delta))
    await postControl({ setpoint: v })
  }

  function handleTabSelect(tab: Tab) {
    setActiveTab(tab)
    if (tab === 'trend') refreshHistory()
  }

  const viewStyle = (tab: Tab): React.CSSProperties => ({
    display: activeTab === tab ? 'block' : 'none',
    overflowY: 'auto',
    height: '100%',
  })

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      maxWidth: 480,
      margin: '0 auto',
      background: 'var(--bg)',
    }}>
      {/* Header */}
      <header style={{
        height: 'calc(var(--header-h) + env(safe-area-inset-top))',
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 16,
        paddingRight: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        background: 'var(--tile)',
      }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--green)', letterSpacing: '-0.3px' }}>
          Ventis
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!IS_CONTROLLER && (
            <span style={{
              background: '#eef2f4',
              border: '1px solid #cdd6da',
              color: '#5c6b73',
              padding: '4px 10px',
              borderRadius: 14,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
            }}>
              View only
            </span>
          )}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', animation: 'pulse 2s ease-in-out infinite', display: 'inline-block' }} />
            LIVE
          </span>
          <span
            onClick={() => setShowDormPicker(true)}
            style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '1.2px', fontWeight: 600, cursor: 'pointer' }}
          >
            {selectedDorm || 'DORM ROOM'}
          </span>
        </div>
      </header>

      {/* Dodi tip bubble */}
      <DodiBubble text={bubbleText} onDismiss={() => setBubbleText(null)} />

      {/* Content area — scrollable per view */}
      <div style={{ flex: 1, overflow: 'hidden', paddingTop: 16 }}>
        <div style={viewStyle('live')}>
          <LiveView
            data={data}
            tier={tier}
            samples={samples}
            insightText={insightText}
            insightSource={insightSource}
            insightLatencyMs={insightLatencyMs}
            isController={IS_CONTROLLER}
            outdoorOffline={data?.tempOutValid === false}
            onTip={handleTip}
            onInsightRefresh={() => { setInsightText('Thinking...'); getInsight(true) }}
            onSetpointChange={handleSetpointChange}
          />
        </div>

        <div style={viewStyle('trend')}>
          <TrendsView samples={samples} />
        </div>

        {IS_CONTROLLER && (
          <div style={viewStyle('controls')}>
            <ControlsView
              manualDutyPct={data?.manualDutyPct ?? 100}
              logEnabled={!!data?.logEnabled}
              runLabel={data?.runLabel ?? ''}
              logRowCount={data?.logRowCount ?? 0}
              useMock={USE_MOCK}
              onRefresh={() => {}}
            />
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <BottomNav
        active={activeTab}
        isController={IS_CONTROLLER}
        onSelect={handleTabSelect}
      />

      {/* Bottom spacer so content doesn't hide behind nav */}
      <div style={{ height: 'calc(var(--nav-h) + env(safe-area-inset-bottom))', flexShrink: 0 }} />

      {showTour && (
        <TourOverlay onDone={() => {
          localStorage.setItem('ventis-toured', '1')
          setShowTour(false)
        }} />
      )}

      {!showTour && showDormPicker && (
        <DormPicker onSelect={dorm => {
          localStorage.setItem('ventis-dorm', dorm)
          setSelectedDorm(dorm)
          setShowDormPicker(false)
        }} />
      )}
    </div>
  )
}
