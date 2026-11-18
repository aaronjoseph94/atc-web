/**
 * GET /api/aircraft?airport=ORD
 *
 * Returns normalized aircraft near the airport, merged from the healthiest
 * free ADS-B feeds (see `src/api/aircraftHandler.ts`). Answers are kept in the
 * Cloudflare edge cache for a few seconds so every client polling the same
 * airport shares one upstream round, which keeps us well inside the feeds'
 * rate limits; the last good answer is kept a little longer to ride out an
 * outage of every feed. Codes this site does not serve answer 404
 * (`code: "unknown_airport"`); known ones are cached under their canonical code.
 */
import { handleAircraftRequest, type SourceEnv } from '../../src/api/aircraftHandler'
import { cacheApiJson } from '../../src/api/edgeCache'

export const onRequestGet: PagesFunction<SourceEnv> = async ({ request, env, waitUntil }) => {
  const url = new URL(request.url)
  const cache = cacheApiJson(caches.default, url.origin, waitUntil)
  return handleAircraftRequest(url.searchParams.get('airport') ?? 'ORD', cache, env)
}
