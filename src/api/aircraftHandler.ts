/**
 * Server-side aircraft fetching, shared by the Cloudflare Pages Function
 * (`functions/api/aircraft.ts`) and the Vite dev middleware.
 *
 * Several free, key-less ADS-B feeds give the same normalized output:
 *  - adsb.fi open data (readsb JSON, 1 req/s, cite + link required)
 *  - adsb.lol (readsb JSON, ODbL 1.0, dynamic rate limit)
 *  - airplanes.live (readsb JSON, 1 req/s, non-commercial) — off unless the
 *    owner has their permission: the API now answers "contact us" to
 *    unknown projects, see docs/data-sources.md
 *  - OpenSky Network (anonymous: 400 credits a day, 10 s resolution) as the
 *    last resort only, so its small daily allowance is there when the
 *    community feeds are all down
 *
 * The healthiest two feeds are asked at once and their answers merged
 * (freshest position per aircraft), a slow or failing feed is hedged with the
 * next one, and a per-source circuit breaker skips a feed that keeps failing.
 * Which feeds answered travels with the response so the UI can credit them.
 */
import { getAirport, type AirportConfig } from './airports'
import {
  mergeAircraft,
  normalizeOpenSkyStates,
  normalizeReadsb,
  stripTiming,
  type OpenSkyState,
  type ReadsbAircraft,
  type TimedAircraft,
} from './normalizeAircraft'
import { errorText, sourceHealth, UpstreamError, type JsonCache, type SourceHealth } from './sourceHealth'
import type { Aircraft } from './types'

/** Per-provider timeout; keeps the whole request well under the client poll interval. */
const PROVIDER_TIMEOUT_MS = 6000

export const USER_AGENT = 'atc-web/0.2 (+https://github.com/aaronjoseph94/atc-web)'

export type AircraftProvider = {
  name: string
  /** Credit line and link the feed asks for. */
  credit?: { label: string; url: string }
  /**
   * Only used when every other feed has failed (never to double-check an
   * empty sky, never as a hedge), because its allowance is small.
   */
  lastResort?: boolean
  /**
   * The feed's per-IP request spacing. A feed called more recently than this
   * (by this isolate) sits the round out instead of earning a 429.
   */
  minIntervalMs?: number
  fetch: (airport: AirportConfig, signal: AbortSignal) => Promise<TimedAircraft[]>
}

export type AircraftResult = {
  aircraft: Aircraft[]
  /** Feed(s) that answered, e.g. `adsb.fi` or `adsb.fi + adsb.lol`. */
  provider: string
  /** Every feed whose data is in `aircraft`, healthiest first. */
  sources: string[]
  /** Credit lines for `sources`, ready to show. */
  credits: { label: string; url: string }[]
  /** Feeds tried that failed this time, `name: reason`. */
  failures: string[]
}

/** GET JSON from an upstream API with our identifying User-Agent. */
export async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    signal,
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  })
  if (!res.ok) throw new UpstreamError(`HTTP ${res.status}`, res.status)
  return (await res.json()) as T
}

