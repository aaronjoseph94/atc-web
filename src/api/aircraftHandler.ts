/**
 * Server-side aircraft fetching, shared by the Cloudflare Pages Function
 * (`functions/api/aircraft.ts`) and the Vite dev middleware.
 *
 * Free ADS-B providers are tried in order until one succeeds. OpenSky is last
 * because it rejects requests from Cloudflare's egress (HTTP 522).
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

const USER_AGENT = 'atc-web/0.1 (+https://github.com/aaronjoseph94/atc-web)'

export type AircraftProvider = {
  name: string
  fetch: (airport: AirportConfig, signal: AbortSignal) => Promise<Aircraft[]>
}

export type AircraftResult = {
  aircraft: Aircraft[]
  /** Name of the provider that answered. */
  provider: string
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
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

/** adsb.fi — community feed, same readsb shape (1 req/s limit). */
export const adsbFi: AircraftProvider = {
  name: 'adsb.fi',
  async fetch(apt, signal) {
    const [lon, lat] = apt.center
    const data = await getJson<{ ac?: ReadsbAircraft[] }>(
      `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${apt.radiusNm}`,
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
 * Fetch aircraft near an airport, falling through providers on failure.
 * Throws only when every provider fails; the error message lists each cause.
 */
export async function fetchAircraftForAirport(
  icao: string,
  providers: AircraftProvider[] = DEFAULT_PROVIDERS,
): Promise<AircraftResult> {
  const airport = getAirport(icao)
  const failures: string[] = []

  for (const p of providers) {
    try {
      // Sequential on purpose: we only hit the next provider if this one fails.
      // oxlint-disable-next-line no-await-in-loop
      const aircraft = await p.fetch(airport, AbortSignal.timeout(PROVIDER_TIMEOUT_MS))
      return { aircraft, provider: p.name }
    } catch (err) {
      failures.push(`${p.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  throw new Error(`All providers failed — ${failures.join('; ')}`)
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
