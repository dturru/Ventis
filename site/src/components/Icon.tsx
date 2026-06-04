import type { ReactNode } from 'react'

// A small, cohesive line-icon set (stroke = currentColor) so the site doesn't
// lean on emoji. Geometry adapted from the open-source Lucide set (ISC).
const PATHS: Record<string, ReactNode> = {
  invisible: (
    <>
      <path d="M3 12c2.5-4 6-6 9-6s6.5 2 9 6c-2.5 4-6 6-9 6s-6.5-2-9-6Z" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M4 4l16 16" />
    </>
  ),
  loop: (
    <>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <polyline points="21 3 21 9 15 9" />
    </>
  ),
  chart: (
    <>
      <path d="M4 5v14h16" />
      <polyline points="7 14 11 10 14 13 19 6" />
    </>
  ),
  sprout: (
    <>
      <path d="M7 20h10" />
      <path d="M12 20v-9" />
      <path d="M12 12C12 9 9.5 7 6 7c0 3 2.5 5 6 5Z" />
      <path d="M12 11c0-2.4 2.2-4.4 5-4.4 0 2.4-2.2 4.4-5 4.4Z" />
    </>
  ),
  sense: (
    <>
      <circle cx="12" cy="12" r="1.6" />
      <path d="M8.3 8.3a5.2 5.2 0 0 0 0 7.4" />
      <path d="M15.7 8.3a5.2 5.2 0 0 1 0 7.4" />
      <path d="M5.6 5.6a9 9 0 0 0 0 12.8" />
      <path d="M18.4 5.6a9 9 0 0 1 0 12.8" />
    </>
  ),
  decide: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <rect x="10.5" y="10.5" width="3" height="3" rx="0.5" />
      <path d="M10 7V4M14 7V4M10 20v-3M14 20v-3M7 10H4M7 14H4M20 10h-3M20 14h-3" />
    </>
  ),
  wind: (
    <>
      <path d="M3 8h10a2.5 2.5 0 1 0-2.5-2.5" />
      <path d="M3 13h14a2.5 2.5 0 1 1-2.5 2.5" />
      <path d="M3 18h7" />
    </>
  ),
  bed: (
    <>
      <path d="M3 20v-9" />
      <path d="M3 14h18a0 0 0 0 1 0 0v6" />
      <path d="M3 11h8a3 3 0 0 1 3 3" />
      <circle cx="7" cy="10.5" r="1.4" />
      <path d="M3 20H2M22 20h-1" />
    </>
  ),
  building: (
    <>
      <path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17" />
      <path d="M4 21h16" />
      <path d="M10 21v-3h4v3" />
      <path d="M9.5 7h1M13.5 7h1M9.5 11h1M13.5 11h1" />
    </>
  ),
  play: <path d="M8 5v14l11-7z" />,
}

export function Icon({
  name,
  size = 22,
  filled = false,
}: {
  name: keyof typeof PATHS | string
  size?: number
  filled?: boolean
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[name] ?? null}
    </svg>
  )
}
