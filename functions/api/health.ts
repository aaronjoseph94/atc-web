/**
 * GET /api/health?airport=ORD
 *
 * Diagnostics for the Settings page: which provider answered, latency,
 * aircraft count and the Cloudflare colo that served the request.
 */
import { jsonResponse } from '../../src/api/aircraftHandler'
import { buildHealth } from '../../src/api/healthHandler'

export const onRequestGet: PagesFunction = async ({ request }) => {
  const airport = (new URL(request.url).searchParams.get('airport') ?? 'ORD').toUpperCase()
  const colo = (request as Request & { cf?: { colo?: string } }).cf?.colo
  const health = await buildHealth(airport, 'cloudflare-pages', colo)
  return jsonResponse(health, 200, 'no-store')
}
