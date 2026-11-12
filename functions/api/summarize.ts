/**
 * POST /api/summarize  — plain-English summary of a flight's recent radio calls.
 * GET  /api/summarize  — AI configuration status (no secrets) for Settings.
 *
 * AI provider credentials live in Pages environment variables (AI_API_KEY,
 * AI_BASE_URL, AI_MODEL). Without them the rule-based explainer answers, so
 * the endpoint is always usable. Identical requests are served from the edge
 * cache for an hour to keep token spend minimal. A model is only asked for
 * requests from this site's own pages and while the site's daily AI cap
 * (shared with /api/ai) has room; otherwise the rules answer.
 */
import { jsonResponse } from '../../src/api/aircraftHandler'
import { isSameOrigin, originHeaders, reserveAi, type LimitEnv } from '../../src/api/ai/limits'
import { busyCounters, edgeStores } from '../../src/api/storage'
import {
  aiStatus,
  parseSummarizeRequest,
  summarize,
  summarizeCacheKey,
  type AiEnv,
} from '../../src/api/summarizeHandler'

const CACHE_TTL_S = 3600

type Env = AiEnv & LimitEnv & { AI_KV?: KVNamespace }

export const onRequestGet: PagesFunction<Env> = async ({ env }) => jsonResponse(aiStatus(env), 200, 'no-store')

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
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

  // The model costs the owner money: same-origin requests only, counted against the daily cap.
  let useAi = !!env.AI_API_KEY && isSameOrigin(new URL(request.url).origin, originHeaders((n) => request.headers.get(n)))
  if (useAi) {
    const stores = edgeStores(env, cache, new URL(request.url).origin, waitUntil)
    useAi = (await reserveAi(busyCounters(stores), 'summarize', env, Date.now())).ok
  }
  const result = await summarize(req, useAi ? env : {})
  const res = jsonResponse(result, 200, `public, max-age=${CACHE_TTL_S}`)
  // Only cache real AI answers; rules are instant and may improve between deploys.
  if (result.source === 'ai') waitUntil(cache.put(cacheKey, res.clone()))
  return res
}
