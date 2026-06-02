import type { SensorData, Sample, Tier } from '../types'
import { DodiMascot } from '../components/DodiMascot'
import { Co2Card } from '../components/Co2Card'
import { MetricRow } from '../components/MetricRow'
import { FanCard } from '../components/FanCard'
import { InsightCard } from '../components/InsightCard'
import { WindowCard } from '../components/WindowCard'
import { SessionStats } from '../components/SessionStats'

interface Props {
  data: SensorData | null
  tier: Tier
  samples: Sample[]
  insightText: string
  insightSource: 'live' | 'fallback' | 'init'
  insightLatencyMs?: number
  isController: boolean
  outdoorOffline: boolean
  onTip: (key: string) => void
  onInsightRefresh: () => void
  onSetpointChange: (delta: number) => void
}

const DODI_CALLOUT: Record<Tier, { label: string; title: string; sub: string }> = {
  green: { label: 'AIR IS FRESH',         title: 'Dodi is happy',        sub: 'Air quality is great' },
  amber: { label: 'AIR IS GETTING STUFFY',title: 'Dodi is concerned',    sub: 'Crack a window soon' },
  red:   { label: 'AIR IS STUFFY',        title: 'Dodi is uncomfortable', sub: 'Opening the window will help' },
}

const DODI_SLEEP: Record<Tier, { label: string; title: string; sub: string }> = {
  green: { label: 'GOOD FOR SLEEP',  title: 'Dodi is resting',    sub: 'CO₂ is safe — sleep well' },
  amber: { label: 'SLEEP RISK',      title: 'Dodi is restless',   sub: 'High CO₂ can disrupt deep sleep' },
  red:   { label: 'SLEEP ALERT',     title: 'Dodi is struggling', sub: 'Fan running to protect your sleep' },
}

function isNightHour(): boolean {
  const h = new Date().getHours()
  return h >= 22 || h < 7
}

const CALLOUT_BG: Record<Tier, { background: string; borderColor: string }> = {
  green: { background: 'var(--green-light)',  borderColor: '#bedfc4' },
  amber: { background: 'var(--amber-light)',  borderColor: '#e8d28a' },
  red:   { background: 'var(--red-light)',    borderColor: '#e8a8a8' },
}

const LABEL_COLOR: Record<Tier, string> = {
  green: 'var(--green)',
  amber: 'var(--amber)',
  red:   'var(--red)',
}

export function LiveView({
  data, tier, samples, insightText, insightSource, insightLatencyMs,
  isController, outdoorOffline, onTip, onInsightRefresh, onSetpointChange,
}: Props) {
  const night = isNightHour()
  const callout = (night ? DODI_SLEEP : DODI_CALLOUT)[tier]
  const dutyPct = data ? Math.round((data.duty || 0) / 255 * 100) : 0
  const tempF = data ? data.tempIn * 9 / 5 + 32 : null
  const tempOutF = data?.tempOutValid ? data.tempOut * 9 / 5 + 32 : null
  const emotion = tier === 'green' ? 'calm' : tier === 'amber' ? 'alert' : 'distress'

  return (
    <div style={{ padding: '0 16px 16px' }}>
      {/* Outdoor sensor warning */}
      {outdoorOffline && (
        <div style={{
          background: '#fff7e0',
          border: '1px solid #e8d28a',
          color: '#7a5a00',
          padding: '10px 14px',
          borderRadius: 8,
          marginBottom: 14,
          fontSize: 13,
          fontWeight: 600,
        }}>
          ⚠ Outdoor sensor offline — cooling mode disabled.
        </div>
      )}

      {/* Dodi callout */}
      <div data-tour="dodi" style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 16px',
        borderRadius: 12,
        border: '1px solid',
        marginBottom: 12,
        boxShadow: 'var(--shadow)',
        transition: 'background 0.4s, border-color 0.4s',
        ...CALLOUT_BG[tier],
      }}>
        <DodiMascot emotion={emotion} flapping={!!data?.fanOn} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: LABEL_COLOR[tier] }}>
            {callout.label}
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--fg)', marginTop: 2, lineHeight: 1.2 }}>
            {callout.title}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>
            {callout.sub}
          </div>
        </div>
      </div>

      <Co2Card
        co2={data?.co2 ?? null}
        tier={tier}
        samples={samples}
        onTap={() => onTip('co2')}
      />

      <MetricRow
        tempF={tempF}
        tempOutF={tempOutF}
        humidity={data?.humidity ?? null}
        setpointF={data?.setpointF ?? 75}
        isController={isController}
        tier={tier}
        onSetpointChange={onSetpointChange}
        onTap={() => onTip('temp')}
      />

      {data && tempF != null && (
        <WindowCard
          co2={data.co2}
          tempInF={tempF}
          tempOutF={tempOutF}
          fanOn={data.fanOn}
        />
      )}

      <FanCard
        fanOn={!!data?.fanOn}
        dutyPct={dutyPct}
        reason={data?.reason ?? ''}
        onTap={() => onTip('fan')}
      />

      <InsightCard
        text={insightText}
        source={insightSource}
        latencyMs={insightLatencyMs}
        isController={isController}
        onTap={() => { onTip('insight'); onInsightRefresh() }}
      />

      <SessionStats samples={samples} />
    </div>
  )
}
