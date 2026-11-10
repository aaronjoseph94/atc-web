/**
 * Extra, free sources for flight details, merged over what
 * `fetchFlightInfo` (adsbdb.com) returns:
 *  - hexdb.io: airframe by transponder address and route by callsign (no key).
 *    Its routes carry an `updated_at`; old ones are often wrong, so a route
 *    is only used while it is recent and adsbdb has none.
 *  - the ADS-B feed itself (adsb.fi / adsb.lol hex lookup): registration,
 *    type and registered owner straight from the aggregator's database, the
 *    fallback when neither database knows the airframe.
 *
 * Fields are merged by confidence: each source has a weight, agreeing sources
 * add up, and the best-supported value wins. Airframes barely change, so they
 * are cached for days; routes (flight numbers get re-used) for an hour.
 */
import { getJson, USER_AGENT } from './aircraftHandler'
import { fetchFlightInfo } from './flightInfoHandler'
import { hedgedFirst, noCache, sourceHealth, type JsonCache, type SourceHealth } from './sourceHealth'
import type { FlightInfo, RouteAirport } from './types'

const TIMEOUT_MS = 6000

/** How long answers are cached. Unknowns are retried sooner: the databases fill in. */
export const FLIGHT_TTL_S = {
  airframe: 7 * 24 * 3600,
  route: 3600,
  unknown: 900,
} as const

/** hexdb routes older than this are ignored (schedules change, flight numbers move). */
const MAX_ROUTE_AGE_MS = 548 * 24 * 3600 * 1000

// ---------------------------------------------------------------------------
// Wire formats
// ---------------------------------------------------------------------------

export type HexdbAircraft = {
  hex?: string
  registration?: string
  manufacturer?: string
  type?: string
  icao_type_code?: string
  registered_owner?: string
}

type HexdbAirport = { icao?: string; iata?: string; name?: string; region?: string; latitude?: number; longitude?: number }

export type HexdbRoute = {
  callsign?: string
  origin?: HexdbAirport
  destination?: HexdbAirport
  updated_at?: string
}

/** One row of a readsb `/v2/hex/{hex}` answer (the fields we read). */
export type FeedAirframe = { r?: string; t?: string; desc?: string; ownOp?: string }

/** Airframe facts from one source. */
export type Airframe = {
  registration: string | null
  typeName: string | null
  manufacturer: string | null
  owner: string | null
}

export type Route = {
  airline: string | null
  origin: RouteAirport | null
  destination: RouteAirport | null
}

// ---------------------------------------------------------------------------
// Normalizers (pure, unit-tested)
// ---------------------------------------------------------------------------

const clean = (v: string | null | undefined) => {
  const t = (v ?? '').trim()
  return t ? t : null
}

export function normalizeHexdbAircraft(a: HexdbAircraft | null | undefined): Airframe | null {
  if (!a || (!a.registration && !a.type)) return null
  return {
    registration: clean(a.registration),
    typeName: clean(a.type),
    manufacturer: clean(a.manufacturer),
    owner: clean(a.registered_owner),
  }
}

function hexdbAirport(a: HexdbAirport | undefined): RouteAirport | null {
  if (!a || (!a.icao && !a.iata)) return null
  return {
    iata: clean(a.iata),
    icao: clean(a.icao),
    name: clean(a.name),
    // hexdb has the state/province, not the city; better than nothing for a label.
    city: clean(a.region),
    lat: typeof a.latitude === 'number' ? a.latitude : null,
    lon: typeof a.longitude === 'number' ? a.longitude : null,
  }
}

/** hexdb route → `Route`, or null when missing or too old to trust. */
export function normalizeHexdbRoute(r: HexdbRoute | null | undefined, now = Date.now()): Route | null {
  if (!r) return null
  const origin = hexdbAirport(r.origin)
  const destination = hexdbAirport(r.destination)
  if (!origin || !destination) return null
  const updated = r.updated_at ? Date.parse(r.updated_at) : Number.NaN
  if (!Number.isFinite(updated) || now - updated > MAX_ROUTE_AGE_MS) return null
  return { airline: null, origin, destination }
}

