/**
 * GET /api/health?airport=ORD[&probe=all]
 *
 * Diagnostics for the Settings page: which feed(s) the map is getting traffic
 * from, latency, aircraft count, the Cloudflare colo that served the request,
 * and the status of every upstream source (ADS-B feeds, flight databases,
 * weather) so a dead source is visible even while failover hides it. Also
 * reports how many AirNav credits have been used, from our own count: AirNav
 * itself is never called from here.
 */
import { jsonResponse, type SourceEnv } from '../../src/api/aircraftHandler'
import { airnavUsage, type AirnavEnv, type AirnavUsage } from '../../src/api/airnav'
import { cacheApiJson } from '../../src/api/edgeCache'
import { buildHealth } from '../../src/api/healthHandler'
import { edgeStores, exactCounters } from '../../src/api/storage'

type Env = SourceEnv & AirnavEnv & { AI_KV?: KVNamespace }

export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const url = new URL(request.url)
  const airport = (url.searchParams.get('airport') ?? 'ORD').toUpperCase().slice(0, 4)
  const colo = (request as Request & { cf?: { colo?: string } }).cf?.colo
  const health = await buildHealth(airport, 'cloudflare-pages', colo, {
    env,
    cache: cacheApiJson(caches.default, url.origin, waitUntil),
    probeAll: url.searchParams.get('probe') === 'all',
  })
  // The credit count changes a few times a day; reading it (from KV, when bound) once a minute per data centre is plenty.
  const stores = edgeStores(env, caches.default, url.origin, waitUntil)
  let airnav = await stores.near.get<AirnavUsage>('health-airnav')
  if (!airnav) {
    airnav = await airnavUsage(env, exactCounters(stores))
    await stores.near.put('health-airnav', airnav, 60)
  }
  return jsonResponse({ ...health, airnav }, 200, 'no-store')
}
