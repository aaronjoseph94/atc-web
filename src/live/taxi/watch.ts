/**
 * Listens to the live radio for taxi clearances and turns each one into a
 * route on the map for the aircraft it was given to.
 */
import { usePlayhead } from '../../playback/playheadStore'
import { liveBuffer } from '../session'
import { useRadio, type Transmission } from '../radio/radioStore'
import { toLngLat, toXY } from './graph'
import { loadNetwork } from './network'
import { describeTaxi, parseTaxi } from './parse'
import { planRoute } from './route'
import { useTaxi, type TaxiRoute } from './store'

/** Faster than this on the "ground" is a takeoff or landing roll, not taxiing. */
const MAX_TAXI_KT = 45

export type TaxiResult = { route: TaxiRoute } | { error: 'no-instruction' | 'no-aircraft' | 'airborne' | 'no-network' | 'no-route' }

/**
 * Parse a call and, if it holds a taxi clearance, route it for the aircraft
 * and put it on the map. Also used to show a clearance again from the transcript.
 */
export async function showTaxiRoute(text: string, icao24: string | null, airport: string, at = Date.now()): Promise<TaxiResult> {
  const clearance = parseTaxi(text)
  if (!clearance) return { error: 'no-instruction' }
  if (!icao24) return { error: 'no-aircraft' }
  const a = liveBuffer.get(icao24)
  if (!a) return { error: 'no-aircraft' }
  if (!a.onGround && (a.altitudeFt ?? 0) > 0 && (a.speedKt ?? 0) > MAX_TAXI_KT) return { error: 'airborne' }
  const net = await loadNetwork(airport)
  if (!net) return { error: 'no-network' }
  // The aircraft has moved on while the tiles loaded: route from where it is now.
  const now = liveBuffer.get(icao24) ?? a
  const plan = planRoute(net.graph, {
    clearance,
    start: toXY(net.graph, [now.lon, now.lat]),
    heading: now.headingKnown === false ? null : now.heading,
    moving: (now.speedKt ?? 0) > 3,
    runways: net.runways,
  })
  if (!plan || plan.points.length < 2) return { error: 'no-route' }
  const route: TaxiRoute = {
    id: `taxi-${icao24}-${at}`,
    icao24,
    callsign: now.callsign,
    airport,
    text,
    summary: describeTaxi(clearance),
    clearance,
    at,
    coords: plan.points.map((p) => toLngLat(net.graph, p)),
    holds: plan.holds.map((h) => ({ at: toLngLat(net.graph, h.at), bearing: h.bearing, label: h.label })),
    runway: plan.runway,
    exact: plan.exact,
    missing: plan.missing,
  }
  // Still at the same airport and still live?
  const ph = usePlayhead.getState()
  if (ph.mode !== 'live' || ph.airportIcao !== airport) return { error: 'no-route' }
  useTaxi.getState().add(route)
  return { route }
}

/** The aircraft a call was to or from. */
export function callAircraft(t: Transmission): string | null {
  return t.icao24 ?? t.callsigns.find((c) => c.icao24)?.icao24 ?? null
}

/** Start watching the radio. Returns a stop function. */
export function startTaxiWatcher(): () => void {
  const seen = new Set<string>()
  // Calls already logged when we start are history, not new clearances.
  for (const list of Object.values(useRadio.getState().log)) for (const t of list) seen.add(t.id)
  const offRadio = useRadio.subscribe((s, prev) => {
    if (s.log === prev.log) return
    for (const list of Object.values(s.log)) {
      for (const t of list) {
        if (seen.has(t.id) || t.status !== 'done' || !t.text) continue
        seen.add(t.id)
        void showTaxiRoute(t.text, callAircraft(t), t.airport, t.at)
      }
    }
  })
  const offPlayhead = usePlayhead.subscribe((s, prev) => {
    if (s.airportIcao !== prev.airportIcao || s.mode !== prev.mode) useTaxi.getState().clear()
  })
  return () => {
    offRadio()
    offPlayhead()
  }
}
