/**
 * Paints a generated side profile (`sideProfiles.ts`) as SVG, in one neutral
 * finish whatever the operator: a soft white airframe shaded from the crown
 * down to a light grey belly, cool grey wings and fin, a dark window line,
 * shaded engines and dark tyres. No livery. Hairline edges are drawn at a
 * constant screen width, so overlapping parts stay distinct at any size.
 *
 * It slides in from the left a few pixels and fades up when the aircraft
 * changes, unless motion is reduced.
 */
import { useEffect, useId, useRef } from 'react'
import { useReducedMotion } from '../ui/motion'
import type { Part, PartRole, SideProfile } from './sideProfiles'

type Props = {
  profile: SideProfile
  label: string
  className?: string
  /** Replays the entrance when this changes. */
  animKey?: string
}

const FLAT: Partial<Record<PartRole, string>> = {
  intake: '#2A3342',
  lip: '#F4F6F9',
  exhaust: '#6A7484',
  glass: '#1B2433',
  blade: '#4A5363',
  spinner: '#E9EDF2',
  hub: '#4A5363',
  wheel: '#232A34',
  wheelhub: '#9AA4B2',
}

const STROKE: Partial<Record<PartRole, string>> = {
  windows: '#334055',
  gear: '#8A94A3',
  strut: '#B5BECA',
  skid: '#A3ACB9',
  mast: '#6E7887',
  pillar: '#D9DEE5',
}

/** A hairline round a part, the same width on screen at any size. */
const EDGE = { stroke: 'rgba(38,50,70,0.55)', strokeWidth: 0.6, vectorEffect: 'non-scaling-stroke' as const, strokeLinejoin: 'round' as const }

export function SideView({ profile, label, className, animKey }: Props) {
  const id = useId().replace(/:/g, '')
  const reduced = useReducedMotion()
  const ref = useRef<SVGSVGElement>(null)
  const [x, y, w, h] = profile.box
  const [bodyTop, bodyBottom] = profile.body

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

  const paint = (p: Part, i: number) => {
    switch (p.role) {
      case 'fuselage':
      case 'fairing':
        return <path key={i} d={p.d} fill={`url(#${id}-body)`} {...EDGE} />
      case 'fin':
        return <path key={i} d={p.d} fill={`url(#${id}-fin)`} {...EDGE} />
      case 'wing':
      case 'stab':
        return <path key={i} d={p.d} fill={`url(#${id}-wing)`} {...EDGE} />
      case 'nacelle':
        return <path key={i} d={p.d} fill={`url(#${id}-nacelle)`} {...EDGE} />
      case 'core':
        return <path key={i} d={p.d} fill={`url(#${id}-core)`} {...EDGE} />
      case 'pylon':
        return <path key={i} d={p.d} fill="#C9D0D9" {...EDGE} />
      case 'door':
        return <path key={i} d={p.d} fill="none" stroke="rgba(60,74,96,0.3)" strokeWidth={0.75} vectorEffect="non-scaling-stroke" />
      case 'prop':
        return <path key={i} d={p.d} fill="rgba(206,216,232,0.16)" stroke="rgba(226,232,242,0.3)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
      case 'rotor':
        return <path key={i} d={p.d} fill="#C6CEDA" {...EDGE} />
      case 'spinner':
        return <path key={i} d={p.d} fill={FLAT.spinner} {...EDGE} />
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
        {/* Crown highlight, white flanks, a cool grey belly: one gradient for the fuselage and its fairings. */}
        <linearGradient id={`${id}-body`} gradientUnits="userSpaceOnUse" x1="0" y1={bodyTop} x2="0" y2={bodyBottom + (bodyBottom - bodyTop) * 0.06}>
          <stop offset="0" stopColor="#E6EBF1" />
          <stop offset="0.14" stopColor="#FFFFFF" />
          <stop offset="0.52" stopColor="#F2F4F7" />
          <stop offset="0.8" stopColor="#D3D9E1" />
          <stop offset="1" stopColor="#AEB8C5" />
        </linearGradient>
        <linearGradient id={`${id}-fin`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#DCE2E9" />
          <stop offset="1" stopColor="#F4F6F9" />
        </linearGradient>
        <linearGradient id={`${id}-wing`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#EEF1F5" />
          <stop offset="1" stopColor="#AAB4C2" />
        </linearGradient>
        <linearGradient id={`${id}-nacelle`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F2F4F7" />
          <stop offset="0.3" stopColor="#FFFFFF" />
          <stop offset="0.7" stopColor="#DCE1E8" />
          <stop offset="1" stopColor="#A2ACBA" />
        </linearGradient>
        <linearGradient id={`${id}-core`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#B9C2CE" />
          <stop offset="1" stopColor="#7E8898" />
        </linearGradient>
      </defs>
      {profile.parts.map(paint)}
    </svg>
  )
}
