/**
 * Where a flight is along its route, on the great circle between its origin
 * and destination: distance flown, distance to go, and the time to go at the
 * current groundspeed. The local flat-earth helpers in `map/geo.ts` are fine
 * across an airfield but not across a continent, so this file does its own
 * spherical maths.
 */
import type { SpeedUnit } from '../settings/settingsStore'

export type LatLon = { lat: number; lon: number }

const RAD = Math.PI / 180
/** Mean Earth radius in nautical miles. */
const EARTH_NM = 3440.065

/** Great-circle distance in nautical miles (haversine). */
export function greatCircleNm(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * RAD
  const dLon = (b.lon - a.lon) * RAD
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_NM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Initial great-circle bearing from `a` to `b`, degrees true (0–360). */
export function initialBearingDeg(a: LatLon, b: LatLon): number {
  const lat1 = a.lat * RAD
  const lat2 = b.lat * RAD
  const dLon = (b.lon - a.lon) * RAD
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return (Math.atan2(y, x) / RAD + 360) % 360
}

export type RouteProgress = {
  flownNm: number
  remainingNm: number
  /** Origin to destination, straight along the great circle. */
  totalNm: number
  /** 0 at the origin, 1 at the destination. */
  fraction: number
}

const known = (p: { lat?: number | null; lon?: number | null } | null | undefined): p is LatLon => p?.lat != null && p.lon != null && Number.isFinite(p.lat) && Number.isFinite(p.lon)

/**
 * Progress along the route. The fraction is flown / (flown + to go), which
 * stays between 0 and 1 and moves smoothly even when the aircraft is off the
 * direct line (vectors, a holding pattern, a departure turning the long way).
 * Null when either end or the position is unknown.
 */
export function routeProgress(
  origin: { lat?: number | null; lon?: number | null } | null | undefined,
  destination: { lat?: number | null; lon?: number | null } | null | undefined,
  position: { lat?: number | null; lon?: number | null } | null | undefined,
): RouteProgress | null {
  if (!known(origin) || !known(destination) || !known(position)) return null
  const totalNm = greatCircleNm(origin, destination)
  if (totalNm < 1) return null
  const flownNm = greatCircleNm(origin, position)
  const remainingNm = greatCircleNm(position, destination)
  const fraction = flownNm + remainingNm > 0 ? Math.min(1, Math.max(0, flownNm / (flownNm + remainingNm))) : 0
  return { flownNm, remainingNm, totalNm, fraction }
}

/** Below this groundspeed a time to go means nothing (taxiing, a hovering helicopter). */
export const MIN_ETA_KT = 50

/** Time to cover `nm` at `groundspeedKt`, in ms; null when too slow to say. */
export function timeToGoMs(nm: number, groundspeedKt: number | null | undefined): number | null {
  if (groundspeedKt == null || !Number.isFinite(groundspeedKt) || groundspeedKt < MIN_ETA_KT || !Number.isFinite(nm) || nm < 0) return null
  return (nm / groundspeedKt) * 3_600_000
}

/**
 * A distance in the unit that goes with the speed setting (kt → nm, km/h →
 * km, mph → mi), as elsewhere in the app: one decimal under 10, whole above.
 */
export function formatDistance(nm: number, unit: SpeedUnit): string {
  const [v, u] = unit === 'kmh' ? [nm * 1.852, 'km'] : unit === 'mph' ? [nm * 1.15078, 'mi'] : [nm, 'nm']
  const text = v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString('en-US')
  return `${text} ${u}`
}

// ---------------------------------------------------------------------------
// A route that contradicts what the aircraft is doing
// ---------------------------------------------------------------------------

/** How the aircraft relates to the airport being watched, for checking its route. */
export type RouteCheck = {
  /** The watched airport's code (as the app names it, e.g. `ATL`) and its ICAO code (`KATL`). */
  here: string
  hereIcao?: string | null
  /** Arriving (descending, on final), departing (taking off, climbing) or can't tell (on the ground, level). */
  heading: 'arriving' | 'departing' | 'unclear'
  /** Close enough to the field (and low enough) for its route to have to start or end here. */
  near: boolean
}

type Ends = { origin: { iata?: string | null; icao?: string | null } | null; destination: { iata?: string | null; icao?: string | null } | null }

/**
 * Routes come from the flight number, and a number is often flown in both
 * directions in a day (or re-used), so the free sources can return the other
 * leg: a flight on final here shown as leaving from here, "2.8 nm flown, 660
 * to go". Near the field the route must start or end here:
 *  - arriving, it must end here: if it starts here instead, it is the return
 *    leg reversed, so flip it;
 *  - departing, it must start here: if it ends here instead, flip it;
 *  - if neither end is here (or the direction can't be told and neither end
 *    matches), the route is wrong and is dropped rather than shown.
 * Away from the field nothing is checked.
 */
export function reconcileRoute<T extends Ends>(info: T, check: RouteCheck): T {
  if (!check.near || (!info.origin && !info.destination)) return info
  const codes = new Set([check.here, check.hereIcao, `K${check.here}`].filter(Boolean).map((c) => String(c).toUpperCase()))
  const isHere = (a: Ends['origin']) => !!a && [a.iata, a.icao].some((c) => !!c && codes.has(c.toUpperCase()))
  const fromHere = isHere(info.origin)
  const toHere = isHere(info.destination)
  const flipped = { ...info, origin: info.destination, destination: info.origin }
  const dropped = { ...info, origin: null, destination: null }
  if (check.heading === 'arriving') return toHere ? info : fromHere ? flipped : dropped
  if (check.heading === 'departing') return fromHere ? info : toHere ? flipped : dropped
  return fromHere || toHere ? info : dropped
}
