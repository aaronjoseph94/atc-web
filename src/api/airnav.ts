/**
 * AirNav Radar's On-Demand API (ODAPI) as the last resort for a flight's
 * route and airframe, when the free sources (adsbdb, hexdb, the ADS-B feeds)
 * know neither.
 *
 * The owner has 100 free credits, so this is built to spend as few as it
 * can and never to run away:
 *  - only when someone opens a flight (the request says so), never from
 *    polling, health checks or tests;
 *  - one request per flight, never retried;
 *  - a daily cap and a lifetime cap on credits, counted in shared storage
 *    (KV when bound, else this data centre's cache) and in this isolate's
 *    memory, checked before the request is made;
 *  - answers, and "nothing known", are remembered (route 6 h, airframe
 *    7 days, nothing known 1 day) so the same flight is not paid for twice;
 *  - a rejected token, an empty account or a rate limit stops all requests
 *    for a while.
 *
 * API shape from AirNav's OpenAPI document (version 2.4.22,
 * https://www.airnavradar.com/api/openapi): `POST /v2/flights/live` with
 * `{ modeSHexCodes: [..] }` or `{ flightIds: [..] }`, bearer token, answer
 * `{ success, cost, comment, flights: [...] }` where `cost` is the credits
 * charged. A token it does not accept is answered with HTTP 200,
 * `success: false`, `cost: 0` and a `comment` (seen by asking once with a
 * made-up token, which costs nothing). The documents do not say what a
 * successful request costs, so each answer's own `cost` is what is counted,
 * and the cost last seen is the room left for the next request.
 */
import type { Airframe, Route } from './flightSources'
import { DAY_TTL_S, dayKey, type Counters, type JsonStore, type StorageKind } from './storage'
import type { FlightInfo, RouteAirport } from './types'

export type AirnavEnv = {
  /** The ODAPI token (Cloudflare secret). Without it nothing here runs. */
  AIRNAV_ODAPI_TOKEN?: string
  /** Most credits spent in one UTC day (default 3). */
  AIRNAV_DAILY_CAP?: string
  /** Most credits ever spent (default 90, leaving a margin under the 100 owned). */
  AIRNAV_TOTAL_CAP?: string
  /** Credits on the account, for the "N of 100" line (default 100). */
  AIRNAV_CREDITS?: string
}

export const AIRNAV_BASE = 'https://api.airnavradar.com/v2'
export const AIRNAV_DEFAULTS = { dailyCap: 3, totalCap: 90, credits: 100 }
const TIMEOUT_MS = 8000

export const AIRNAV_TTL_S = { route: 6 * 3600, airframe: 7 * 24 * 3600, nothing: 24 * 3600, failed: 3600 } as const
/** The lifetime count must outlive everything else here. */
const FOREVER_S = 5 * 365 * 24 * 3600
const BLOCK_S = { auth: 24 * 3600, rate: 3600 }
/** A refusal whose comment is about the token or the account will not get better by asking about another flight. */
const ACCOUNT_TROUBLE = /token|credit|subscription|quota|limit|expired|billing|account|authori[sz]/i

const KEY = { total: 'airnav:total', day: (d: string) => `airnav:day:${d}`, asked: (d: string) => `airnav:asked:${d}`, cost: 'airnav:cost', blocked: 'airnav:blocked' }

/**
 * Requests a day, whatever they cost: answers that cost nothing (nothing
 * found) are free, but that is no reason to ask without end.
 */
export const requestsPerDay = (dailyCap: number) => Math.max(10, dailyCap * 5)

const int = (v: string | undefined, fallback: number) => {
  const n = Number((v ?? '').trim())
  return (v ?? '').trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}

export function airnavCaps(env: AirnavEnv) {
  const credits = int(env.AIRNAV_CREDITS, AIRNAV_DEFAULTS.credits)
  return {
    credits,
    // The lifetime cap can never be set above what the account holds.
    total: Math.min(credits, int(env.AIRNAV_TOTAL_CAP, AIRNAV_DEFAULTS.totalCap)),
    daily: int(env.AIRNAV_DAILY_CAP, AIRNAV_DEFAULTS.dailyCap),
  }
}

// ---------------------------------------------------------------------------
// Wire format and parsing (pure)
// ---------------------------------------------------------------------------

