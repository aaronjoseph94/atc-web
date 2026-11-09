/**
 * Small-area geodesy. Everything here works on a local flat-earth frame, which
 * is accurate to well under a metre across an airfield and a few metres across
 * the ~15 nm the app ever looks at.
 */

/** `[longitude, latitude]` in degrees (MapLibre / GeoJSON ordering). */
export type LngLat = [number, number]

export const M_PER_FT = 0.3048
export const M_PER_NM = 1852

const RAD = Math.PI / 180

/** Metres per degree of latitude at a given latitude (WGS-84 series). */
export function metersPerDegLat(lat: number): number {
  const p = lat * RAD
  return 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p)
}

/** Metres per degree of longitude at a given latitude (WGS-84 series). */
export function metersPerDegLon(lat: number): number {
  const p = lat * RAD
  return 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p)
}

/** Point `eastM` / `northM` metres away from `origin`. */
export function offset(origin: LngLat, eastM: number, northM: number): LngLat {
  return [origin[0] + eastM / metersPerDegLon(origin[1]), origin[1] + northM / metersPerDegLat(origin[1])]
}

/** `p` expressed as `[east, north]` metres from `origin`. */
export function toLocal(origin: LngLat, p: LngLat): [number, number] {
  return [(p[0] - origin[0]) * metersPerDegLon(origin[1]), (p[1] - origin[1]) * metersPerDegLat(origin[1])]
}

export function distanceM(a: LngLat, b: LngLat): number {
  const [e, n] = toLocal(a, b)
  return Math.hypot(e, n)
}

/** Bearing from `a` to `b` in degrees true (0–360). */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const [e, n] = toLocal(a, b)
  return (Math.atan2(e, n) / RAD + 360) % 360
}

/** Signed smallest difference `to − from` in degrees (−180..180). */
export function angleDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180
}

/** Ground metres covered by one CSS pixel at a zoom level (512 px tiles, as MapLibre uses). */
export function metersPerPixel(lat: number, zoom: number): number {
  return (40075016.686 * Math.cos(lat * RAD)) / (512 * 2 ** zoom)
}
