/**
 * GET /api/flight?hex=a09cad&callsign=AAL834
 *
 * Scheduled route, airframe details and a credited photo for one flight.
 * These barely change, so answers are cached at the edge for hours, which
 * also keeps us a polite client of the free community databases behind it.
 */
import { jsonResponse } from '../../src/api/aircraftHandler'
import { fetchFlightInfo, parseFlightQuery } from '../../src/api/flightInfoHandler'

const EDGE_TTL_S = 6 * 3600

export const onRequestGet: PagesFunction = async ({ request, waitUntil }) => {
  const url = new URL(request.url)
  const q = parseFlightQuery(url.searchParams.get('hex'), url.searchParams.get('callsign'))
  if (!q.hex && !q.callsign) return jsonResponse({ error: 'hex or callsign required' }, 400, 'no-store')

  const cacheKey = new Request(`${url.origin}/api/flight?hex=${q.hex ?? ''}&callsign=${q.callsign ?? ''}`, { method: 'GET' })
  const cache = caches.default
  const hit = await cache.match(cacheKey)
  if (hit) return hit

  const info = await fetchFlightInfo(q.hex, q.callsign)
  const known = info.origin || info.destination || info.typeName || info.photo
  // Unknown flights are retried sooner: the databases fill in over time.
  const res = jsonResponse(info, 200, `public, max-age=${known ? EDGE_TTL_S : 600}`)
  waitUntil(cache.put(cacheKey, res.clone()))
  return res
}
