/**
 * GET /api/flight?hex=a09cad&callsign=AAL834
 *
 * Scheduled route, airframe details and a credited photo for one flight.
 * These barely change, so answers are cached at the edge for hours, which
 * also keeps us a polite client of the free community databases behind it.
 */
import { jsonResponse } from '../../src/api/aircraftHandler'
import { cacheApiJson } from '../../src/api/edgeCache'
import { parseFlightQuery } from '../../src/api/flightInfoHandler'
import { fetchFlightDetails, FLIGHT_TTL_S } from '../../src/api/flightSources'

const EDGE_TTL_S = 6 * 3600

export const onRequestGet: PagesFunction = async ({ request, waitUntil }) => {
  const url = new URL(request.url)
  const q = parseFlightQuery(url.searchParams.get('hex'), url.searchParams.get('callsign'))
  if (!q.hex && !q.callsign) return jsonResponse({ error: 'hex or callsign required' }, 400, 'no-store')

  const cacheKey = new Request(`${url.origin}/api/flight?hex=${q.hex ?? ''}&callsign=${q.callsign ?? ''}`, { method: 'GET' })
  const cache = caches.default
  const hit = await cache.match(cacheKey)
  if (hit) return hit

  // Sub-lookups (hexdb airframe/route, feed airframe) have their own edge cache entries and TTLs.
  const info = await fetchFlightDetails(q.hex, q.callsign, cacheApiJson(cache, url.origin, waitUntil))
  const known = info.origin || info.destination || info.typeName || info.photo
  // Routes change (flight numbers get re-used), airframes don't; unknown flights are retried sooner.
  const ttl = info.origin || info.destination ? FLIGHT_TTL_S.route : known ? EDGE_TTL_S : FLIGHT_TTL_S.unknown
  const res = jsonResponse(info, 200, `public, max-age=${ttl}`)
  waitUntil(cache.put(cacheKey, res.clone()))
  return res
}
