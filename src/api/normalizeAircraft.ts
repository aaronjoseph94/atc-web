import type { Aircraft } from './types'

/** OpenSky state vector indices (documented REST API). */
const IDX = {
  icao24: 0,
  callsign: 1,
  lon: 5,
  lat: 6,
  baroAlt: 7,
  onGround: 8,
  velocity: 9,
  trueTrack: 10,
  geoAlt: 13,
} as const

const MS_TO_KT = 1.94384
const M_TO_FT = 3.28084

export type OpenSkyState = (string | number | boolean | null)[]

export function normalizeOpenSkyStates(states: OpenSkyState[] | null | undefined): Aircraft[] {
  if (!states?.length) return []

  const out: Aircraft[] = []
  for (const s of states) {
    const lat = num(s[IDX.lat])
    const lon = num(s[IDX.lon])
    if (lat == null || lon == null) continue

    const icao24 = String(s[IDX.icao24] ?? '').trim().toLowerCase()
    if (!icao24) continue

    const rawCs = String(s[IDX.callsign] ?? '').trim().toUpperCase()
    const baro = num(s[IDX.baroAlt])
    const geo = num(s[IDX.geoAlt])
    const altM = baro ?? geo
    const vel = num(s[IDX.velocity])
    const track = num(s[IDX.trueTrack])

    out.push({
      icao24,
      callsign: rawCs || icao24.toUpperCase(),
      lat,
      lon,
      heading: track ?? 0,
      altitudeFt: altM == null ? null : Math.round(altM * M_TO_FT),
      speedKt: vel == null ? null : Math.round(vel * MS_TO_KT),
      onGround: Boolean(s[IDX.onGround]),
    })
  }
  return out
}

function num(v: unknown): number | null {
  if (typeof v !== 'number' || Number.isNaN(v)) return null
  return v
}
