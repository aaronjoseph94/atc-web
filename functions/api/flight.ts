/**
 * GET /api/flight?hex=a09cad&callsign=AAL834[&deep=1]
 *
 * Scheduled route and airframe details for one flight.
 * These barely change, so answers are cached at the edge for hours, which
 * also keeps us a polite client of the free community databases behind it.
 *
 * `deep=1` is sent only when someone opens a flight. If the free sources
 * know neither the route nor the airframe, and the owner has set an AirNav
 * token (AIRNAV_ODAPI_TOKEN), that one request may spend an AirNav credit to
 * fill the gap, within the daily and lifetime caps (see src/api/airnav.ts).
 */
import { jsonResponse } from '../../src/api/aircraftHandler'
import { isSameOrigin, originHeaders } from '../../src/api/ai/limits'
import { airnavFill, flightGaps, type AirnavEnv } from '../../src/api/airnav'
import { cacheApiJson } from '../../src/api/edgeCache'
import { parseFlightQuery } from '../../src/api/flightInfoHandler'
import { fetchFlightDetails, FLIGHT_TTL_S } from '../../src/api/flightSources'
import { durableStore, edgeStores, exactCounters } from '../../src/api/storage'
import type { FlightInfo } from '../../src/api/types'

const EDGE_TTL_S = 6 * 3600

type Env = AirnavEnv & { AI_KV?: KVNamespace }
type Details = FlightInfo & { sources: string[] }

export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const url = new URL(request.url)
  const q = parseFlightQuery(url.searchParams.get('hex'), url.searchParams.get('callsign'))
  if (!q.hex && !q.callsign) return jsonResponse({ error: 'hex or callsign required' }, 400, 'no-store')
  // Credits are only ever spent for a flight opened on this site's own pages.
  const deep = url.searchParams.get('deep') === '1' && !!env.AIRNAV_ODAPI_TOKEN?.trim() && isSameOrigin(url.origin, originHeaders((n) => request.headers.get(n)))

  const cacheKey = new Request(`${url.origin}/api/flight?hex=${q.hex ?? ''}&callsign=${q.callsign ?? ''}`, { method: 'GET' })
  const cache = caches.default
  const hit = await cache.match(cacheKey)
  if (hit && !deep) return hit

  // Sub-lookups (hexdb airframe/route, feed airframe) have their own edge cache entries and TTLs.
  let info: Details = hit ? ((await hit.clone().json()) as Details) : await fetchFlightDetails(q.hex, q.callsign, cacheApiJson(cache, url.origin, waitUntil))
  const gaps = flightGaps(info)
  if (deep && (gaps.route || gaps.airframe)) {
    const stores = edgeStores(env, cache, url.origin, waitUntil)
    const free = info
    const filled = await airnavFill(free, q.hex, q.callsign, env, { counters: exactCounters(stores), store: durableStore(stores) }).catch(() => ({ info: free }))
    // Nothing new: the cached answer (and its remaining lifetime) stands.
    const changed = filled.info.sources.includes('airnav') && !info.sources?.includes('airnav')
    if (!changed && hit) return hit
    if (changed) info = filled.info
  } else if (hit) return hit

  const known = info.origin || info.destination || info.typeName
  // Routes change (flight numbers get re-used), airframes don't; unknown flights are retried sooner.
  const ttl = info.origin || info.destination ? FLIGHT_TTL_S.route : known ? EDGE_TTL_S : FLIGHT_TTL_S.unknown
  const res = jsonResponse(info, 200, `public, max-age=${ttl}`)
  waitUntil(cache.put(cacheKey, res.clone()))
  return res
}
