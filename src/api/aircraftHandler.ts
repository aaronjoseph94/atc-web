/**
 * Server-side aircraft fetching, shared by the Cloudflare Pages Function
 * (`functions/api/aircraft.ts`) and the Vite dev middleware.
 *
 * Several free ADS-B aggregators give the same normalized output. Each one
 * carries ADS-B, MLAT (multilateration of Mode S from several receivers),
 * TIS-B/ADS-R rebroadcasts and ADS-C positions, marked per aircraft:
 *  - adsb.fi open data (readsb JSON, 1 req/s, cite + link required)
 *  - adsb.lol (readsb JSON, ODbL 1.0, dynamic rate limit)
 *  - adsb.one (readsb JSON, 1 req/s)
 *  - airplanes.live (readsb JSON, 1 req/s, non-commercial): used with the
 *    owner's permission from airplanes.live; set ATC_ENABLE_AIRPLANES_LIVE=0
 *    to turn it off. See docs/data-sources.md
 *  - OpenSky Network as the last resort only. Anonymous it has 400 credits a
 *    day at 10 s resolution; with OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET
 *    (a free account's API client) it gets 4,000 credits and 5 s resolution.
 *
 * The healthiest two feeds are asked at once and their answers merged
 * (freshest position per aircraft), a slow or failing feed is hedged with the
 * next one, and a per-source circuit breaker skips a feed that keeps failing.
 * Which feeds answered travels with the response so the UI can credit them.
 */
import { getAirport, knownAirport, type AirportConfig } from './airports'
import {
  mergeAircraft,
  normalizeOpenSkyStates,
  normalizeReadsb,
  type OpenSkyState,
  type ReadsbAircraft,
  type TimedAircraft,
} from './normalizeAircraft'
import { errorText, PacedSkip, sourceHealth, UpstreamError, type JsonCache, type SourceHealth } from './sourceHealth'
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
export async function getJson<T>(url: string, signal: AbortSignal, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    signal,
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...headers },
  })
  if (!res.ok) throw new UpstreamError(`HTTP ${res.status}${await refusalDetail(res)}`, res.status)
  return (await res.json()) as T
}

/** A short plain-text snippet of a refusal, so /api/health can show why. HTML challenges are dropped. */
async function refusalDetail(res: Response): Promise<string> {
  try {
    const raw = (await res.text()).replace(/\s+/g, ' ').trim()
    if (!raw || raw.startsWith('<')) return ''
    return `: ${raw.slice(0, 100)}`
  } catch {
    return ''
  }
}