/** One flight in a `FlightsResponse` (the fields read here; the API sends about a hundred more). */
export type AirnavFlight = {
  callsign?: string | null
  flightNumberIcao?: string | null
  flightNumberIata?: string | null
  aircraftModeS?: string | null
  aircraftRegistration?: string | null
  aircraftType?: string | null
  aircraftTypeDescription?: string | null
  airlineName?: string | null
  depAirportIata?: string | null
  depAirportIcao?: string | null
  depAirportName?: string | null
  depAirportCity?: string | null
  depAirportLatitude?: number | null
  depAirportLongitude?: number | null
  arrAirportIata?: string | null
  arrAirportIcao?: string | null
  arrAirportName?: string | null
  arrAirportCity?: string | null
  arrAirportLatitude?: number | null
  arrAirportLongitude?: number | null
}

export type AirnavFlightsResponse = { success?: boolean; comment?: string | null; cost?: number | null; flights?: AirnavFlight[] | null; totalRecords?: number | null }

export type AirnavDetails = { route: Route | null; airframe: Airframe | null }

/** The body of the one request: by transponder address when known (one aircraft, so one result), else by callsign. */
export function airnavQuery(hex: string | null, callsign: string | null): { modeSHexCodes: string[] } | { flightIds: string[] } | null {
  if (hex) return { modeSHexCodes: [hex.toUpperCase()] }
  if (callsign) return { flightIds: [callsign.toUpperCase()] }
  return null
}

const clean = (v: string | null | undefined) => {
  const t = (v ?? '').trim()
  return t ? t : null
}

