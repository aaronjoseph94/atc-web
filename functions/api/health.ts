/**
 * GET /api/health?airport=ORD[&probe=all]
 *
 * Diagnostics for the Settings page: which feed(s) the map is getting traffic
 * from, latency, aircraft count, the Cloudflare colo that served the request,
 * and the status of every upstream source (ADS-B feeds, flight databases,
 * weather) so a dead source is visible even while failover hides it.
 */
import { jsonResponse, type SourceEnv } from '../../src/api/aircraftHandler'
import { cacheApiJson } from '../../src/api/edgeCache'
import { buildHealth } from '../../src/api/healthHandler'

export const onRequestGet: PagesFunction<SourceEnv> = async ({ request, env, waitUntil }) => {
  const url = new URL(request.url)
  const airport = (url.searchParams.get('airport') ?? 'ORD').toUpperCase().slice(0, 4)
  const colo = (request as Request & { cf?: { colo?: string } }).cf?.colo
  const health = await buildHealth(airport, 'cloudflare-pages', colo, {
    env,
    cache: cacheApiJson(caches.default, url.origin, waitUntil),
    probeAll: url.searchParams.get('probe') === 'all',
  })
  return jsonResponse(health, 200, 'no-store')
}