export function normalizeFeedAirframe(rows: FeedAirframe[] | null | undefined): Airframe | null {
  const a = rows?.[0]
  if (!a || (!a.r && !a.t)) return null
  return {
    registration: clean(a.r),
    // `desc` reads "BOEING 767-300"; the designator is the fallback.
    typeName: clean(a.desc) ?? clean(a.t),
    manufacturer: null,
    // Feeds carry the registered owner, often a leasing company.
    owner: clean(a.ownOp),
  }
}

// ---------------------------------------------------------------------------
// Confidence merge
// ---------------------------------------------------------------------------

/**
 * How much each source is trusted. Registry-backed databases beat the feed's
 * own tables, but two independent sources that agree outvote any single one.
 */
export const WEIGHTS: Record<string, number> = { adsbdb: 3, hexdb: 2, feed: 1.5 }

export type Candidate<T> = { source: string; value: T | null }

/**
 * Pick the value with the most combined weight; equal totals go to the value
 * with the single most-trusted source. Strings compare case- and
 * space-insensitively, so "N1439A" from two sources counts as agreement.
 */
export function pickByConfidence<T>(candidates: Candidate<T>[], key: (v: T) => string = (v) => String(v).replace(/[\s-]/g, '').toUpperCase()): { value: T | null; sources: string[] } {
  const groups = new Map<string, { value: T; total: number; best: number; sources: string[] }>()
  for (const c of candidates) {
    if (c.value == null) continue
    const w = WEIGHTS[c.source] ?? 1
    const k = key(c.value)
    const g = groups.get(k)
    if (g) {
      g.total += w
      g.sources.push(c.source)
      if (w > g.best) {
        g.best = w
        g.value = c.value
      }
    } else groups.set(k, { value: c.value, total: w, best: w, sources: [c.source] })
  }
  let win: { value: T; total: number; best: number; sources: string[] } | null = null
  for (const g of groups.values()) if (!win || g.total > win.total || (g.total === win.total && g.best > win.best)) win = g
  return win ? { value: win.value, sources: win.sources } : { value: null, sources: [] }
}

/**
 * Lay hexdb and feed facts over adsbdb's answer. Pure; unit-tested.
 * `base` keeps everything this module doesn't know about (the photo, the
 * callsign) untouched.
 */
