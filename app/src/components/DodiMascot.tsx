import { useEffect, useRef, useState } from 'react'

declare const gsap: {
  to: (target: unknown, vars: Record<string, unknown>) => unknown
  set: (target: unknown, vars: Record<string, unknown>) => void
}

interface Props {
  emotion: 'calm' | 'alert' | 'distress'
  flapping: boolean
}

type FacingDir = 'front' | 'right' | 'left'

const LOOK_DIRS: FacingDir[] = ['front', 'right', 'front', 'left']
const LOOK_DURS = [4000, 2000, 4000, 2000]

export function DodiMascot({ emotion, flapping }: Props) {
  const bodyRef = useRef<SVGGElement>(null)
  const wingULRef = useRef<SVGGElement>(null)
  const wingURRef = useRef<SVGGElement>(null)
  const wingDLRef = useRef<SVGGElement>(null)
  const wingDRRef = useRef<SVGGElement>(null)
  const flapTlRef = useRef<unknown>(null)
  const shakeTlRef = useRef<unknown>(null)

  const [facing, setFacing] = useState<FacingDir>('front')

  // Look-around cycle — pauses when alert or distress
  useEffect(() => {
    if (emotion !== 'calm') {
      setFacing('front')
      return
    }
    let idx = 0
    let timer: ReturnType<typeof setTimeout>
    function step() {
      setFacing(LOOK_DIRS[idx])
      timer = setTimeout(() => {
        idx = (idx + 1) % LOOK_DIRS.length
        step()
      }, LOOK_DURS[idx])
    }
    step()
    return () => clearTimeout(timer)
  }, [emotion])

  // Breathing
  useEffect(() => {
    if (typeof gsap === 'undefined' || !bodyRef.current) return
    const tl = gsap.to(bodyRef.current, { y: -1, duration: 1.25, yoyo: true, repeat: -1, ease: 'sine.inOut' })
    return () => { (tl as { kill: () => void }).kill() }
  }, [])

  // Flap
  useEffect(() => {
    if (typeof gsap === 'undefined') return
    const wUL = wingULRef.current, wUR = wingURRef.current
    const wDL = wingDLRef.current, wDR = wingDRRef.current
    if (!wUL || !wUR || !wDL || !wDR) return

    function setWings(showUp: boolean) {
      wUL!.style.display = showUp ? 'block' : 'none'
      wUR!.style.display = showUp ? 'block' : 'none'
      wDL!.style.display = showUp ? 'none' : 'block'
      wDR!.style.display = showUp ? 'none' : 'block'
    }

    let up = false
    if (flapping) {
      if (!flapTlRef.current) {
        flapTlRef.current = gsap.to({}, { duration: 0.09, repeat: -1, onRepeat: () => { up = !up; setWings(up) } })
      }
    } else {
      if (flapTlRef.current) { (flapTlRef.current as { kill: () => void }).kill(); flapTlRef.current = null }
      setWings(false)
    }
  }, [flapping])

  // Shake on distress
  useEffect(() => {
    if (typeof gsap === 'undefined' || !bodyRef.current) return
    const body = bodyRef.current
    if (emotion === 'distress') {
      if (!shakeTlRef.current) {
        shakeTlRef.current = gsap.to(body, { x: 0.4, duration: 0.07, yoyo: true, repeat: -1, ease: 'sine.inOut' })
      }
    } else {
      if (shakeTlRef.current) { (shakeTlRef.current as { kill: () => void }).kill(); shakeTlRef.current = null; gsap.set(body, { x: 0 }) }
    }
  }, [emotion])

  const isSide = facing !== 'front'

  return (
    <div style={{ width: 64, height: 72, flexShrink: 0 }}>
      <svg viewBox="0 0 32 36" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges" style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}>
        <defs>
          <g id="dodo-side-tpl">
            <rect x="9" y="1" width="1" height="2" fill="#155026" /><rect x="11" y="1" width="1" height="2" fill="#155026" /><rect x="9" y="3" width="3" height="1" fill="#155026" />
            <rect x="6" y="4" width="9" height="1" fill="#0d4520" /><rect x="5" y="5" width="1" height="1" fill="#0d4520" /><rect x="6" y="5" width="9" height="1" fill="#1e6e3a" /><rect x="15" y="5" width="1" height="1" fill="#0d4520" />
            <rect x="4" y="6" width="1" height="1" fill="#0d4520" /><rect x="5" y="6" width="11" height="1" fill="#1e6e3a" /><rect x="16" y="6" width="1" height="1" fill="#0d4520" />
            <rect x="4" y="7" width="1" height="1" fill="#0d4520" /><rect x="5" y="7" width="2" height="1" fill="#1e6e3a" /><rect x="7" y="7" width="3" height="1" fill="#2a8a48" /><rect x="10" y="7" width="6" height="1" fill="#1e6e3a" /><rect x="16" y="7" width="1" height="1" fill="#0d4520" />
            <rect x="4" y="8" width="1" height="1" fill="#0d4520" /><rect x="5" y="8" width="7" height="1" fill="#1e6e3a" /><rect x="12" y="8" width="2" height="1" fill="#ffffff" /><rect x="14" y="8" width="2" height="1" fill="#1e6e3a" /><rect x="16" y="8" width="1" height="1" fill="#0d4520" />
            <rect x="4" y="9" width="1" height="1" fill="#0d4520" /><rect x="5" y="9" width="7" height="1" fill="#1e6e3a" /><rect x="12" y="9" width="1" height="1" fill="#ffffff" /><rect x="13" y="9" width="1" height="1" fill="#1a1a1a" /><rect x="14" y="9" width="2" height="1" fill="#1e6e3a" /><rect x="16" y="9" width="1" height="1" fill="#0d4520" />
            <rect x="5" y="10" width="1" height="1" fill="#0d4520" /><rect x="6" y="10" width="9" height="1" fill="#1e6e3a" /><rect x="15" y="10" width="1" height="1" fill="#0d4520" /><rect x="16" y="10" width="3" height="1" fill="#fbbf24" /><rect x="19" y="10" width="1" height="1" fill="#0d4520" />
            <rect x="6" y="11" width="1" height="1" fill="#0d4520" /><rect x="7" y="11" width="7" height="1" fill="#1e6e3a" /><rect x="14" y="11" width="1" height="1" fill="#0d4520" /><rect x="15" y="11" width="6" height="1" fill="#fbbf24" /><rect x="21" y="11" width="1" height="1" fill="#0d4520" />
            <rect x="7" y="12" width="1" height="1" fill="#0d4520" /><rect x="8" y="12" width="5" height="1" fill="#1e6e3a" /><rect x="13" y="12" width="1" height="1" fill="#0d4520" /><rect x="14" y="12" width="7" height="1" fill="#fbbf24" /><rect x="21" y="12" width="1" height="1" fill="#a16207" /><rect x="22" y="12" width="1" height="1" fill="#0d4520" />
            <rect x="8" y="13" width="1" height="1" fill="#0d4520" /><rect x="9" y="13" width="3" height="1" fill="#1e6e3a" /><rect x="12" y="13" width="1" height="1" fill="#0d4520" /><rect x="13" y="13" width="7" height="1" fill="#fbbf24" /><rect x="20" y="13" width="2" height="1" fill="#a16207" />
            <rect x="9" y="14" width="1" height="1" fill="#0d4520" /><rect x="10" y="14" width="1" height="1" fill="#1e6e3a" /><rect x="11" y="14" width="1" height="1" fill="#0d4520" /><rect x="12" y="14" width="7" height="1" fill="#fbbf24" /><rect x="19" y="14" width="2" height="1" fill="#a16207" />
            <rect x="10" y="15" width="1" height="1" fill="#0d4520" /><rect x="11" y="15" width="6" height="1" fill="#a16207" />
            <rect x="8" y="16" width="1" height="1" fill="#0d4520" /><rect x="9" y="16" width="7" height="1" fill="#1e6e3a" /><rect x="16" y="16" width="1" height="1" fill="#0d4520" />
            <rect x="7" y="17" width="1" height="1" fill="#0d4520" /><rect x="8" y="17" width="9" height="1" fill="#1e6e3a" /><rect x="17" y="17" width="1" height="1" fill="#0d4520" />
            <rect x="6" y="18" width="1" height="1" fill="#0d4520" /><rect x="7" y="18" width="11" height="1" fill="#1e6e3a" /><rect x="18" y="18" width="1" height="1" fill="#0d4520" />
            <rect x="5" y="19" width="1" height="1" fill="#0d4520" /><rect x="6" y="19" width="13" height="1" fill="#1e6e3a" /><rect x="19" y="19" width="1" height="1" fill="#0d4520" />
            <rect x="4" y="20" width="1" height="1" fill="#0d4520" /><rect x="5" y="20" width="15" height="1" fill="#1e6e3a" /><rect x="20" y="20" width="1" height="1" fill="#0d4520" />
            <rect x="4" y="21" width="1" height="1" fill="#0d4520" /><rect x="5" y="21" width="15" height="1" fill="#1e6e3a" /><rect x="20" y="21" width="1" height="1" fill="#0d4520" />
            <rect x="4" y="22" width="1" height="1" fill="#0d4520" /><rect x="5" y="22" width="8" height="1" fill="#1e6e3a" /><rect x="13" y="22" width="6" height="1" fill="#093b1a" /><rect x="19" y="22" width="1" height="1" fill="#1e6e3a" /><rect x="20" y="22" width="1" height="1" fill="#0d4520" />
            <rect x="4" y="23" width="1" height="1" fill="#0d4520" /><rect x="5" y="23" width="8" height="1" fill="#1e6e3a" /><rect x="13" y="23" width="6" height="1" fill="#093b1a" /><rect x="19" y="23" width="1" height="1" fill="#1e6e3a" /><rect x="20" y="23" width="1" height="1" fill="#0d4520" />
            <rect x="4" y="24" width="1" height="1" fill="#0d4520" /><rect x="5" y="24" width="7" height="1" fill="#1e6e3a" /><rect x="12" y="24" width="7" height="1" fill="#093b1a" /><rect x="19" y="24" width="1" height="1" fill="#1e6e3a" /><rect x="20" y="24" width="1" height="1" fill="#0d4520" />
            <rect x="5" y="25" width="1" height="1" fill="#0d4520" /><rect x="6" y="25" width="6" height="1" fill="#1e6e3a" /><rect x="12" y="25" width="6" height="1" fill="#093b1a" /><rect x="18" y="25" width="1" height="1" fill="#1e6e3a" /><rect x="19" y="25" width="1" height="1" fill="#0d4520" />
            <rect x="7" y="20" width="6" height="1" fill="#155026" /><rect x="6" y="21" width="7" height="1" fill="#155026" /><rect x="13" y="21" width="1" height="1" fill="#0d4520" /><rect x="6" y="22" width="6" height="1" fill="#155026" /><rect x="6" y="23" width="6" height="1" fill="#155026" /><rect x="7" y="24" width="5" height="1" fill="#0d4520" />
            <rect x="5" y="26" width="1" height="1" fill="#0d4520" /><rect x="6" y="26" width="13" height="1" fill="#1e6e3a" /><rect x="19" y="26" width="1" height="1" fill="#0d4520" />
            <rect x="6" y="27" width="1" height="1" fill="#0d4520" /><rect x="7" y="27" width="11" height="1" fill="#1e6e3a" /><rect x="18" y="27" width="1" height="1" fill="#0d4520" />
            <rect x="7" y="28" width="1" height="1" fill="#0d4520" /><rect x="8" y="28" width="9" height="1" fill="#1e6e3a" /><rect x="17" y="28" width="1" height="1" fill="#0d4520" />
            <rect x="8" y="29" width="1" height="1" fill="#0d4520" /><rect x="9" y="29" width="7" height="1" fill="#1e6e3a" /><rect x="16" y="29" width="1" height="1" fill="#0d4520" />
            <rect x="9" y="30" width="7" height="1" fill="#0d4520" />
            <rect x="9" y="31" width="2" height="3" fill="#d97706" /><rect x="13" y="31" width="2" height="3" fill="#d97706" />
            <rect x="8" y="34" width="4" height="1" fill="#d97706" /><rect x="12" y="34" width="4" height="1" fill="#d97706" />
            <rect x="8" y="35" width="4" height="1" fill="#0d4520" /><rect x="12" y="35" width="4" height="1" fill="#0d4520" />
          </g>
        </defs>

        {/* Side-right view */}
        <g style={{ display: facing === 'right' ? 'block' : 'none' }}>
          <use href="#dodo-side-tpl" />
        </g>

        {/* Side-left view (mirrored) */}
        <g transform="translate(32 0) scale(-1 1)" style={{ display: facing === 'left' ? 'block' : 'none' }}>
          <use href="#dodo-side-tpl" />
        </g>

        {/* Wing down left */}
        <g ref={wingDLRef} style={{ display: isSide ? 'none' : 'block' }}>
          <rect x="3" y="21" width="2" height="1" fill="#0d4520" /><rect x="3" y="22" width="2" height="1" fill="#155026" /><rect x="5" y="22" width="1" height="1" fill="#0d4520" /><rect x="3" y="23" width="3" height="1" fill="#155026" /><rect x="6" y="23" width="1" height="1" fill="#0d4520" /><rect x="3" y="24" width="3" height="1" fill="#155026" /><rect x="6" y="24" width="1" height="1" fill="#0d4520" /><rect x="3" y="25" width="3" height="1" fill="#155026" /><rect x="6" y="25" width="1" height="1" fill="#0d4520" /><rect x="3" y="26" width="1" height="1" fill="#0d4520" /><rect x="4" y="26" width="2" height="1" fill="#155026" /><rect x="6" y="26" width="1" height="1" fill="#0d4520" /><rect x="4" y="27" width="2" height="1" fill="#0d4520" />
        </g>
        {/* Wing down right */}
        <g ref={wingDRRef} style={{ display: isSide ? 'none' : 'block' }}>
          <rect x="27" y="21" width="2" height="1" fill="#0d4520" /><rect x="26" y="22" width="1" height="1" fill="#0d4520" /><rect x="27" y="22" width="2" height="1" fill="#155026" /><rect x="25" y="23" width="1" height="1" fill="#0d4520" /><rect x="26" y="23" width="3" height="1" fill="#155026" /><rect x="25" y="24" width="1" height="1" fill="#0d4520" /><rect x="26" y="24" width="3" height="1" fill="#155026" /><rect x="25" y="25" width="1" height="1" fill="#0d4520" /><rect x="26" y="25" width="3" height="1" fill="#155026" /><rect x="25" y="26" width="1" height="1" fill="#0d4520" /><rect x="26" y="26" width="2" height="1" fill="#155026" /><rect x="28" y="26" width="1" height="1" fill="#0d4520" /><rect x="26" y="27" width="2" height="1" fill="#0d4520" />
        </g>
        {/* Wing up left */}
        <g ref={wingULRef} style={{ display: 'none' }}>
          <rect x="3" y="19" width="2" height="1" fill="#0d4520" /><rect x="3" y="20" width="2" height="1" fill="#155026" /><rect x="5" y="20" width="1" height="1" fill="#0d4520" /><rect x="3" y="21" width="3" height="1" fill="#155026" /><rect x="6" y="21" width="1" height="1" fill="#0d4520" /><rect x="3" y="22" width="3" height="1" fill="#155026" /><rect x="6" y="22" width="1" height="1" fill="#0d4520" /><rect x="3" y="23" width="3" height="1" fill="#155026" /><rect x="6" y="23" width="1" height="1" fill="#0d4520" /><rect x="3" y="24" width="1" height="1" fill="#0d4520" /><rect x="4" y="24" width="1" height="1" fill="#155026" /><rect x="5" y="24" width="1" height="1" fill="#0d4520" />
        </g>
        {/* Wing up right */}
        <g ref={wingURRef} style={{ display: 'none' }}>
          <rect x="27" y="19" width="2" height="1" fill="#0d4520" /><rect x="26" y="20" width="1" height="1" fill="#0d4520" /><rect x="27" y="20" width="2" height="1" fill="#155026" /><rect x="25" y="21" width="1" height="1" fill="#0d4520" /><rect x="26" y="21" width="3" height="1" fill="#155026" /><rect x="25" y="22" width="1" height="1" fill="#0d4520" /><rect x="26" y="22" width="3" height="1" fill="#155026" /><rect x="25" y="23" width="1" height="1" fill="#0d4520" /><rect x="26" y="23" width="3" height="1" fill="#155026" /><rect x="26" y="24" width="1" height="1" fill="#0d4520" /><rect x="27" y="24" width="1" height="1" fill="#155026" /><rect x="28" y="24" width="1" height="1" fill="#0d4520" />
        </g>

        {/* Front-facing body — hidden when side-facing */}
        <g ref={bodyRef} style={{ display: isSide ? 'none' : 'block' }}>
          <rect x="13" y="1" width="1" height="2" fill="#155026" /><rect x="15" y="1" width="1" height="2" fill="#155026" /><rect x="17" y="1" width="1" height="2" fill="#155026" /><rect x="13" y="3" width="5" height="1" fill="#155026" />
          <rect x="9" y="4" width="14" height="1" fill="#0d4520" /><rect x="8" y="5" width="1" height="1" fill="#0d4520" /><rect x="9" y="5" width="14" height="1" fill="#1e6e3a" /><rect x="23" y="5" width="1" height="1" fill="#0d4520" /><rect x="7" y="6" width="1" height="1" fill="#0d4520" /><rect x="8" y="6" width="16" height="1" fill="#1e6e3a" /><rect x="24" y="6" width="1" height="1" fill="#0d4520" />
          <rect x="7" y="7" width="1" height="1" fill="#0d4520" /><rect x="8" y="7" width="2" height="1" fill="#1e6e3a" /><rect x="10" y="7" width="4" height="1" fill="#2a8a48" /><rect x="14" y="7" width="10" height="1" fill="#1e6e3a" /><rect x="24" y="7" width="1" height="1" fill="#0d4520" />
          <rect x="7" y="8" width="1" height="2" fill="#0d4520" /><rect x="8" y="8" width="16" height="2" fill="#1e6e3a" /><rect x="24" y="8" width="1" height="2" fill="#0d4520" />
          <rect x="8" y="10" width="1" height="1" fill="#0d4520" /><rect x="9" y="10" width="14" height="1" fill="#1e6e3a" /><rect x="23" y="10" width="1" height="1" fill="#0d4520" />
          <rect x="9" y="11" width="1" height="1" fill="#0d4520" /><rect x="10" y="11" width="12" height="1" fill="#1e6e3a" /><rect x="22" y="11" width="1" height="1" fill="#0d4520" />
          <rect x="10" y="12" width="1" height="1" fill="#0d4520" /><rect x="11" y="12" width="2" height="1" fill="#1e6e3a" /><rect x="13" y="12" width="6" height="1" fill="#fbbf24" /><rect x="19" y="12" width="2" height="1" fill="#1e6e3a" /><rect x="21" y="12" width="1" height="1" fill="#0d4520" />
          <rect x="12" y="13" width="1" height="1" fill="#0d4520" /><rect x="13" y="13" width="6" height="1" fill="#fbbf24" /><rect x="19" y="13" width="1" height="1" fill="#0d4520" />
          <rect x="13" y="14" width="1" height="1" fill="#0d4520" /><rect x="14" y="14" width="3" height="1" fill="#fbbf24" /><rect x="17" y="14" width="1" height="1" fill="#a16207" /><rect x="18" y="14" width="1" height="1" fill="#0d4520" />
          <rect x="14" y="15" width="1" height="1" fill="#0d4520" /><rect x="15" y="15" width="3" height="1" fill="#a16207" />
          <rect x="11" y="16" width="1" height="1" fill="#0d4520" /><rect x="12" y="16" width="8" height="1" fill="#1e6e3a" /><rect x="20" y="16" width="1" height="1" fill="#0d4520" />
          <rect x="10" y="17" width="1" height="1" fill="#0d4520" /><rect x="11" y="17" width="10" height="1" fill="#1e6e3a" /><rect x="21" y="17" width="1" height="1" fill="#0d4520" />
          <rect x="9" y="18" width="1" height="1" fill="#0d4520" /><rect x="10" y="18" width="12" height="1" fill="#1e6e3a" /><rect x="22" y="18" width="1" height="1" fill="#0d4520" />
          <rect x="8" y="19" width="1" height="1" fill="#0d4520" /><rect x="9" y="19" width="14" height="1" fill="#1e6e3a" /><rect x="23" y="19" width="1" height="1" fill="#0d4520" />
          <rect x="7" y="20" width="1" height="1" fill="#0d4520" /><rect x="8" y="20" width="16" height="1" fill="#1e6e3a" /><rect x="24" y="20" width="1" height="1" fill="#0d4520" />
          <rect x="6" y="21" width="1" height="1" fill="#0d4520" /><rect x="7" y="21" width="18" height="1" fill="#1e6e3a" /><rect x="25" y="21" width="1" height="1" fill="#0d4520" />
          <rect x="6" y="22" width="1" height="1" fill="#0d4520" /><rect x="7" y="22" width="3" height="1" fill="#1e6e3a" /><rect x="10" y="22" width="12" height="1" fill="#093b1a" /><rect x="22" y="22" width="3" height="1" fill="#1e6e3a" /><rect x="25" y="22" width="1" height="1" fill="#0d4520" />
          <rect x="6" y="23" width="1" height="1" fill="#0d4520" /><rect x="7" y="23" width="2" height="1" fill="#1e6e3a" /><rect x="9" y="23" width="14" height="1" fill="#093b1a" /><rect x="23" y="23" width="2" height="1" fill="#1e6e3a" /><rect x="25" y="23" width="1" height="1" fill="#0d4520" />
          <rect x="6" y="24" width="1" height="1" fill="#0d4520" /><rect x="7" y="24" width="2" height="1" fill="#1e6e3a" /><rect x="9" y="24" width="14" height="1" fill="#093b1a" /><rect x="23" y="24" width="2" height="1" fill="#1e6e3a" /><rect x="25" y="24" width="1" height="1" fill="#0d4520" />
          <rect x="7" y="25" width="1" height="1" fill="#0d4520" /><rect x="8" y="25" width="3" height="1" fill="#1e6e3a" /><rect x="11" y="25" width="10" height="1" fill="#093b1a" /><rect x="21" y="25" width="3" height="1" fill="#1e6e3a" /><rect x="24" y="25" width="1" height="1" fill="#0d4520" />
          <rect x="7" y="26" width="1" height="1" fill="#0d4520" /><rect x="8" y="26" width="16" height="1" fill="#1e6e3a" /><rect x="24" y="26" width="1" height="1" fill="#0d4520" />
          <rect x="8" y="27" width="1" height="1" fill="#0d4520" /><rect x="9" y="27" width="14" height="1" fill="#1e6e3a" /><rect x="23" y="27" width="1" height="1" fill="#0d4520" />
          <rect x="9" y="28" width="1" height="1" fill="#0d4520" /><rect x="10" y="28" width="12" height="1" fill="#1e6e3a" /><rect x="22" y="28" width="1" height="1" fill="#0d4520" />
          <rect x="10" y="29" width="1" height="1" fill="#0d4520" /><rect x="11" y="29" width="10" height="1" fill="#1e6e3a" /><rect x="21" y="29" width="1" height="1" fill="#0d4520" />
          <rect x="11" y="30" width="10" height="1" fill="#0d4520" />
          {emotion === 'calm' && <>
            <rect x="10" y="9" width="3" height="3" fill="#ffffff" /><rect x="19" y="9" width="3" height="3" fill="#ffffff" />
            <rect x="11" y="10" width="1" height="1" fill="#1a1a1a" /><rect x="20" y="10" width="1" height="1" fill="#1a1a1a" />
          </>}
          {emotion === 'alert' && <>
            <rect x="10" y="8" width="3" height="4" fill="#ffffff" /><rect x="19" y="8" width="3" height="4" fill="#ffffff" />
            <rect x="11" y="10" width="1" height="1" fill="#1a1a1a" /><rect x="20" y="10" width="1" height="1" fill="#1a1a1a" />
          </>}
          {emotion === 'distress' && <>
            <rect x="10" y="9" width="1" height="1" fill="#1a1a1a" /><rect x="12" y="9" width="1" height="1" fill="#1a1a1a" />
            <rect x="11" y="10" width="1" height="1" fill="#1a1a1a" />
            <rect x="10" y="11" width="1" height="1" fill="#1a1a1a" /><rect x="12" y="11" width="1" height="1" fill="#1a1a1a" />
            <rect x="19" y="9" width="1" height="1" fill="#1a1a1a" /><rect x="21" y="9" width="1" height="1" fill="#1a1a1a" />
            <rect x="20" y="10" width="1" height="1" fill="#1a1a1a" />
            <rect x="19" y="11" width="1" height="1" fill="#1a1a1a" /><rect x="21" y="11" width="1" height="1" fill="#1a1a1a" />
          </>}
        </g>

        {/* Legs — always visible */}
        <g style={{ display: isSide ? 'none' : 'block' }}>
          <rect x="11" y="31" width="3" height="3" fill="#d97706" /><rect x="18" y="31" width="3" height="3" fill="#d97706" />
          <rect x="10" y="34" width="5" height="1" fill="#d97706" /><rect x="17" y="34" width="5" height="1" fill="#d97706" />
          <rect x="10" y="35" width="5" height="1" fill="#0d4520" /><rect x="17" y="35" width="5" height="1" fill="#0d4520" />
        </g>
      </svg>
    </div>
  )
}
