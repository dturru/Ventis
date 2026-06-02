export interface SensorData {
  co2: number
  tempIn: number
  humidity: number
  tempOut: number
  tempOutValid: boolean
  setpointF: number
  manualDutyPct: number
  insightText: string
  insightTs: number
  insightSource: 'live' | 'fallback' | 'init'
  fanOn: boolean
  reason: string
  duty: number
  logEnabled: boolean
  runLabel: string
  logRowCount: number
}

export interface Sample {
  t: number
  co2: number
  tempIn: number
  humidity: number
  tempOut: number
  fanOn: boolean
}

export interface HistoryData {
  interval_ms: number
  samples: Sample[]
}

export type Tier = 'green' | 'amber' | 'red'
export type Tab = 'live' | 'trend' | 'controls'
export type FanMode = 'auto' | 'on' | 'off'