export function mergeFlightInfo(base: FlightInfo, extra: { hexdb?: Airframe | null; feed?: Airframe | null; hexdbRoute?: Route | null }): FlightInfo & { sources: string[] } {
  const fromBase: Airframe = { registration: base.registration, typeName: base.typeName, manufacturer: base.manufacturer, owner: base.owner }
  const frames: [string, Airframe | null | undefined][] = [
    ['adsbdb', fromBase],
    ['hexdb', extra.hexdb],
    ['feed', extra.feed],
  ]
  const used = new Set<string>()
  const field = <K extends keyof Airframe>(k: K) => {
    const r = pickByConfidence(frames.map(([source, f]) => ({ source, value: f?.[k] ?? null })))
    for (const s of r.sources) used.add(s)
    return r.value
  }
  const merged = {
    ...base,
    registration: field('registration'),
    typeName: field('typeName'),
    manufacturer: field('manufacturer'),
    owner: field('owner'),
  }
  const baseHasRoute = Boolean(base.origin || base.destination)
  if (baseHasRoute) used.add('adsbdb')
  else if (extra.hexdbRoute) {
    merged.origin = extra.hexdbRoute.origin
    merged.destination = extra.hexdbRoute.destination
    used.add('hexdb')
  }
  if (base.airline) used.add('adsbdb')
  const order = ['adsbdb', 'hexdb', 'feed']
  return { ...merged, sources: order.filter((s) => used.has(s)) }
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/** GET JSON, treating 404 as "not known" (null) rather than a failure. */
async function getKnown<T>(url: string, signal: AbortSignal): Promise<T | null> {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

/** Cache-through helper: unknowns are cached briefly, knowns for `ttl`. */
async function cached<T>(cache: JsonCache, key: string, ttl: number, load: () => Promise<T | null>): Promise<T | null> {
  const hit = await cache.get<{ v: T | null }>(key)
  if (hit) return hit.v
  const v = await load()
  await cache.put(key, { v }, v == null ? FLIGHT_TTL_S.unknown : ttl)
  return v
}

/** Airframe from hexdb.io, cached per transponder. */
export function hexdbAirframe(hex: string, cache: JsonCache = noCache, health: SourceHealth = sourceHealth) {
  return cached(cache, `hexdb-ac:${hex}`, FLIGHT_TTL_S.airframe, async () => {
    const r = await hedgedFirst([{ name: 'hexdb.io', run: (s) => getKnown<HexdbAircraft>(`https://hexdb.io/api/v2/aircraft/${hex}`, s) }], { health, timeoutMs: TIMEOUT_MS, isGood: () => true })
    return normalizeHexdbAircraft(r.value)
  })
}

/** Route from hexdb.io, cached per callsign (shortly: flight numbers move). */
export function hexdbRoute(callsign: string, cache: JsonCache = noCache, health: SourceHealth = sourceHealth) {
  return cached(cache, `hexdb-rt:${callsign}`, FLIGHT_TTL_S.route, async () => {
    const r = await hedgedFirst([{ name: 'hexdb.io', run: (s) => getKnown<HexdbRoute>(`https://hexdb.io/api/v2/routes/${callsign}`, s) }], { health, timeoutMs: TIMEOUT_MS, isGood: () => true })
    return normalizeHexdbRoute(r.value)
  })
}

/** Airframe from the ADS-B aggregators' own database (adsb.fi first, adsb.lol as backup). */
export function feedAirframe(hex: string, cache: JsonCache = noCache, health: SourceHealth = sourceHealth) {
  return cached(cache, `feed-ac:${hex}`, FLIGHT_TTL_S.airframe, async () => {
    const r = await hedgedFirst(
      [
        { name: 'adsb.fi', run: (s) => getJson<{ ac?: FeedAirframe[] }>(`https://opendata.adsb.fi/api/v2/hex/${hex}`, s) },
        { name: 'adsb.lol', run: (s) => getJson<{ ac?: FeedAirframe[] }>(`https://api.adsb.lol/v2/hex/${hex}`, s) },
      ],
      { health, timeoutMs: TIMEOUT_MS, hedgeMs: 2000, isGood: (v) => Boolean(v.ac?.length) },
    )
    return normalizeFeedAirframe(r.value?.ac)
  })
}

/**
 * Route, airframe (and photo, untouched) for one flight from every free
 * source, merged. Never throws; unknown parts come back null. The feed lookup
 * only runs when the databases don't know the airframe.
 */
export async function fetchFlightDetails(
  hex: string | null,
  callsign: string | null,
  cache: JsonCache = noCache,
): Promise<FlightInfo & { sources: string[] }> {
  const [base, hexdb, hexdbRt] = await Promise.all([
    fetchFlightInfo(hex, callsign),
    hex ? hexdbAirframe(hex, cache).catch(() => null) : Promise.resolve(null),
    callsign ? hexdbRoute(callsign, cache).catch(() => null) : Promise.resolve(null),
  ])
  const needFeed = hex && !base.registration && !base.typeName && !hexdb
  const feed = needFeed ? await feedAirframe(hex, cache).catch(() => null) : null
  return mergeFlightInfo(base, { hexdb, feed, hexdbRoute: hexdbRt })
}