/** GET plain text (NOAA's file server) with the same conventions as `getJson`. */
export async function getText(url: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(url, { signal, headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new UpstreamError(`HTTP ${res.status}`, res.status)
  return res.text()
}

type ReadsbPayload = { ac?: ReadsbAircraft[]; now?: number; error?: string }

/** Shared fetch for the readsb-compatible feeds. */
async function readsb(url: string, signal: AbortSignal, headers?: Record<string, string>): Promise<TimedAircraft[]> {
  const data = await getJson<ReadsbPayload>(url, signal, headers)
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

/**
 * adsb.lol — ODbL 1.0. Without a key the whole site shares 500 requests a day
 * per egress IP (Cloudflare's), so the caller must pace it. `x-api-key` spends
 * the key's own quota instead.
 */
export function adsbLolProvider(apiKey?: string): AircraftProvider {
  const headers = apiKey ? { 'x-api-key': apiKey } : undefined
  return {
    name: 'adsb.lol',
    credit: { label: 'adsb.lol (ODbL)', url: 'https://adsb.lol' },
    fetch(apt, signal) {
      const [lon, lat] = apt.center
      return readsb(`https://api.adsb.lol/v2/point/${lat}/${lon}/${apt.radiusNm}`, signal, headers)
    },
  }
}

export const adsbLol: AircraftProvider = adsbLolProvider()

/** airplanes.live — same readsb shape (1 req/s, non-commercial). Used with their permission, see the file header. */
export const airplanesLive: AircraftProvider = {
  name: 'airplanes.live',
  credit: { label: 'airplanes.live', url: 'https://airplanes.live' },
  minIntervalMs: 1100,
  fetch(apt, signal) {
    const [lon, lat] = apt.center
    return readsb(`https://api.airplanes.live/v2/point/${lat}/${lon}/${apt.radiusNm}`, signal)
  },
}

/** adsb.one — readsb shape, free, 1 req/s. */
export const adsbOne: AircraftProvider = {
  name: 'adsb.one',
  credit: { label: 'adsb.one', url: 'https://adsb.one' },
  minIntervalMs: 1100,
  fetch(apt, signal) {
    const [lon, lat] = apt.center
    return readsb(`https://api.adsb.one/v2/point/${lat}/${lon}/${apt.radiusNm}`, signal)
  },
}

const OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'
/** One bearer token per isolate; refreshed a minute before it expires. */
let openSkyToken: { value: string; until: number } | null = null

/** OpenSky OAuth2 client-credentials token (an account's API client). */
async function openSkyBearer(id: string, secret: string, signal: AbortSignal): Promise<string> {
  if (openSkyToken && Date.now() < openSkyToken.until) return openSkyToken.value
  const res = await fetch(OPENSKY_TOKEN_URL, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
  })
  if (!res.ok) throw new UpstreamError(`token HTTP ${res.status}`, res.status)
  const tok = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!tok.access_token) throw new UpstreamError('token missing', 502)
  openSkyToken = { value: tok.access_token, until: Date.now() + Math.max(60, (tok.expires_in ?? 1800) - 60) * 1000 }
  return tok.access_token
}

/** OpenSky Network — bbox query, 1 credit per call for an airport-sized box; anonymous unless given an API client. */
export function openSkyProvider(auth?: { id: string; secret: string }): AircraftProvider {
  return {
    name: 'opensky',
    credit: { label: 'The OpenSky Network', url: 'https://opensky-network.org' },
    lastResort: true,
    async fetch(apt, signal) {
      const b = apt.bbox
      const url = `https://opensky-network.org/api/states/all?lamin=${b.lamin}&lomin=${b.lomin}&lamax=${b.lamax}&lomax=${b.lomax}`
      const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': USER_AGENT }
      if (auth) headers.Authorization = `Bearer ${await openSkyBearer(auth.id, auth.secret, signal)}`
      const res = await fetch(url, { signal, headers })
      if (!res.ok) throw new UpstreamError(`HTTP ${res.status}`, res.status)
      const data = (await res.json()) as { time?: number; states?: OpenSkyState[] | null }
      return normalizeOpenSkyStates(data.states, data.time)
    },
  }
}

export const openSky: AircraftProvider = openSkyProvider()

/** Every feed the app knows, in preference order. */
export const ALL_PROVIDERS: AircraftProvider[] = [adsbFi, adsbLol, adsbOne, airplanesLive, openSky]

/** Settings read from the environment (Pages env bindings or `process.env` in dev). */
export type SourceEnv = {
  /** `0` turns airplanes.live off (the owner has their permission, so it is on by default). */
  ATC_ENABLE_AIRPLANES_LIVE?: string
  /** Comma list of feed names to point at a dead URL, to rehearse failover. */
  ATC_FAIL_SOURCES?: string
  /** OpenSky API client (free account): 4,000 credits a day instead of 400. */
  OPENSKY_CLIENT_ID?: string
  OPENSKY_CLIENT_SECRET?: string
  /**
   * adsb.lol key (`x-api-key`). Without it the site shares 500 requests a day
   * on Cloudflare's egress IP; a feeder key is what makes live refresh possible.
   */
  ADSBLOL_API_KEY?: string
}

/** The feeds in use for this environment (opt-ins added, credentials applied, rehearsal failures wired in). */
export function providersFor(env: SourceEnv = {}): AircraftProvider[] {
  const lol = adsbLolProvider(env.ADSBLOL_API_KEY)
  const enabled = ALL_PROVIDERS.filter((p) => p !== airplanesLive || env.ATC_ENABLE_AIRPLANES_LIVE !== '0').map((p) => {
    if (p === adsbLol) return lol
    if (p === openSky && env.OPENSKY_CLIENT_ID && env.OPENSKY_CLIENT_SECRET) return openSkyProvider({ id: env.OPENSKY_CLIENT_ID, secret: env.OPENSKY_CLIENT_SECRET })
    return p
  })
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
        resolve(result(aircraft, good.map((g) => g.source), failures))
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
/**
 * adsb.lol with no key allows 500 requests a day per IP, and every visitor
 * shares Cloudflare's egress address. One call every few minutes stays under
 * that; a key spends its own quota and can be asked more often.
 */
const LOL_GAP_NO_KEY_S = 170
const LOL_GAP_KEY_S = 12
/** adsb.fi allows 1 request/s per IP. Two seconds leaves room for a second airport. */
const FI_GAP_S = 2
/** A 403 is usually a ban; hammering it extends the ban. Stay away for half an hour. */
const PAUSE_403_S = 30 * 60
/** Unkeyed adsb.lol 429 means the daily quota is gone. Don't spend the rest of it on retries. */
const PAUSE_429_LOL_S = 15 * 60
const PAUSE_429_S = 60
/** OpenSky from this network tends to hang. One timeout is enough for a while. */
const PAUSE_OPENSKY_S = 10 * 60
/** The last good answer is kept this long to cover an outage of every feed. */
const STALE_TTL_S = 15 * 60

const pauseKey = (name: string) => `feed-pause:${name}`
const slotKey = (name: string) => `feed-slot:${name}`

/**
 * How long this feed must wait before another colo-wide request.
 * `0` means no shared gap (the in-isolate breaker is enough).
 */
function slotSeconds(name: string, env: SourceEnv): number {
  if (name === 'adsb.fi') return FI_GAP_S
  if (name === 'adsb.lol') return env.ADSBLOL_API_KEY ? LOL_GAP_KEY_S : LOL_GAP_NO_KEY_S
  return 0
}

async function claimSlot(cache: JsonCache, name: string, ttl: number): Promise<boolean> {
  const key = slotKey(name)
  if (await cache.get(key)) return false
  await cache.put(key, 1, ttl)
  return true
}

/** Remember a refusal so every isolate in this colo stops asking until it expires. */
async function notePause(cache: JsonCache, name: string, err: unknown, env: SourceEnv) {
  const status = err instanceof UpstreamError ? err.status : null
  const reason = errorText(err)
  let ttl = 0
  if (status === 403) ttl = PAUSE_403_S
  else if (status === 429) ttl = name === 'adsb.lol' && !env.ADSBLOL_API_KEY ? PAUSE_429_LOL_S : PAUSE_429_S
  else if (name === 'opensky' && reason === 'timed out') ttl = PAUSE_OPENSKY_S
  if (ttl) await cache.put(pauseKey(name), { reason }, ttl)
}

/**
 * `null` when the feed may be asked. A string when it is paused (the reason).
 * `''` when a shared gap is still open: use the last result, don't treat it as a failure.
 */
export async function feedBlock(cache: JsonCache, name: string): Promise<string | null> {
  const pause = await cache.get<{ reason?: string }>(pauseKey(name))
  if (pause?.reason) return pause.reason
  if ((await cache.get(slotKey(name))) != null) return ''
  return null
}

/**
 * Share one pause and one request gap per feed across every isolate in the colo.
 * A paused or gapped feed throws `PacedSkip` (not a failure) instead of calling out.
 */
export function withFeedGuards(providers: AircraftProvider[], cache: JsonCache, env: SourceEnv = {}): AircraftProvider[] {
  return providers.map((p) => ({
    ...p,
    async fetch(apt, signal) {
      const block = await feedBlock(cache, p.name)
      if (block != null) throw new PacedSkip(block || `${p.name} is within its request gap`)
      const gap = slotSeconds(p.name, env)
      if (gap && !(await claimSlot(cache, p.name, gap))) throw new PacedSkip(`${p.name} is within its request gap`)
      try {
        return await p.fetch(apt, signal)
      } catch (err) {
        await notePause(cache, p.name, err, env)
        throw err
      }
    },
  }))
}

function freshTtl(sources: string[], env: SourceEnv): number {
  if (sources.includes('adsb.fi')) return AIRCRAFT_TTL_S
  if (sources.includes('adsb.lol')) return env.ADSBLOL_API_KEY ? LOL_GAP_KEY_S : LOL_GAP_NO_KEY_S
  return AIRCRAFT_TTL_S
}

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
 * doesn't empty during a blip. With no adsb.lol key the fresh window is a few
 * minutes, because that feed allows 500 requests a day for the whole site.
 */
export async function handleAircraftRequest(
  airport: string,
  cache: JsonCache,
  env: SourceEnv = {},
): Promise<Response> {
  const known = knownAirport(airport)
  if (!known) return unknownAirport()
  // The canonical code, so every spelling of one airport shares one cache entry and one upstream round.
  const code = known.icao
  const freshKey = `aircraft:${code}`
  const staleKey = `aircraft-stale:${code}`

  const hit = await cache.get<CachedSnapshot>(freshKey)
  if (hit) return aircraftResponse(hit, freshTtl(hit.sources, env))

  let job = inflight.get(code)
  if (!job) {
    // Without a key, don't spend adsb.lol on a merge while adsb.fi might still answer.
    job = fetchAircraftForAirport(code, {
      providers: withFeedGuards(providersFor(env), cache, env),
      merge: Boolean(env.ADSBLOL_API_KEY),
    }).then((r) => ({ ...r, fetchedAt: Date.now() }))
    inflight.set(code, job)
    void job.catch(() => {}).finally(() => inflight.delete(code))
  }

  try {
    const snap = await job
    const ttl = freshTtl(snap.sources, env)
    await Promise.all([cache.put(freshKey, snap, ttl), cache.put(staleKey, snap, STALE_TTL_S)])
    return aircraftResponse(snap, ttl)
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

/** The answer for an airport code this site does not serve (cached briefly: the list only changes with a deploy). */
export function unknownAirport(): Response {
  return jsonResponse({ error: 'unknown airport', code: 'unknown_airport' }, 404, 'public, max-age=300')
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
