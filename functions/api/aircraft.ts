/**
 * GET /api/aircraft?airport=ORD
 *
 * Returns normalized aircraft near the airport. Responses are cached in the
 * Cloudflare edge cache for a few seconds so many clients polling the same
 * airport share a single upstream request (keeps us well inside the free
 * providers' rate limits).
 */
import { fetchAircraftForAirport, jsonResponse } from '../../src/api/aircraftHandler'

/** Edge cache TTL in seconds — shorter than the fastest client poll interval. */
const EDGE_TTL_S = 4

export const onRequestGet: PagesFunction = async ({ request, waitUntil }) => {
  const url = new URL(request.url)
  const airport = (url.searchParams.get('airport') ?? 'ORD').toUpperCase()

  // Normalized cache key: only the airport matters.
  const cacheKey = new Request(`${url.origin}/api/aircraft?airport=${airport}`, { method: 'GET' })
  const cache = caches.default
  const hit = await cache.match(cacheKey)
  if (hit) return hit

  try {
    const { aircraft, provider } = await fetchAircraftForAirport(airport)
    const res = jsonResponse(aircraft, 200, `public, max-age=${EDGE_TTL_S}`)
    res.headers.set('X-Provider', provider)
    waitUntil(cache.put(cacheKey, res.clone()))
    return res
  } catch (err) {
    // Degrade gracefully: empty list, short cache, error visible in a header.
    const res = jsonResponse([], 200, 'public, max-age=2')
    res.headers.set('X-Upstream-Error', String(err instanceof Error ? err.message : err).slice(0, 300))
    return res
  }
}
