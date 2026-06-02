import { useRef } from 'react'
import type { Tier } from '../types'

export function useTier() {
  const last = useRef<Tier>('green')

  function getTier(ppm: number): Tier {
    if (last.current === 'green') {
      if (ppm >= 1000) last.current = 'red'
      else if (ppm >= 800) last.current = 'amber'
    } else if (last.current === 'amber') {
      if (ppm >= 1000) last.current = 'red'
      else if (ppm < 780) last.current = 'green'
    } else {
      if (ppm < 980) last.current = 'amber'
    }
    return last.current
  }

  return { getTier }
}
