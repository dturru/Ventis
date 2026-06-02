import { useState, useEffect, useRef } from 'react'
import { fetchData } from '../api'
import type { SensorData } from '../types'

export function useSensorData() {
  const [data, setData] = useState<SensorData | null>(null)
  const [error, setError] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const d = await fetchData()
        if (!cancelled) { setData(d); setError(false) }
      } catch {
        if (!cancelled) setError(true)
      }
    }

    poll()
    timer.current = setInterval(poll, 1000)
    return () => { cancelled = true; if (timer.current) clearInterval(timer.current) }
  }, [])

  return { data, error }
}
