/**
 * Provider-specific payloads → `Aircraft[]`.
 *
 * Two wire formats are supported:
 *  - readsb / tar1090 JSON (`{ ac: [...] }`), used by adsb.fi, adsb.lol and
 *    airplanes.live (all three run the same open-source aggregator software)
 *  - OpenSky state vectors (positional arrays)
 *
 * Every row also carries `positionTime` (epoch ms of the position fix) so two
 * feeds can be merged by keeping the freshest position per aircraft. The
 * handler strips it before the list goes to the browser.
 */
import type { Aircraft } from './types'

/** A normalized aircraft plus when its position was measured (server-side only). */
export type TimedAircraft = Aircraft & { positionTime?: number }

const MS_TO_KT = 1.94384
const M_TO_FT = 3.28084

/** Positions older than this are considered stale and dropped. */
const MAX_POSITION_AGE_SEC = 60

// ---------------------------------------------------------------------------
// readsb (adsb.fi / adsb.lol / airplanes.live)
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

/**
 * Normalize a readsb-style `ac` array into `Aircraft[]`, dropping stale/partial
 * rows. `nowMs` is the payload's own `now` (server clock) when it has one.
 */
export function normalizeReadsb(list: ReadsbAircraft[] | null | undefined, nowMs: number = Date.now()): TimedAircraft[] {
  if (!list?.length) return []

  const out: TimedAircraft[] = []
  for (const a of list) {
    const lat = num(a.lat)
    const lon = num(a.lon)
    if (lat == null || lon == null) continue
    if ((a.seen_pos ?? 0) > MAX_POSITION_AGE_SEC) continue

    const icao24 = (a.hex ?? '').trim().toLowerCase().replace(/^~/, '')
    if (!icao24) continue

    const onGround = a.alt_baro === 'ground'
    const alt = onGround ? 0 : (num(a.alt_baro) ?? num(a.alt_geom))
    // Callsigns are letters and digits; some feeders prefix junk like "." or "@".
    const callsign = (a.flight ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    // Parked aircraft often send no track; fall back to the nose heading.
    const heading = num(a.track) ?? num(a.true_heading) ?? num(a.mag_heading)
    const emergency = a.emergency && a.emergency !== 'none' ? a.emergency : null

    const ac: TimedAircraft = {
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
    ac.positionTime = Math.round(nowMs - (num(a.seen_pos) ?? 0) * 1000)
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
  timePosition: 3,
  lastContact: 4,
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

/**
 * Normalize OpenSky `/states/all` vectors into `Aircraft[]` (metres → ft,
 * m/s → kt). `nowSec` is the payload's `time`; positions older than a minute
 * are dropped, as for readsb.
 */
export function normalizeOpenSkyStates(states: OpenSkyState[] | null | undefined, nowSec?: number): TimedAircraft[] {
  if (!states?.length) return []

  const out: TimedAircraft[] = []
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
    // Seconds since epoch; 0/null means "unknown", so fall back to the last contact.
    const posSec = num(s[IDX.timePosition]) || num(s[IDX.lastContact]) || null
    if (nowSec != null && posSec != null && nowSec - posSec > MAX_POSITION_AGE_SEC) continue

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
      ...(posSec == null ? {} : { positionTime: posSec * 1000 }),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Merging feeds
// ---------------------------------------------------------------------------

/** Fields a second feed may fill in when the winning row lacks them. */
const FILLABLE = ['type', 'registration', 'category', 'squawk', 'selectedAltitudeFt', 'verticalRateFpm', 'emergency'] as const

/**
 * Merge aircraft lists from several feeds into one row per transponder.
 *
 * The feeds overlap heavily but each has receivers the others lack, so a
 * merge sees more of the sky. When two feeds report the same aircraft the
 * fresher position wins (ties go to the earlier, healthier feed); details the
 * winner is missing (type, tail, a real callsign) are filled from the other.
 * Returns the merged list and how many rows each feed contributed.
 */
export function mergeAircraft(lists: { source: string; aircraft: TimedAircraft[] }[]): {
  aircraft: TimedAircraft[]
  contributions: Record<string, number>
} {
  const byHex = new Map<string, { ac: TimedAircraft; source: string }>()
  for (const { source, aircraft } of lists) {
    for (const ac of aircraft) {
      const prev = byHex.get(ac.icao24)
      if (!prev) {
        byHex.set(ac.icao24, { ac: { ...ac }, source })
        continue
      }
      const newer = (ac.positionTime ?? 0) > (prev.ac.positionTime ?? 0)
      const [win, lose] = newer ? [{ ...ac }, prev.ac] : [prev.ac, ac]
      fillFrom(win, lose)
      byHex.set(ac.icao24, { ac: win, source: newer ? source : prev.source })
    }
  }
  const contributions: Record<string, number> = {}
  for (const { source } of lists) contributions[source] = 0
  for (const { source } of byHex.values()) contributions[source]++
  return { aircraft: [...byHex.values()].map((x) => x.ac), contributions }
}

function fillFrom(win: TimedAircraft, other: TimedAircraft) {
  const w = win as Record<string, unknown>
  const o = other as Record<string, unknown>
  for (const k of FILLABLE) if (w[k] == null && o[k] != null) w[k] = o[k]
  // The hex stands in for an unknown callsign; a real one from the other feed is better.
  if (win.callsign === win.icao24.toUpperCase() && other.callsign !== other.icao24.toUpperCase()) win.callsign = other.callsign
  if (win.headingKnown === false && other.headingKnown !== false) {
    win.heading = other.heading
    delete win.headingKnown
  }
}

/** Drop the server-only timestamp before a list leaves the API. */
export function stripTiming(list: TimedAircraft[]): Aircraft[] {
  return list.map(({ positionTime: _t, ...ac }) => ac)
}

/** Finite-number guard; everything else becomes `null`. */
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
