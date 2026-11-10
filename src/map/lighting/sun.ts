/**
 * Where the sun is, so the map can go dark when the airport does.
 *
 * A compact version of the NOAA / Astronomical Almanac low-precision solar
 * position: good to about 0.01° in declination and a few seconds of time
 * between 1950 and 2050, which is far more than deciding "is it dusk yet"
 * needs. No dependency, no tables.
 */

const RAD = Math.PI / 180

/** Sun elevation above the horizon at sunrise/sunset: refraction plus the solar radius. */
export const SUNSET_ELEVATION = -0.833
/** End of civil twilight: below this the sky is dark enough for full night lighting. */
export const CIVIL_DUSK_ELEVATION = -6

export type SunPhase = 'day' | 'twilight' | 'night'

/** Geometric sun elevation (degrees, no refraction) at `lat`/`lon` for an epoch-ms time. */
export function sunElevation(timeMs: number, lat: number, lon: number): number {
  // Days since J2000.0 (2000-01-01 12:00 TT; UT is close enough here).
  const n = timeMs / 86_400_000 + 2440587.5 - 2451545.0
  const meanLon = (280.46 + 0.9856474 * n) % 360
  const anomaly = ((357.528 + 0.9856003 * n) % 360) * RAD
  const eclLon = (meanLon + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * RAD
  const obliquity = (23.439 - 0.0000004 * n) * RAD
  const ra = Math.atan2(Math.cos(obliquity) * Math.sin(eclLon), Math.cos(eclLon))
  const dec = Math.asin(Math.sin(obliquity) * Math.sin(eclLon))
  // Greenwich mean sidereal time, in degrees, then the local hour angle.
  const gmst = (280.46061837 + 360.98564736629 * n) % 360
  const hourAngle = (gmst + lon) * RAD - ra
  const phi = lat * RAD
  const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle)
  return Math.asin(Math.max(-1, Math.min(1, sinAlt))) / RAD
}

export function sunPhase(elevation: number): SunPhase {
  if (elevation > SUNSET_ELEVATION) return 'day'
  if (elevation > CIVIL_DUSK_ELEVATION) return 'twilight'
  return 'night'
}

/**
 * How "night" the map should look, 0 (day) to 1 (night), for a sun elevation.
 * It ramps through civil twilight, from sunset to the sun 6° down, with an
 * ease at both ends so the change never shows a corner.
 */
export function nightFactor(elevation: number): number {
  const x = (SUNSET_ELEVATION - elevation) / (SUNSET_ELEVATION - CIVIL_DUSK_ELEVATION)
  const c = Math.max(0, Math.min(1, x))
  return c * c * (3 - 2 * c)
}
