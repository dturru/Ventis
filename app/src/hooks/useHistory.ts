import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchHistory } from '../api'
import type { HistoryData } from '../types'

export function useHistory() {
  const [history, setHistory] = useState<HistoryData | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const d = await fetchHistory()
      setHistory(d)
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    refresh()
    timer.current = setInterval(refresh, 10000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [refresh])

  return { history, refresh }
}
