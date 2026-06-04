// Static, dependency-free Dodi — the front-facing "calm" pose lifted from the
// device dashboard's #dodo-pixel-v2 sprite (app/src/components/DodiMascot.tsx),
// with the GSAP animation logic stripped out. Bobbing is done in CSS.

interface Props {
  size?: number
  className?: string
}

export function Dodi({ size = 96, className }: Props) {
  return (
    <div className={className} style={{ width: size, height: size * 1.125, flexShrink: 0 }}>
      <svg
        viewBox="0 0 32 36"
        xmlns="http://www.w3.org/2000/svg"
        shapeRendering="crispEdges"
        style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}
        role="img"
        aria-label="Dodi, the Ventis mascot"
      >
        {/* Resting wings (down) */}
        <g>
          <rect x="3" y="21" width="2" height="1" fill="#0d4520" /><rect x="3" y="22" width="2" height="1" fill="#155026" /><rect x="5" y="22" width="1" height="1" fill="#0d4520" /><rect x="3" y="23" width="3" height="1" fill="#155026" /><rect x="6" y="23" width="1" height="1" fill="#0d4520" /><rect x="3" y="24" width="3" height="1" fill="#155026" /><rect x="6" y="24" width="1" height="1" fill="#0d4520" /><rect x="3" y="25" width="3" height="1" fill="#155026" /><rect x="6" y="25" width="1" height="1" fill="#0d4520" /><rect x="3" y="26" width="1" height="1" fill="#0d4520" /><rect x="4" y="26" width="2" height="1" fill="#155026" /><rect x="6" y="26" width="1" height="1" fill="#0d4520" /><rect x="4" y="27" width="2" height="1" fill="#0d4520" />
          <rect x="27" y="21" width="2" height="1" fill="#0d4520" /><rect x="26" y="22" width="1" height="1" fill="#0d4520" /><rect x="27" y="22" width="2" height="1" fill="#155026" /><rect x="25" y="23" width="1" height="1" fill="#0d4520" /><rect x="26" y="23" width="3" height="1" fill="#155026" /><rect x="25" y="24" width="1" height="1" fill="#0d4520" /><rect x="26" y="24" width="3" height="1" fill="#155026" /><rect x="25" y="25" width="1" height="1" fill="#0d4520" /><rect x="26" y="25" width="3" height="1" fill="#155026" /><rect x="25" y="26" width="1" height="1" fill="#0d4520" /><rect x="26" y="26" width="2" height="1" fill="#155026" /><rect x="28" y="26" width="1" height="1" fill="#0d4520" /><rect x="26" y="27" width="2" height="1" fill="#0d4520" />
        </g>

        {/* Front-facing body — calm */}
        <g>
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
          {/* calm eyes */}
          <rect x="10" y="9" width="3" height="3" fill="#ffffff" /><rect x="19" y="9" width="3" height="3" fill="#ffffff" />
          <rect x="11" y="10" width="1" height="1" fill="#1a1a1a" /><rect x="20" y="10" width="1" height="1" fill="#1a1a1a" />
        </g>

        {/* Legs */}
        <g>
          <rect x="11" y="31" width="3" height="3" fill="#d97706" /><rect x="18" y="31" width="3" height="3" fill="#d97706" />
          <rect x="10" y="34" width="5" height="1" fill="#d97706" /><rect x="17" y="34" width="5" height="1" fill="#d97706" />
          <rect x="10" y="35" width="5" height="1" fill="#0d4520" /><rect x="17" y="35" width="5" height="1" fill="#0d4520" />
        </g>
      </svg>
    </div>
  )
}
