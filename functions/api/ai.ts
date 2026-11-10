/**
 * POST /api/ai — run one named AI task ({ task, input }); see src/api/ai/tasks.ts.
 * GET  /api/ai — which provider and model would answer (never the keys).
 *
 * Keys: typed in Settings > AI on the device (sent per request in headers and
 * used only for that call), or set once for everyone as Cloudflare secrets
 * ANTHROPIC_API_KEY / OPENROUTER_API_KEY. Answers to identical requests are
 * cached at the edge for the task's `cacheS` seconds, keyed without the keys.
 */
import { jsonResponse } from '../../src/api/aircraftHandler'
import { aiStatus, handleAiRun } from '../../src/api/ai/handler'
import { optionsFromHeaders, type AiEnv } from '../../src/api/ai/run'
import { TASKS } from '../../src/api/ai/tasks'

export const onRequestGet: PagesFunction<AiEnv> = async ({ request, env }) =>
  jsonResponse(aiStatus(env, optionsFromHeaders((n) => request.headers.get(n))), 200, 'no-store')

export const onRequestPost: PagesFunction<AiEnv> = async ({ request, env, waitUntil }) => {
  let body: { task?: string; input?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ ok: false, error: 'bad request', status: 400 }, 400, 'no-store')
  }
  const opts = optionsFromHeaders((n) => request.headers.get(n))
  const task = body.task ? TASKS[body.task] : undefined
  const ttl = task?.cacheS ?? 0

  let cacheKey: Request | null = null
  if (ttl > 0) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([body.task, body.input, opts.provider ?? 'auto', opts.model ?? ''])))
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
    cacheKey = new Request(`${new URL(request.url).origin}/api/ai?k=${hex}`, { method: 'GET' })
    const hit = await caches.default.match(cacheKey)
    if (hit) return hit
  }

  const out = await handleAiRun(body, env, opts)
  const res = jsonResponse(out, out.ok ? 200 : out.status, out.ok && ttl > 0 ? `public, max-age=${ttl}` : 'no-store')
  if (out.ok && cacheKey) waitUntil(caches.default.put(cacheKey, res.clone()))
  return res
}