function airport(f: AirnavFlight, side: 'dep' | 'arr'): RouteAirport | null {
  const iata = clean(f[`${side}AirportIata`])
  const icao = clean(f[`${side}AirportIcao`])
  if (!iata && !icao) return null
  const lat = f[`${side}AirportLatitude`]
  const lon = f[`${side}AirportLongitude`]
  return { iata, icao, name: clean(f[`${side}AirportName`]), city: clean(f[`${side}AirportCity`]), lat: typeof lat === 'number' ? lat : null, lon: typeof lon === 'number' ? lon : null }
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.replace(/\s/g, '').toUpperCase() === b.replace(/\s/g, '').toUpperCase()

/** Pick the flight asked about from the answer and keep what the app shows. Pure; unit-tested. */
export function parseAirnavFlights(body: AirnavFlightsResponse | null | undefined, hex: string | null, callsign: string | null): AirnavDetails {
  const flights = Array.isArray(body?.flights) ? body.flights.filter((f) => f && typeof f === 'object') : []
  // The same aircraft can come back more than once (the leg in the air and the next one scheduled): prefer the leg with our callsign.
  const mine = hex ? flights.filter((f) => same(f.aircraftModeS, hex)) : flights.filter((f) => same(f.callsign, callsign) || same(f.flightNumberIcao, callsign))
  const f = mine.find((x) => same(x.callsign, callsign) || same(x.flightNumberIcao, callsign)) ?? mine[0]
  if (!f) return { route: null, airframe: null }
  const origin = airport(f, 'dep')
  const destination = airport(f, 'arr')
  const registration = clean(f.aircraftRegistration)
  // "Airbus A319-112" reads better than the designator; the designator is the fallback.
  const typeName = clean(f.aircraftTypeDescription) ?? clean(f.aircraftType)
  return {
    // Half a route would be shown as "to nowhere"; a route also has to be for this callsign when one was asked about.
    route: origin && destination && (!callsign || !clean(f.callsign) || same(f.callsign, callsign) || same(f.flightNumberIcao, callsign)) ? { airline: clean(f.airlineName), origin, destination } : null,
    airframe: registration || typeName ? { registration, typeName, manufacturer: null, owner: null } : null,
  }
}

/** What the free sources left unknown. */
export function flightGaps(info: FlightInfo): { route: boolean; airframe: boolean } {
  return { route: !info.origin && !info.destination, airframe: !info.registration && !info.typeName }
}

/** Fill only what was missing; what the free sources did know is never overwritten. Pure. */
export function fillGaps<T extends FlightInfo & { sources?: string[] }>(info: T, d: AirnavDetails): T & { sources: string[] } {
  const gaps = flightGaps(info)
  const out = { ...info, sources: [...(info.sources ?? [])] }
  let used = false
  if (gaps.route && d.route) {
    out.origin = d.route.origin
    out.destination = d.route.destination
    if (!out.airline) out.airline = d.route.airline
    used = true
  }
  if (gaps.airframe && d.airframe) {
    out.registration = d.airframe.registration
    out.typeName = d.airframe.typeName
    used = true
  }
  if (used && !out.sources.includes('airnav')) out.sources.push('airnav')
  return out
}

// ---------------------------------------------------------------------------
// The guarded lookup
// ---------------------------------------------------------------------------

/**
 * This isolate's own tally, checked and raised without an `await` in
 * between, so two requests arriving together cannot both take the last
 * credit even before the shared store has heard of either.
 */
export type AirnavGuard = { day: string; today: number; asked: number; total: number; inFlight: Set<string> }
export const createGuard = (): AirnavGuard => ({ day: '', today: 0, asked: 0, total: 0, inFlight: new Set() })
const isolateGuard = createGuard()

export type AirnavDeps = {
  counters: Counters
  /** Remembered answers and the "stop asking" flag. */
  store: JsonStore
  fetch?: typeof fetch
  now?: number
  guard?: AirnavGuard
}

/** Why AirNav was or was not asked (returned for tests and logs; nothing here is shown to visitors). */
export type AirnavReason = 'asked' | 'remembered' | 'no-token' | 'no-gap' | 'no-id' | 'daily-cap' | 'total-cap' | 'blocked' | 'busy' | 'failed'

type CachedPart<T> = { v: T | null }

const routeKey = (hex: string | null, callsign: string | null) => `airnav:rt:${callsign ?? ''}:${hex ?? ''}`
const frameKey = (hex: string) => `airnav:ac:${hex}`

/**
 * Fill a flight's missing route or airframe from AirNav, spending at most
 * one request. Never throws; when anything says no, `info` comes back as it was.
 */
export async function airnavFill<T extends FlightInfo & { sources?: string[] }>(info: T, hex: string | null, callsign: string | null, env: AirnavEnv, deps: AirnavDeps): Promise<{ info: T; reason: AirnavReason }> {
  const token = env.AIRNAV_ODAPI_TOKEN?.trim()
  if (!token) return { info, reason: 'no-token' }
  // An airframe can only be remembered by its transponder address, so without one only the route is looked for.
  const gaps = { route: flightGaps(info).route, airframe: flightGaps(info).airframe && !!hex }
  if (!gaps.route && !gaps.airframe) return { info, reason: 'no-gap' }
  const query = airnavQuery(hex, callsign)
  if (!query) return { info, reason: 'no-id' }

  const { counters, store } = deps
  const now = deps.now ?? Date.now()
  const guard = deps.guard ?? isolateGuard
  const rk = routeKey(hex, callsign)
  const fk = hex ? frameKey(hex) : null

  // Anything already paid for (or already known to be missing) is not asked again.
  const [cachedRoute, cachedFrame] = await Promise.all([gaps.route ? store.get<CachedPart<Route>>(rk) : undefined, gaps.airframe && fk ? store.get<CachedPart<Airframe>>(fk) : undefined])
  const routeKnown = !gaps.route || cachedRoute !== undefined
  const frameKnown = !gaps.airframe || cachedFrame !== undefined
  if (routeKnown && frameKnown) return { info: fillGaps(info, { route: cachedRoute?.v ?? null, airframe: cachedFrame?.v ?? null }), reason: 'remembered' }

  if (guard.inFlight.has(rk)) return { info, reason: 'busy' }
  if (await store.get(KEY.blocked)) return { info, reason: 'blocked' }

  const caps = airnavCaps(env)
  const day = dayKey(now)
  const [sharedTotal, sharedToday, sharedAsked, lastCost] = await Promise.all([counters.get(KEY.total), counters.get(KEY.day(day)), counters.get(KEY.asked(day)), store.get<number>(KEY.cost)])
  const expected = Math.max(1, typeof lastCost === 'number' && Number.isFinite(lastCost) ? Math.ceil(lastCost) : 1)

  // From here to the reservation there is no `await`: check and take the credits in one step.
  if (guard.day !== day) {
    guard.day = day
    guard.today = 0
    guard.asked = 0
  }
  const total = Math.max(sharedTotal, guard.total)
  const today = Math.max(sharedToday, guard.today)
  const asked = Math.max(sharedAsked, guard.asked)
  if (guard.inFlight.has(rk)) return { info, reason: 'busy' }
  if (total + expected > caps.total) return { info, reason: 'total-cap' }
  if (today + expected > caps.daily || asked + 1 > requestsPerDay(caps.daily)) return { info, reason: 'daily-cap' }
  guard.total = total + expected
  guard.today = today + expected
  guard.asked = asked + 1
  guard.inFlight.add(rk)

  const writeCounts = () => Promise.all([counters.set(KEY.total, guard.total, FOREVER_S), counters.set(KEY.day(day), guard.today, DAY_TTL_S), counters.set(KEY.asked(day), guard.asked, DAY_TTL_S)])
  // A request that fails is not tried again for this flight for a while (and is never retried here).
  const rememberFailure = () => Promise.all([store.put(rk, { v: null }, AIRNAV_TTL_S.failed), fk ? store.put(fk, { v: null }, AIRNAV_TTL_S.failed) : Promise.resolve()])

  try {
    // Written before the request goes out. A request that gets no answer still counts (it may have been charged).
    await writeCounts()

    let res: Response
    try {
      res = await (deps.fetch ?? fetch)(`${AIRNAV_BASE}/flights/live`, {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(query),
      })
    } catch {
      await rememberFailure()
      return { info, reason: 'failed' }
    }
    if (res.status === 401 || res.status === 402 || res.status === 403 || res.status === 429) {
      // Wrong token, no credit left, or told to slow down: stop asking for a while rather than find out again per flight.
      await Promise.all([store.put(KEY.blocked, { status: res.status, at: now }, res.status === 429 ? BLOCK_S.rate : BLOCK_S.auth), rememberFailure()])
      return { info, reason: 'failed' }
    }
    const body = res.ok ? ((await res.json().catch(() => null)) as AirnavFlightsResponse | null) : null

    // The answer says what it cost: count exactly that (more or less than was set aside), and remember it for next time.
    const cost = body && typeof body.cost === 'number' && Number.isFinite(body.cost) && body.cost >= 0 ? Math.ceil(body.cost) : null
    if (cost != null && cost !== expected) {
      guard.total = Math.max(0, guard.total + cost - expected)
      guard.today = Math.max(0, guard.today + cost - expected)
      await writeCounts()
    }
    if (cost != null && cost > 0) await store.put(KEY.cost, cost, FOREVER_S)

    if (!body || body.success === false) {
      // The service says no with HTTP 200 and a comment. Whatever the reason, stop asking for a while:
      // a day when it is about the token or the account, an hour otherwise.
      const comment = typeof body?.comment === 'string' ? body.comment : ''
      await Promise.all([store.put(KEY.blocked, { status: res.status, comment: comment.slice(0, 200), at: now }, ACCOUNT_TROUBLE.test(comment) ? BLOCK_S.auth : BLOCK_S.rate), rememberFailure()])
      return { info, reason: 'failed' }
    }

    const details = parseAirnavFlights(body, hex, callsign)
    await Promise.all([
      store.put(rk, { v: details.route }, details.route ? AIRNAV_TTL_S.route : AIRNAV_TTL_S.nothing),
      fk ? store.put(fk, { v: details.airframe }, details.airframe ? AIRNAV_TTL_S.airframe : AIRNAV_TTL_S.nothing) : Promise.resolve(),
    ])
    return { info: fillGaps(info, details), reason: 'asked' }
  } finally {
    guard.inFlight.delete(rk)
  }
}

/** Credits used so far, for Settings and `/api/health`. Reads our own tally; never asks AirNav. */
export type AirnavUsage = {
  configured: boolean
  /** Credits spent, ever and today: what each answer said it cost, plus one for any request that got no answer. */
  used: number
  today: number
  /** Credits on the account, and the caps that stop spending before they run out. */
  credits: number
  cap: number
  dailyCap: number
  storage: StorageKind
}

export async function airnavUsage(env: AirnavEnv, counters: Counters, now = Date.now()): Promise<AirnavUsage> {
  const caps = airnavCaps(env)
  const [used, today] = await Promise.all([counters.get(KEY.total), counters.get(KEY.day(dayKey(now)))])
  return { configured: !!env.AIRNAV_ODAPI_TOKEN?.trim(), used, today, credits: caps.credits, cap: caps.total, dailyCap: caps.daily, storage: counters.kind }
}