/** GET plain text (NOAA's file server) with the same conventions as `getJson`. */
export async function getText(url: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(url, { signal, headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new UpstreamError(`HTTP ${res.status}`, res.status)
  return res.text()
}

type ReadsbPayload = { ac?: ReadsbAircraft[]; now?: number; error?: string }

/** Shared fetch for the three readsb-compatible feeds. */
async function readsb(url: string, signal: AbortSignal): Promise<TimedAircraft[]> {
  const data = await getJson<ReadsbPayload>(url, signal)
  // airplanes.live answers 200 with `{ error }` in some refusal cases.
  if (!Array.isArray(data.ac) && data.error) throw new UpstreamError(data.error.slice(0, 120), 403)
  // `now` is the aggregator's clock in ms; it dates `seen_pos` correctly even if ours drifts.
  return normalizeReadsb(data.ac, typeof data.now === 'number' && data.now > 1e12 ? data.now : Date.now())
}

/**
 * adsb.fi — community feed (1 req/s per IP). The area query lives under
 * `/v3/`; the old `/v2/lat/…` path is deprecated upstream.
 */
export const adsbFi: AircraftProvider = {
  name: 'adsb.fi',
  credit: { label: 'adsb.fi', url: 'https://adsb.fi' },
  minIntervalMs: 1100,
  fetch(apt, signal) {
    const [lon, lat] = apt.center
    return readsb(`https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${apt.radiusNm}`, signal)
  },
}

/** adsb.lol — open data under ODbL 1.0, no key (yet), point + radius in nm. */
export const adsbLol: AircraftProvider = {
  name: 'adsb.lol',
  credit: { label: 'adsb.lol (ODbL)', url: 'https://adsb.lol' },
  fetch(apt, signal) {
    const [lon, lat] = apt.center
    return readsb(`https://api.adsb.lol/v2/point/${lat}/${lon}/${apt.radiusNm}`, signal)
  },
}

/** airplanes.live — same readsb shape (1 req/s, non-commercial). Opt-in, see the file header. */
export const airplanesLive: AircraftProvider = {
  name: 'airplanes.live',
  credit: { label: 'airplanes.live', url: 'https://airplanes.live' },
  minIntervalMs: 1100,
  fetch(apt, signal) {
    const [lon, lat] = apt.center
    return readsb(`https://api.airplanes.live/v2/point/${lat}/${lon}/${apt.radiusNm}`, signal)
  },
}

/** OpenSky Network — anonymous bbox query, 1 credit per call for an airport-sized box. */
export const openSky: AircraftProvider = {
  name: 'opensky',
  credit: { label: 'The OpenSky Network', url: 'https://opensky-network.org' },
  lastResort: true,
  async fetch(apt, signal) {
    const b = apt.bbox
    const data = await getJson<{ time?: number; states?: OpenSkyState[] | null }>(
      `https://opensky-network.org/api/states/all?lamin=${b.lamin}&lomin=${b.lomin}&lamax=${b.lamax}&lomax=${b.lomax}`,
      signal,
    )
    return normalizeOpenSkyStates(data.states, data.time)
  },
}

/** Every feed the app knows, in preference order. */
export const ALL_PROVIDERS: AircraftProvider[] = [adsbFi, adsbLol, airplanesLive, openSky]

/** Settings read from the environment (Pages env bindings or `process.env` in dev). */
export type SourceEnv = {
  /** `1` once airplanes.live has agreed to this project using their API. */
  ATC_ENABLE_AIRPLANES_LIVE?: string
  /** Comma list of feed names to point at a dead URL, to rehearse failover. */
  ATC_FAIL_SOURCES?: string
}

/** The feeds in use for this environment (opt-ins added, rehearsal failures wired in). */
export function providersFor(env: SourceEnv = {}): AircraftProvider[] {
  const enabled = ALL_PROVIDERS.filter((p) => p !== airplanesLive || env.ATC_ENABLE_AIRPLANES_LIVE === '1')
  const broken = new Set((env.ATC_FAIL_SOURCES ?? '').split(',').map((s) => s.trim()).filter(Boolean))
  return enabled.map((p) => (broken.has(p.name) ? rehearsedFailure(p) : p))
}

/** The same feed, pointed at a host that never resolves. */
function rehearsedFailure(p: AircraftProvider): AircraftProvider {
  return { ...p, fetch: (_apt, signal) => readsb('https://invalid.invalid/rehearsed-failure', signal) }
}

export const DEFAULT_PROVIDERS: AircraftProvider[] = providersFor()

/**
 * How long a provider gets before the next one is started alongside it. A
 * healthy feed answers in a few hundred ms, so this only costs an extra
 * upstream request when the preferred feed is having a bad moment.
 */
const HEDGE_MS = 1500

/** After the first good answer, how long the second merge partner may still take. */
const MERGE_WAIT_MS = 700

export type FetchAircraftOptions = {
  providers?: AircraftProvider[]
  hedgeMs?: number
  /** Ask the two healthiest feeds at once and merge them (default on). */
  merge?: boolean
  mergeWaitMs?: number
  timeoutMs?: number
  health?: SourceHealth
}

/**
 * Fetch aircraft near an airport.
 *
 * Order comes from the circuit breaker (healthiest first, the configured order
 * breaks ties). The top two regular feeds start together when merging; a slow
 * feed doesn't hold the request hostage, because after `hedgeMs` (or at once on
 * failure) the next feed starts too. An empty answer is double-checked with
 * one more feed, since a quiet sky and a feed that lost its receivers look the
 * same. Last-resort feeds run only when every regular feed has errored.
 * Throws only when every feed fails; the message lists each cause.
 */
export async function fetchAircraftForAirport(icao: string, opts: FetchAircraftOptions = {}): Promise<AircraftResult> {
  const providers = opts.providers ?? DEFAULT_PROVIDERS
  const hedgeMs = opts.hedgeMs ?? HEDGE_MS
  const merge = opts.merge ?? true
  const mergeWaitMs = opts.mergeWaitMs ?? MERGE_WAIT_MS
  const timeoutMs = opts.timeoutMs ?? PROVIDER_TIMEOUT_MS
  const health = opts.health ?? sourceHealth
  const airport = getAirport(icao)

  // Feeds still inside their request spacing go to the back of the queue.
  const spaced = (p: AircraftProvider) => p.minIntervalMs != null && health.sinceLastAttempt(p.name) < p.minIntervalMs
  const healthOrder = health.order(providers)
  const ordered = [...healthOrder.filter((p) => !spaced(p)), ...healthOrder.filter(spaced)]
  const regular = ordered.filter((p) => !p.lastResort)
  const lastResort = ordered.filter((p) => p.lastResort)

  return new Promise<AircraftResult>((resolve, reject) => {
    const good: { source: AircraftProvider; aircraft: TimedAircraft[]; rank: number }[] = []
    const empty: AircraftProvider[] = []
    const failures: string[] = []
    const controllers: AbortController[] = []
    let nextRegular = 0
    let nextLast = 0
    let pending = 0
    let emptyChecks = 0
    let done = false
    let hedge: ReturnType<typeof setTimeout> | null = null
    let mergeTimer: ReturnType<typeof setTimeout> | null = null

    const clearTimers = () => {
      if (hedge != null) clearTimeout(hedge)
      if (mergeTimer != null) clearTimeout(mergeTimer)
      hedge = mergeTimer = null
    }

    const finish = () => {
      if (done) return
      done = true
      clearTimers()
      // Stop whichever requests lost the race.
      for (const c of controllers) c.abort()
      if (good.length) {
        good.sort((a, b) => a.rank - b.rank)
        const { aircraft } = mergeAircraft(good.map((g) => ({ source: g.source.name, aircraft: g.aircraft })))
        resolve(result(stripTiming(aircraft), good.map((g) => g.source), failures))
      } else if (empty.length) {
        resolve(result([], [empty[0]], failures))
      } else {
        reject(new Error(`All providers failed: ${failures.join('; ')}`))
      }
    }

    const launch = (p: AircraftProvider, rank: number) => {
      const ctrl = new AbortController()
      controllers.push(ctrl)
      pending++
      const t0 = Date.now()
      health.markAttempt(p.name)
      p.fetch(airport, AbortSignal.any([ctrl.signal, AbortSignal.timeout(timeoutMs)])).then(
        (aircraft) => {
          pending--
          if (done) return
          health.recordSuccess(p.name, Date.now() - t0, aircraft.length)
          if (aircraft.length) good.push({ source: p, aircraft, rank })
          else empty.push(p)
          evaluate()
        },
        (err: unknown) => {
          pending--
          if (done) return
          health.recordFailure(p.name, err)
          failures.push(`${p.name}: ${errorText(err)}`)
          // Fail fast: a broken feed is replaced at once rather than after the hedge.
          if (good.length === 0 && empty.length === 0) launchNextRegular()
          evaluate()
        },
      )
    }

    const launchNextRegular = () => {
      if (nextRegular >= regular.length) return false
      const i = nextRegular++
      launch(regular[i], i)
      armHedge()
      return true
    }

    const armHedge = () => {
      if (hedge != null) clearTimeout(hedge)
      hedge = null
      if (nextRegular < regular.length) {
        hedge = setTimeout(() => {
          hedge = null
          if (!done && good.length === 0) launchNextRegular()
        }, hedgeMs)
      }
    }

    const evaluate = () => {
      if (good.length) {
        if (!merge || pending === 0 || good.length >= 2) return finish()
        // One answer in, a merge partner still on its way: give it a moment.
        if (mergeTimer == null) mergeTimer = setTimeout(finish, mergeWaitMs)
        return
      }
      if (pending > 0) return
      const regularErrored = empty.length === 0
      if (regularErrored && launchNextRegular()) return
      if (!regularErrored && emptyChecks < 1) {
        emptyChecks++
        if (launchNextRegular()) return
      }
      // Every regular feed errored (none even said "empty"): spend a last-resort call.
      if (regularErrored && nextRegular >= regular.length && nextLast < lastResort.length) {
        const i = nextLast++
        launch(lastResort[i], regular.length + i)
        return
      }
      finish()
    }

    if (regular.length === 0 && lastResort.length === 0) return finish()
    if (regular.length === 0) {
      nextLast = 1
      launch(lastResort[0], 0)
      return
    }
    launchNextRegular()
    // Merging: the runner-up starts straight away instead of after the hedge.
    if (merge && regular[1] && !spaced(regular[1])) launchNextRegular()
  })
}

function result(aircraft: Aircraft[], used: AircraftProvider[], failures: string[]): AircraftResult {
  return {
    aircraft,
    provider: used.map((p) => p.name).join(' + '),
    sources: used.map((p) => p.name),
    credits: used.map((p) => p.credit ?? { label: p.name, url: '' }),
    failures,
  }
}

// ---------------------------------------------------------------------------
// HTTP layer shared by the Pages Function and the dev server
// ---------------------------------------------------------------------------

/** Fresh answers are shared for this long: shorter than the fastest client poll. */
export const AIRCRAFT_TTL_S = 4
/** The last good answer is kept this long to cover an outage of every feed. */
const STALE_TTL_S = 90

type CachedSnapshot = AircraftResult & { fetchedAt: number }

/** Concurrent requests for one airport share a single upstream round. */
const inflight = new Map<string, Promise<CachedSnapshot>>()

/**
 * Answer `GET /api/aircraft?airport=XXX`.
 *
 * The body stays a plain `Aircraft[]` (what the client already reads); which
 * feeds answered rides in headers: `X-Provider` (display name), `X-Sources`,
 * `X-Attribution` (credit lines), `X-Upstream-Error`. When every feed fails
 * the last good list (up to 90 s old) is served with `X-Stale` so the map
 * doesn't empty during a blip.
 */
export async function handleAircraftRequest(
  airport: string,
  cache: JsonCache,
  env: SourceEnv = {},
): Promise<Response> {
  const code = airport.toUpperCase().slice(0, 4)
  const freshKey = `aircraft:${code}`
  const staleKey = `aircraft-stale:${code}`

  const hit = await cache.get<CachedSnapshot>(freshKey)
  if (hit) return aircraftResponse(hit, AIRCRAFT_TTL_S)

  let job = inflight.get(code)
  if (!job) {
    job = fetchAircraftForAirport(code, { providers: providersFor(env) }).then((r) => ({ ...r, fetchedAt: Date.now() }))
    inflight.set(code, job)
    void job.catch(() => {}).finally(() => inflight.delete(code))
  }

  try {
    const snap = await job
    await Promise.all([cache.put(freshKey, snap, AIRCRAFT_TTL_S), cache.put(staleKey, snap, STALE_TTL_S)])
    return aircraftResponse(snap, AIRCRAFT_TTL_S)
  } catch (err) {
    const message = headerSafe(String(err instanceof Error ? err.message : err))
    const stale = await cache.get<CachedSnapshot>(staleKey)
    if (stale) {
      const res = aircraftResponse(stale, 2)
      res.headers.set('X-Stale', String(Math.round((Date.now() - stale.fetchedAt) / 1000)))
      res.headers.set('X-Upstream-Error', message)
      return res
    }
    // Degrade gracefully: empty list, short cache, error visible in a header.
    const res = jsonResponse([], 200, 'public, max-age=2')
    res.headers.set('X-Upstream-Error', message)
    return res
  }
}

function aircraftResponse(snap: CachedSnapshot, maxAge: number): Response {
  const res = jsonResponse(snap.aircraft, 200, `public, max-age=${maxAge}`)
  res.headers.set('X-Provider', snap.provider)
  res.headers.set('X-Sources', snap.sources.join(','))
  // Header values must be Latin-1; credit labels are plain ASCII.
  res.headers.set('X-Attribution', snap.credits.map((c) => `${c.label} <${c.url}>`).join(', '))
  if (snap.failures.length) res.headers.set('X-Source-Failures', headerSafe(snap.failures.join('; ')))
  res.headers.set('Access-Control-Expose-Headers', 'X-Provider, X-Sources, X-Attribution, X-Upstream-Error, X-Stale')
  return res
}

/** Header values must be Latin-1 and short; upstream error text is neither guaranteed. */
function headerSafe(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, '?').slice(0, 300)
}

/** JSON `Response` helper with permissive CORS (the API is public, read-only). */
export function jsonResponse(body: unknown, status = 200, cache = 'public, max-age=5') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cache,
      'Access-Control-Allow-Origin': '*',
    },
  })
}
