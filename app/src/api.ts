import type { SensorData, HistoryData, FanMode } from './types'

const useMock = () => new URLSearchParams(window.location.search).get('mock') === '1'

const mockFetch = (url: string) => fetch(url, { cache: 'no-store' })

async function withMockFallback(liveUrl: string, mockUrl: string, init?: RequestInit): Promise<Response> {
  if (useMock()) return mockFetch(mockUrl)
  try {
    const r = await fetch(liveUrl, init)
    if (!r.ok) throw new Error(String(r.status))
    return r
  } catch {
    return mockFetch(mockUrl)
  }
}

export async function fetchData(): Promise<SensorData> {
  const r = await withMockFallback('/data', '/mock-data.json')
  return r.json()
}

export async function fetchHistory(): Promise<HistoryData> {
  const r = await withMockFallback('/history', '/mock-history.json')
  return r.json()
}

export async function fetchInsight(): Promise<{ text: string; source: string }> {
  if (useMock()) {
    const r = await mockFetch('/mock-insight.json')
    return r.json()
  }
  try {
    const r = await fetch('/insight', { method: 'POST' })
    if (r.status === 429) throw new Error('rate-limited')
    if (!r.ok) throw new Error(String(r.status))
    return r.json()
  } catch (e) {
    if ((e as Error).message === 'rate-limited') throw e
    const r = await mockFetch('/mock-insight.json')
    return r.json()
  }
}

export async function postControl(params: { mode?: FanMode; setpoint?: number; duty?: number }): Promise<void> {
  if (useMock()) return
  const qs = new URLSearchParams()
  if (params.mode) qs.set('mode', params.mode)
  if (params.setpoint !== undefined) qs.set('setpoint', String(params.setpoint))
  if (params.duty !== undefined) qs.set('duty', String(params.duty))
  await fetch('/control?' + qs.toString(), { method: 'POST' })
}

export async function startLog(label: string): Promise<void> {
  if (useMock()) return
  await fetch('/log/start?label=' + encodeURIComponent(label))
}

export async function stopLog(): Promise<void> {
  if (useMock()) return
  await fetch('/log/stop')
}
