/**
 * Paints a generated side profile (`sideProfiles.ts`) as SVG: a white
 * fuselage with a soft top-to-belly shade and a darker belly line, windows
 * as a fine dotted row, shaded engines, and the fin in the airline's colour
 * when we know it (the same colour the map paints on the fin), else grey.
 *
 * It slides in from the left a few pixels and fades up when the aircraft
 * changes, unless motion is reduced.
 */
import { useEffect, useId, useRef } from 'react'
import { useReducedMotion } from '../ui/motion'
import type { Part, PartRole, SideProfile } from './sideProfiles'

type Props = {
  profile: SideProfile
  /** Fin colour, `#rrggbb`; null or empty for neutral grey. */
  fin?: string | null
  label: string
  className?: string
  /** Replays the entrance when this changes. */
  animKey?: string
}

/** Darken or lighten a `#rrggbb` by a factor (below 1 darkens). */
function shade(hex: string, k: number): string {
  const v = parseInt(hex.slice(1), 16)
  const ch = (s: number) => Math.round(Math.min(255, Math.max(0, ((v >> s) & 255) * k)))
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`
}

const FLAT: Partial<Record<PartRole, string>> = {
  intake: '#1C2230',
  exhaust: '#5B6575',
  pylon: '#C3CAD4',
  glass: '#253045',
  blade: '#3A4352',
  spinner: '#E6EAF0',
  hub: '#4A5363',
  wheel: '#454E5C',
}

const STROKE: Partial<Record<PartRole, string>> = {
  windows: '#3A475B',
  gear: '#8F99A8',
  strut: '#B5BECA',
  skid: '#A3ACB9',
  mast: '#6E7887',
}

export function SideView({ profile, fin, label, className, animKey }: Props) {
  const id = useId().replace(/:/g, '')
  const reduced = useReducedMotion()
  const ref = useRef<SVGSVGElement>(null)
  const [x, y, w, h] = profile.box
  const r = profile.height / 2
  const finTop = fin ? shade(fin, 1.12) : '#A3ADBB'
  const finBottom = fin ? shade(fin, 0.82) : '#7D8797'

  useEffect(() => {
    const el = ref.current
    if (reduced || !el?.animate) return
    // Replays when the aircraft type changes (another aircraft selected), not on every render.
    el.dataset.shown = animKey ?? ''
    const a = el.animate(
      [
        { opacity: 0, transform: 'translateX(-10px)' },
        { opacity: 1, transform: 'translateX(0)' },
      ],
      { duration: 560, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    )
    return () => a.cancel()
  }, [animKey, reduced])

  const fuselage = profile.parts.find((p) => p.role === 'fuselage')
  // A hairline round parts that sit over the white fuselage, so they don't melt into it.
  const edge = { stroke: 'rgba(72,84,102,0.45)', strokeWidth: r * 0.035, strokeLinejoin: 'round' as const }

  const paint = (p: Part, i: number) => {
    switch (p.role) {
      case 'fuselage':
        return (
          <g key={i}>
            <path d={p.d} fill={`url(#${id}-body)`} />
            {/* Belly: the lower fuselage a shade darker, with a fine line where it starts. */}
            <g clipPath={`url(#${id}-clip)`}>
              <rect x={x} y={profile.bellyY} width={w} height={h} fill="#AEB8C6" opacity={0.42} />
              <line x1={x} x2={x + w} y1={profile.bellyY} y2={profile.bellyY} stroke="#8994A4" strokeWidth={r * 0.05} />
            </g>
          </g>
        )
      case 'fin':
        return <path key={i} d={p.d} fill={`url(#${id}-fin)`} />
      case 'wing':
      case 'stab':
        return <path key={i} d={p.d} fill={`url(#${id}-wing)`} {...edge} />
      case 'fairing':
        return <path key={i} d={p.d} fill="#C9D0DA" />
      case 'nacelle':
        return <path key={i} d={p.d} fill={`url(#${id}-nacelle)`} {...edge} />
      case 'prop':
        return <path key={i} d={p.d} fill="rgba(214,224,240,0.26)" stroke="rgba(255,255,255,0.4)" strokeWidth={r * 0.03} />
      case 'rotor':
        return <path key={i} d={p.d} fill="#C6CEDA" />
      default:
        if (p.stroke != null)
          return (
            <path
              key={i}
              d={p.d}
              fill="none"
              stroke={STROKE[p.role] ?? '#8A94A3'}
              strokeWidth={p.stroke}
              strokeLinecap={p.role === 'windows' && !p.round ? 'butt' : 'round'}
              strokeLinejoin="round"
              strokeDasharray={p.dash?.join(' ')}
            />
          )
        return <path key={i} d={p.d} fill={FLAT[p.role] ?? '#BFC7D2'} />
    }
  }

  return (
    <svg ref={ref} viewBox={`${x} ${y} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label} className={className} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.42" stopColor="#F3F5F8" />
          <stop offset="0.78" stopColor="#D6DCE4" />
          <stop offset="1" stopColor="#B4BDC9" />
        </linearGradient>
        <linearGradient id={`${id}-fin`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={finTop} />
          <stop offset="1" stopColor={finBottom} />
        </linearGradient>
        <linearGradient id={`${id}-wing`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#D3D9E1" />
          <stop offset="1" stopColor="#8D98A8" />
        </linearGradient>
        <linearGradient id={`${id}-nacelle`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FAFBFC" />
          <stop offset="0.55" stopColor="#E1E6EC" />
          <stop offset="1" stopColor="#9EA8B6" />
        </linearGradient>
        {fuselage && (
          <clipPath id={`${id}-clip`}>
            <path d={fuselage.d} />
          </clipPath>
        )}
      </defs>
      {profile.parts.map(paint)}
    </svg>
  )
}
