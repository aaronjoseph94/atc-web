import { useEffect, useSyncExternalStore } from 'react'
import { loadLogoIndex, logoFor, logosVersion, subscribeLogos, type Logo } from './logos'

/** The logo for a callsign, re-rendering once the index arrives. Null while loading and when there is none. */
export function useAirlineLogo(callsign: string | null | undefined, icao24?: string | null): Logo | null {
  useSyncExternalStore(subscribeLogos, logosVersion, logosVersion)
  useEffect(() => {
    void loadLogoIndex()
  }, [])
  return logoFor(callsign, icao24) ?? null
}
