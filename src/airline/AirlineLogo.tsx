import { useState } from 'react'
import { useAirlineLogo } from './useAirlineLogo'

type Props = {
  callsign: string | null | undefined
  /** Transponder address, so an address standing in for an unknown callsign never gets a logo. */
  icao24?: string | null
  /** Height of the box the logo is fitted into, in CSS pixels. */
  height: number
  /** Widest a wordmark may get, in CSS pixels. */
  maxWidth: number
  className?: string
}

/**
 * The airline's logo, fitted into a `maxWidth` × `height` box. Renders
 * nothing for private flights, unknown airlines, while the logo index is
 * loading, or if the file fails: never a broken image.
 */
export function AirlineLogo({ callsign, icao24, height, maxWidth, className = '' }: Props) {
  const logo = useAirlineLogo(callsign, icao24)
  const [failed, setFailed] = useState<string | null>(null)
  if (!logo || failed === logo.code) return null
  const s = Math.min(height / logo.h, maxWidth / logo.w)
  return (
    <img
      src={logo.url}
      alt={logo.name ?? ''}
      title={logo.name ?? undefined}
      width={Math.round(logo.w * s)}
      height={Math.round(logo.h * s)}
      decoding="async"
      draggable={false}
      onError={() => setFailed(logo.code)}
      className={`pointer-events-none select-none object-contain ${className}`}
    />
  )
}
