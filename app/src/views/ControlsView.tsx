import { useState, useEffect } from 'react'
import type { FanMode } from '../types'
import { postControl, startLog, stopLog } from '../api'
import { DodiMascot } from '../components/DodiMascot'

interface Props {
  manualDutyPct: number
  logEnabled: boolean
  runLabel: string
  logRowCount: number
  useMock: boolean
  onRefresh: () => void
}

export function ControlsView({ manualDutyPct, logEnabled, runLabel, logRowCount, useMock, onRefresh }: Props) {
  const [mode, setModeState] = useState<FanMode>('auto')
  const [duty, setDuty] = useState(manualDutyPct)
  const [dutyDragging, setDutyDragging] = useState(false)
  const [logLabelInput, setLogLabelInput] = useState('')

  useEffect(() => {
    if (!dutyDragging) setDuty(manualDutyPct)
  }, [manualDutyPct, dutyDragging])

  async function handleMode(m: FanMode) {
    setModeState(m)
    await postControl({ mode: m })
    onRefresh()
  }

  async function handleDutyCommit(v: number) {
    setDutyDragging(false)
    await postControl({ duty: v })
  }

  async function handleStartLog() {
    if (useMock) { alert('Logging is a live-device feature.'); return }
    await startLog(logLabelInput || 'unlabeled')
    onRefresh()
  }

  async function handleStopLog() {
    await stopLog()
    onRefresh()
  }

  const modeComment: Record<FanMode, string> = {
    auto: "Auto mode — I watch CO₂ and temperature and only spin up the fan when it'll actually help. No wasted noise.",
    on: "Manual on — you're driving. I'll hold whatever duty cycle you set below.",
    off: "Fan is off. I won't override this, even if CO₂ climbs — you've got the wheel.",
  }

  return (
    <div style={{ padding: '0 16px 16px' }}>
      {/* Dodi commentary */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
        background: mode === 'off' ? 'var(--amber-light)' : 'var(--green-light)',
        border: `1px solid ${mode === 'off' ? '#e8d28a' : '#bedfc4'}`,
        borderRadius: 12,
        padding: '14px 16px',
        marginBottom: 12,
        boxShadow: 'var(--shadow)',
        transition: 'background 0.3s, border-color 0.3s',
      }}>
        <div style={{ flexShrink: 0, width: 52, height: 58 }}>
          <DodiMascot emotion={mode === 'off' ? 'alert' : 'calm'} flapping={mode === 'on'} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: mode === 'off' ? 'var(--amber)' : 'var(--green)', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 4, transition: 'color 0.3s' }}>
            DODI · CONTROLS
          </div>
          <div style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.5 }}>{modeComment[mode]}</div>
        </div>
      </div>

      {/* Manual override */}
      <div style={{
        background: 'var(--tile)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        boxShadow: 'var(--shadow)',
      }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 600, marginBottom: 12 }}>
          Manual Override
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['auto', 'on', 'off'] as FanMode[]).map(m => (
            <button
              key={m}
              onClick={() => handleMode(m)}
              style={{
                flex: 1,
                padding: '12px 0',
                background: mode === m ? 'var(--green)' : 'var(--tile-alt)',
                border: `1px solid ${mode === m ? 'var(--green)' : 'var(--border)'}`,
                color: mode === m ? '#fff' : 'var(--fg)',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                transition: 'all 0.15s',
              }}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        {mode === 'on' && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500, marginBottom: 8 }}>
              Fan speed <span style={{ color: 'var(--green)', fontWeight: 700, marginLeft: 4 }}>{duty}%</span>
            </div>
            <input
              type="range"
              min={0} max={100} step={5}
              value={duty}
              onChange={e => { setDutyDragging(true); setDuty(Number(e.target.value)) }}
              onMouseUp={e => handleDutyCommit(Number((e.target as HTMLInputElement).value))}
              onTouchEnd={e => handleDutyCommit(Number((e.target as HTMLInputElement).value))}
              style={{ width: '100%', accentColor: 'var(--green)' }}
            />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>Active when override is ON</div>
          </div>
        )}
      </div>

      {/* Sheets logging */}
      <div style={{
        background: 'var(--tile)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        boxShadow: 'var(--shadow)',
      }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 600, marginBottom: 12 }}>
          Sheets Logging
        </div>

        {!logEnabled ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="run label (e.g. dorm_baseline)"
              value={logLabelInput}
              onChange={e => setLogLabelInput(e.target.value)}
              style={{
                flex: 1,
                padding: '10px 12px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 14,
                color: 'var(--fg)',
                background: 'var(--tile-alt)',
                outline: 'none',
              }}
            />
            <button
              onClick={handleStartLog}
              style={{
                padding: '10px 16px',
                background: 'var(--green)',
                border: '1px solid var(--green)',
                color: '#fff',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                transition: 'background 0.15s',
              }}
            >
              Start
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--green)', fontSize: 14 }}>{runLabel || 'unlabeled'}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{logRowCount} rows</div>
            </div>
            <button
              onClick={handleStopLog}
              style={{
                padding: '10px 16px',
                background: 'var(--tile)',
                border: '1px solid var(--red)',
                color: 'var(--red)',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                transition: 'background 0.15s',
              }}
            >
              Stop
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
