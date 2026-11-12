/**
 * POST /api/ai — run one named AI task ({ task, input }); see src/api/ai/tasks.ts.
 * GET  /api/ai — whether AI is set up, which model answers, today's usage and cap.
 *
 * The keys are Cloudflare secrets (ANTHROPIC_API_KEY / OPENROUTER_API_KEY, see
 * docs/ai-setup.md); the browser never has one. Because every visitor spends
 * the owner's key, requests must come from this site, are rate limited per
 * visitor and stop at a daily cap (AI_DAILY_CAP). Answers to identical
 * requests are cached at the edge for the task's `cacheS` seconds and are not
 * counted. Counts live in the AI_KV namespace when it is bound, else in this
 * data centre's cache (approximate).
 */
import { jsonResponse } from '../../src/api/aircraftHandler'
import { aiStatus, handleAiPost, type AiHandlerEnv } from '../../src/api/ai/handler'
import { originHeaders } from '../../src/api/ai/limits'
import { busyCounters, edgeStores } from '../../src/api/storage'

type Env = AiHandlerEnv & { AI_KV?: KVNamespace }

export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const stores = edgeStores(env, caches.default, new URL(request.url).origin, waitUntil)
  return jsonResponse(await aiStatus(env, busyCounters(stores)), 200, 'no-store')
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ ok: false, error: 'bad request', status: 400 }, 400, 'no-store')
  }
  const self = new URL(request.url).origin
  const stores = edgeStores(env, caches.default, self, waitUntil)
  const out = await handleAiPost(body, env, {
    self,
    from: originHeaders((n) => request.headers.get(n)),
    client: request.headers.get('cf-connecting-ip') ?? 'anonymous',
    counters: busyCounters(stores),
    rates: stores.near,
    answers: stores.near,
  })
  return new Response(JSON.stringify(out.body), { status: out.status, headers: { 'content-type': 'application/json; charset=utf-8', ...out.headers } })
}
