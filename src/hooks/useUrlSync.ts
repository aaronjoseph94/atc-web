import { useEffect } from 'react'
import { AIRPORTS, getAirport } from '../api/airports'
import { usePlayhead } from '../playback/playheadStore'

/**
 * Keeps the address bar and the airport in step (`/#/JFK`), so a view can be
 * bookmarked or shared and the browser's back button moves between airports.
 */
export function useUrlSync() {
  const airportIcao = usePlayhead((s) => s.airportIcao)

  useEffect(() => {
    const wanted = `#/${airportIcao}`
    if (location.hash !== wanted) history.replaceState(null, '', wanted)
    document.title = `${airportIcao} live traffic | ATC Web`
  }, [airportIcao])

  useEffect(() => {
    const onHash = () => {
      const code = /^#\/?([A-Za-z]{3})\b/.exec(location.hash)?.[1]?.toUpperCase()
      if (!code || code === usePlayhead.getState().airportIcao) return
      if (AIRPORTS.some((a) => a.icao === code)) usePlayhead.getState().setAirport(getAirport(code).icao)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
}
