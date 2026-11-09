/**
 * POST /api/summarize  — plain-English summary of a flight's recent radio calls.
 * GET  /api/summarize  — AI configuration status (no secrets) for Settings.
 *
 * AI provider credentials live in Pages environment variables (AI_API_KEY,
 * AI_BASE_URL, AI_MODEL). Without them the rule-based explainer answers, so
 * the endpoint is always usable. Identical requests are served from the edge
 * cache for an hour to keep token spend minimal.
 */
import { jsonResponse } from '../../src/api/aircraftHandler'
import {
  aiStatus,
  parseSummarizeRequest,
  summarize,
  summarizeCacheKey,
  type AiEnv,
} from '../../src/api/summarizeHandler'

const CACHE_TTL_S = 3600

export const onRequestGet: PagesFunction<AiEnv> = async ({ env }) => jsonResponse(aiStatus(env), 200, 'no-store')

export const onRequestPost: PagesFunction<AiEnv> = async ({ request, env, waitUntil }) => {
  let req
  try {
    req = parseSummarizeRequest(await request.json())
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'bad request' }, 400, 'no-store')
  }

  const key = await summarizeCacheKey(req)
  const cacheKey = new Request(`${new URL(request.url).origin}/api/summarize?k=${key}`, { method: 'GET' })
  const cache = caches.default
  const hit = await cache.match(cacheKey)
  if (hit) return hit

  const result = await summarize(req, env)
  const res = jsonResponse(result, 200, `public, max-age=${CACHE_TTL_S}`)
  // Only cache real AI answers; rules are instant and may improve between deploys.
  if (result.source === 'ai') waitUntil(cache.put(cacheKey, res.clone()))
  return res
}
