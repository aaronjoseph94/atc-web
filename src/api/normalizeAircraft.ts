/**
 * Provider-specific payloads → `Aircraft[]`.
 *
 * Two wire formats are supported:
 *  - readsb / tar1090 JSON (`{ ac: [...] }`), used by adsb.lol and adsb.fi
 *  - OpenSky state vectors (positional arrays)
 */
import type { Aircraft } from './types'

const MS_TO_KT = 1.94384
const M_TO_FT = 3.28084

/** Positions older than this are considered stale and dropped. */
const MAX_POSITION_AGE_SEC = 60

// ---------------------------------------------------------------------------
// readsb (adsb.lol / adsb.fi / airplanes.live)
// ---------------------------------------------------------------------------

/** Subset of the readsb aircraft record that we read. */
export type ReadsbAircraft = {
  hex?: string
  flight?: string
  r?: string
  t?: string
  lat?: number
  lon?: number
  /** Feet, or the literal string `"ground"` when on the surface. */
  alt_baro?: number | 'ground'
  alt_geom?: number
  /** Ground speed in knots. */
  gs?: number
  /** True track in degrees. */
  track?: number
  /** Nose heading, sent by some aircraft on the ground when track is absent. */
  true_heading?: number
  mag_heading?: number
  /** ADS-B emitter category, e.g. `A3`. */
  category?: string
  squawk?: string
  emergency?: string
  /** Altitude selected on the autopilot panel, feet. */
  nav_altitude_mcp?: number
  /** Vertical rate in ft/min. */
  baro_rate?: number
  geom_rate?: number
  /** Seconds since the last position update. */
  seen_pos?: number
}

/** Normalize a readsb-style `ac` array into `Aircraft[]`, dropping stale/partial rows. */
export function normalizeReadsb(list: ReadsbAircraft[] | null | undefined): Aircraft[] {
  if (!list?.length) return []

  const out: Aircraft[] = []
  for (const a of list) {
    const lat = num(a.lat)
    const lon = num(a.lon)
    if (lat == null || lon == null) continue
    if ((a.seen_pos ?? 0) > MAX_POSITION_AGE_SEC) continue

    const icao24 = (a.hex ?? '').trim().toLowerCase().replace(/^~/, '')
    if (!icao24) continue

    const onGround = a.alt_baro === 'ground'
    const alt = onGround ? 0 : (num(a.alt_baro) ?? num(a.alt_geom))
    const callsign = (a.flight ?? '').trim().toUpperCase()
    // Parked aircraft often send no track; fall back to the nose heading.
    const heading = num(a.track) ?? num(a.true_heading) ?? num(a.mag_heading)
    const emergency = a.emergency && a.emergency !== 'none' ? a.emergency : null

    const ac: Aircraft = {
      icao24,
      callsign: callsign || icao24.toUpperCase(),
      lat,
      lon,
      heading: heading ?? 0,
      altitudeFt: alt == null ? null : Math.round(alt),
      speedKt: a.gs == null ? null : Math.round(a.gs),
      onGround,
      type: a.t?.trim() || null,
      registration: a.r?.trim() || null,
      verticalRateFpm: num(a.baro_rate) ?? num(a.geom_rate) ?? null,
    }
    // Optional extras are only attached when present, keeping payloads small.
    if (heading == null) ac.headingKnown = false
    if (a.category) ac.category = a.category.trim().toUpperCase()
    if (a.squawk) ac.squawk = a.squawk
    if (emergency) ac.emergency = emergency
    const sel = num(a.nav_altitude_mcp)
    if (sel != null) ac.selectedAltitudeFt = Math.round(sel)
    out.push(ac)
  }
  return out
}

// ---------------------------------------------------------------------------
// OpenSky Network
// ---------------------------------------------------------------------------

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
  verticalRate: 11,
  geoAlt: 13,
} as const

export type OpenSkyState = (string | number | boolean | null)[]

/** Normalize OpenSky `/states/all` vectors into `Aircraft[]` (metres → ft, m/s → kt). */
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
    const altM = num(s[IDX.baroAlt]) ?? num(s[IDX.geoAlt])
    const vel = num(s[IDX.velocity])
    const vr = num(s[IDX.verticalRate])

    out.push({
      icao24,
      callsign: rawCs || icao24.toUpperCase(),
      lat,
      lon,
      heading: num(s[IDX.trueTrack]) ?? 0,
      ...(num(s[IDX.trueTrack]) == null ? { headingKnown: false } : {}),
      altitudeFt: altM == null ? null : Math.round(altM * M_TO_FT),
      speedKt: vel == null ? null : Math.round(vel * MS_TO_KT),
      onGround: Boolean(s[IDX.onGround]),
      verticalRateFpm: vr == null ? null : Math.round(vr * M_TO_FT * 60),
    })
  }
  return out
}

/** Finite-number guard; everything else becomes `null`. */
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
