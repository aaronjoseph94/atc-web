/**
 * Server-side aircraft fetching, shared by the Cloudflare Pages Function
 * (`functions/api/aircraft.ts`) and the Vite dev middleware.
 *
 * Free ADS-B providers are tried in order until one succeeds; a slow provider
 * is hedged with the next one. OpenSky is last because it rejects requests
 * from Cloudflare's egress (HTTP 522).
 */
import { getAirport, type AirportConfig } from './airports'
import {
  normalizeOpenSkyStates,
  normalizeReadsb,
  type OpenSkyState,
  type ReadsbAircraft,
} from './normalizeAircraft'
import type { Aircraft } from './types'

/** Per-provider timeout; keeps the whole request well under the client poll interval. */
const PROVIDER_TIMEOUT_MS = 6000

export const USER_AGENT = 'atc-web/0.2 (+https://github.com/aaronjoseph94/atc-web)'

export type AircraftProvider = {
  name: string
  fetch: (airport: AirportConfig, signal: AbortSignal) => Promise<Aircraft[]>
}

export type AircraftResult = {
  aircraft: Aircraft[]
  /** Name of the provider that answered. */
  provider: string
}

/** GET JSON from an upstream API with our identifying User-Agent. */
export async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    signal,
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

/** adsb.lol — open, no key, readsb JSON, point + radius (nm). */
export const adsbLol: AircraftProvider = {
  name: 'adsb.lol',
  async fetch(apt, signal) {
    const [lon, lat] = apt.center
    const data = await getJson<{ ac?: ReadsbAircraft[] }>(
      `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${apt.radiusNm}`,
      signal,
    )
    return normalizeReadsb(data.ac)
  },
}

/**
 * adsb.fi — community feed, same readsb shape (1 req/s limit). The area query
 * lives under `/v3/`; the old `/v2/lat/…` path is deprecated upstream.
 */
export const adsbFi: AircraftProvider = {
  name: 'adsb.fi',
  async fetch(apt, signal) {
    const [lon, lat] = apt.center
    const data = await getJson<{ ac?: ReadsbAircraft[] }>(
      `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${apt.radiusNm}`,
      signal,
    )
    return normalizeReadsb(data.ac)
  },
}

/** OpenSky Network — anonymous bbox query (works locally, blocked from Cloudflare). */
export const openSky: AircraftProvider = {
  name: 'opensky',
  async fetch(apt, signal) {
    const b = apt.bbox
    const data = await getJson<{ states?: OpenSkyState[] | null }>(
      `https://opensky-network.org/api/states/all?lamin=${b.lamin}&lomin=${b.lomin}&lamax=${b.lamax}&lomax=${b.lomax}`,
      signal,
    )
    return normalizeOpenSkyStates(data.states)
  },
}

export const DEFAULT_PROVIDERS: AircraftProvider[] = [adsbLol, adsbFi, openSky]

/**
 * How long a provider gets before the next one is started alongside it. A
 * healthy feed answers in a few hundred ms, so this only costs an extra
 * upstream request when the preferred feed is having a bad moment.
 */
const HEDGE_MS = 1500

/**
 * Fetch aircraft near an airport.
 *
 * Providers are tried in order, but a slow one doesn't hold the request
 * hostage: after `hedgeMs` (or immediately on failure) the next provider is
 * started too, and the first success wins. Throws only when every provider
 * fails; the error message lists each cause in provider order.
 */
export async function fetchAircraftForAirport(
  icao: string,
  providers: AircraftProvider[] = DEFAULT_PROVIDERS,
  hedgeMs = HEDGE_MS,
): Promise<AircraftResult> {
  const airport = getAirport(icao)
  const failures: (string | undefined)[] = providers.map(() => undefined)
  const controllers: AbortController[] = []

  return new Promise<AircraftResult>((resolve, reject) => {
    let next = 0
    let pending = 0
    let done = false
    let hedge: ReturnType<typeof setTimeout> | null = null
    const cancelHedge = () => {
      if (hedge != null) clearTimeout(hedge)
      hedge = null
    }

    const finish = (result?: AircraftResult) => {
      if (done) return
      done = true
      cancelHedge()
      // Stop whichever requests lost the race.
      for (const c of controllers) c.abort()
      if (result) resolve(result)
      else reject(new Error(`All providers failed — ${failures.filter(Boolean).join('; ')}`))
    }

    const launch = () => {
      cancelHedge()
      if (done || next >= providers.length) return
      const i = next++
      const p = providers[i]
      const ctrl = new AbortController()
      controllers.push(ctrl)
      const signal = AbortSignal.any([ctrl.signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)])
      pending++
      if (next < providers.length) hedge = setTimeout(launch, hedgeMs)

      p.fetch(airport, signal).then(
        (aircraft) => finish({ aircraft, provider: p.name }),
        (err: unknown) => {
          failures[i] = `${p.name}: ${err instanceof Error ? err.message : String(err)}`
          pending--
          if (next < providers.length) launch()
          else if (pending === 0) finish()
        },
      )
    }

    if (providers.length === 0) finish()
    else launch()
  })
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
