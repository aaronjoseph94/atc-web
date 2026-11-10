import { useEffect, useRef } from 'react'
import { AIRPORTS, getAirport } from '../api/airports'
import { usePlayhead } from '../playback/playheadStore'

/** The airport code named in a location hash (`#/JFK`, `#jfk`), upper-cased, or null. */
export function airportFromHash(hash: string): string | null {
  return /^#\/?([A-Za-z]{3})\b/.exec(hash)?.[1]?.toUpperCase() ?? null
}

/**
 * How the address bar should follow an airport change: `push` a history entry
 * when the user went to another airport in live mode (so Back returns to the
 * last one), `replace` for the first load and for the hops a replay makes on
 * its way in and out (Back shouldn't walk through those), or nothing when the
 * URL already says so (it was the URL that changed, by Back or Forward).
 */
export function hashUpdate(hash: string, airportIcao: string, first: boolean, playbackInvolved: boolean): 'push' | 'replace' | null {
  if (hash === `#/${airportIcao}`) return null
  // A typed `#/sfo` already made its own history entry: just tidy it to `#/SFO`.
  if (first || playbackInvolved || airportFromHash(hash) === airportIcao) return 'replace'
  return 'push'
}

/**
 * Keeps the address bar and the airport in step (`/#/JFK`), so a view can be
 * bookmarked or shared and the browser's back button moves between airports.
 */
export function useUrlSync() {
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const mode = usePlayhead((s) => s.mode)
  const last = useRef<{ airportIcao: string; mode: string } | null>(null)

  useEffect(() => {
    const prev = last.current
    last.current = { airportIcao, mode }
    if (prev && prev.airportIcao === airportIcao) return
    const wanted = `#/${airportIcao}`
    const how = hashUpdate(location.hash, airportIcao, !prev, mode === 'playback' || prev?.mode === 'playback')
    if (how === 'push') history.pushState(null, '', wanted)
    else if (how === 'replace') history.replaceState(null, '', wanted)
    document.title = `${airportIcao} live traffic | ATC Web`
  }, [airportIcao, mode])

  useEffect(() => {
    const onHash = () => {
      const code = airportFromHash(location.hash)
      const current = usePlayhead.getState().airportIcao
      if (code === current) return
      if (code && AIRPORTS.some((a) => a.icao === code)) usePlayhead.getState().setAirport(getAirport(code).icao)
      // An airport we don't cover (or no code at all): put the address back to the one on screen.
      else history.replaceState(null, '', `#/${current}`)
    }
    // Back and Forward between pushed entries fire popstate (and hashchange); typing a new hash fires hashchange.
    window.addEventListener('hashchange', onHash)
    window.addEventListener('popstate', onHash)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('popstate', onHash)
    }
  }, [])
}
