import { useState } from 'react'
import type { Tier } from '../types'

interface Props {
  tempF: number | null
  tempOutF: number | null
  humidity: number | null
  setpointF: number
  isController: boolean
  tier: Tier
  onSetpointChange: (delta: number) => void
  onTap: () => void
}

export function MetricRow({ tempF, tempOutF, humidity, setpointF, isController, onSetpointChange, onTap }: Props) {
  const [expanded, setExpanded] = useState(false)

  function handleTempTap() {
    if (isController) setExpanded(e => !e)
    onTap()
  }

  return (
    <div data-tour="metrics" style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
      {/* Temperature tile */}
      <div
        onClick={handleTempTap}
        style={{
          flex: 1,
          background: 'var(--tile)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 16,
          boxShadow: 'var(--shadow)',
          cursor: isController ? 'pointer' : 'default',
          transition: 'background 0.15s',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width="12" height="14" viewBox="0 0 12 20" fill="none" style={{ flexShrink: 0 }}>
            <rect x="4.5" y="0" width="3" height="12" rx="1.5" fill="var(--muted)" opacity="0.5"/>
            <rect x="5" y="8" width="2" height="6" fill="var(--red)" opacity="0.8"/>
            <circle cx="6" cy="16" r="4" fill="var(--red)" opacity="0.8"/>
            <circle cx="6" cy="16" r="2.2" fill="var(--red)"/>
          </svg>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 600 }}>
            INDOOR
          </div>
          {isController && (
            <span style={{
              fontSize: 10,
              color: 'var(--muted)',
              display: 'inline-block',
              transition: 'transform 0.2s',
              transform: expanded ? 'rotate(180deg)' : 'none',
            }}>▾</span>
          )}
        </div>
        <div style={{ fontSize: 24, fontWeight: 600, marginTop: 4, color: 'var(--fg)' }}>
          {tempF != null ? `${tempF.toFixed(1)}°F` : '--'}
        </div>
        {tempOutF != null && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            outdoor {tempOutF.toFixed(1)}°F
          </div>
        )}

        {/* Setpoint expander */}
        {isController && (
          <div style={{
            maxHeight: expanded ? 160 : 0,
            overflow: 'hidden',
            opacity: expanded ? 1 : 0,
            transition: 'max-height 0.25s ease, opacity 0.2s',
            marginTop: expanded ? 14 : 0,
          }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 8, textAlign: 'center' }}>
              Cooling setpoint
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
              <button
                onClick={e => { e.stopPropagation(); onSetpointChange(-1) }}
                style={{ width: 44, height: 44, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--tile-alt)', color: 'var(--fg)', fontSize: 22, fontWeight: 600, transition: 'all 0.12s' }}
              >−</button>
              <div style={{ fontSize: 30, fontWeight: 600, color: 'var(--fg)', minWidth: 90, textAlign: 'center' }}>
                {Math.round(setpointF)}°F
              </div>
              <button
                onClick={e => { e.stopPropagation(); onSetpointChange(1) }}
                style={{ width: 44, height: 44, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--tile-alt)', color: 'var(--fg)', fontSize: 22, fontWeight: 600, transition: 'all 0.12s' }}
              >+</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, textAlign: 'center' }}>
              Fan cools when indoor &gt; setpoint &amp; outdoor is colder
            </div>
          </div>
        )}
      </div>

      {/* Humidity tile */}
      <div
        onClick={onTap}
        style={{
          flex: 1,
          background: 'var(--tile)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 16,
          boxShadow: 'var(--shadow)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width="11" height="14" viewBox="0 0 11 16" fill="none" style={{ flexShrink: 0 }}>
            <path d="M5.5 0 C5.5 0 0 7 0 10.5 a5.5 5.5 0 0 0 11 0 C11 7 5.5 0 5.5 0 Z" fill="#4a90d9" opacity="0.7"/>
          </svg>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 600 }}>
            HUMIDITY
          </div>
        </div>
        <div style={{ fontSize: 24, fontWeight: 600, marginTop: 4, color: 'var(--fg)' }}>
          {humidity != null ? `${humidity.toFixed(0)}%` : '--'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
          {humidity != null
            ? humidity < 40 ? 'a bit dry' : humidity > 60 ? 'quite humid' : 'comfortable'
            : ''}
        </div>
      </div>
    </div>
  )
}
