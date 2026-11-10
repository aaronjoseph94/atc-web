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
