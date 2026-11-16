/**
 * POST /api/summarize  — plain-English summary of a flight's recent radio calls.
 * GET  /api/summarize  — AI configuration status (no secrets) for Settings.
 *
 * AI provider credentials live in Pages environment variables (AI_API_KEY,
 * AI_BASE_URL, AI_MODEL). Without them the rule-based explainer answers, so
 * the endpoint is always usable. Identical requests are served from the edge
 * cache for an hour to keep token spend minimal. A model is only asked for
 * requests from this site's own pages, within the per-visitor rate limit and
 * while the site's daily AI cap (shared with /api/ai) has room; otherwise the
 * rules answer. With the Turnstile gate on, a session token (x-atc-session)
 * is needed at all.
 */
import { jsonResponse } from '../../src/api/aircraftHandler'
import { originHeaders, type LimitEnv } from '../../src/api/ai/limits'
import { SESSION_HEADER, sessionAllows, sessionRefusal, type SessionEnv } from '../../src/api/session'
import { busyCounters, edgeStores } from '../../src/api/storage'
import {
  aiStatus,
  parseSummarizeRequest,
  summarize,
  summarizeCacheKey,
  summarizeGate,
  type AiEnv,
} from '../../src/api/summarizeHandler'

const CACHE_TTL_S = 3600

type Env = AiEnv & LimitEnv & SessionEnv & { AI_KV?: KVNamespace }

export const onRequestGet: PagesFunction<Env> = async ({ env }) => jsonResponse(aiStatus(env), 200, 'no-store')

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  let req
  try {
    req = parseSummarizeRequest(await request.json())
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'bad request' }, 400, 'no-store')
  }

  const self = new URL(request.url).origin
  const client = request.headers.get('cf-connecting-ip') ?? 'anonymous'
  const session = request.headers.get(SESSION_HEADER)
  // With the Turnstile gate on, nothing is answered (not even from the cache) without a session.
  if (!(await sessionAllows(env, session, client))) return jsonResponse(sessionRefusal(env), 401, 'no-store')

  const key = await summarizeCacheKey(req)
  const cacheKey = new Request(`${self}/api/summarize?k=${key}`, { method: 'GET' })
  const cache = caches.default
  const hit = await cache.match(cacheKey)
  if (hit) return hit

  // The model costs the owner money: same-origin, per-visitor rate limit, daily cap (cache hits above cost nothing).
  const stores = edgeStores(env, cache, self, waitUntil)
  const gate = await summarizeGate(env, { self, from: originHeaders((n) => request.headers.get(n)), client, session, counters: busyCounters(stores), rates: stores.near })
  if ('refuse' in gate) return jsonResponse(gate.refuse, 401, 'no-store')
  const result = await summarize(req, gate.useAi ? env : {})
  const res = jsonResponse(result, 200, `public, max-age=${CACHE_TTL_S}`)
  // Only cache real AI answers; rules are instant and may improve between deploys.
  if (result.source === 'ai') waitUntil(cache.put(cacheKey, res.clone()))
  return res
}
