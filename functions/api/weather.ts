/**
 * GET /api/weather?airport=ORD
 *
 * Current METAR (decoded), TAF and the digital ATIS text where the airport
 * publishes one. Observations change roughly hourly and ATIS a little more
 * often, so the merged result is cached at the edge for a few minutes, under
 * the airport's canonical code; codes this site does not serve answer 404.
 */
import { jsonResponse, unknownAirport } from '../../src/api/aircraftHandler'
import { knownAirport } from '../../src/api/airports'
import { fetchWeather } from '../../src/api/weatherHandler'

const EDGE_TTL_S = 180

export const onRequestGet: PagesFunction<{ ATC_FAIL_SOURCES?: string }> = async ({ request, env, waitUntil }) => {
  const url = new URL(request.url)
  const known = knownAirport(url.searchParams.get('airport') ?? 'ORD')
  if (!known) return unknownAirport()
  const airport = known.icao

  const cacheKey = new Request(`${url.origin}/api/weather?airport=${airport}`, { method: 'GET' })
  const cache = caches.default
  const hit = await cache.match(cacheKey)
  if (hit) return hit

  const weather = await fetchWeather(airport, env)
  // Don't pin an empty result for minutes if both sources were briefly down.
  const usable = weather.metar != null || weather.atis.length > 0
  const res = jsonResponse(weather, 200, usable ? `public, max-age=${EDGE_TTL_S}` : 'no-store')
  if (usable) waitUntil(cache.put(cacheKey, res.clone()))
  return res
}
