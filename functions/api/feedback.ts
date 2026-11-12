/**
 * POST /api/feedback — in-app feedback: triaged (AI with the server's key, or
 * keyword rules) and filed as a GitHub issue when GITHUB_FEEDBACK_TOKEN and
 * GITHUB_FEEDBACK_REPO are set. See src/api/feedbackHandler.ts.
 */
import { jsonResponse } from '../../src/api/aircraftHandler'
import { reserveAi, type LimitEnv } from '../../src/api/ai/limits'
import { handleFeedback, MAX_BODY, type FeedbackEnv } from '../../src/api/feedbackHandler'
import { busyCounters, edgeStores } from '../../src/api/storage'

type Env = FeedbackEnv & LimitEnv & { AI_KV?: KVNamespace }

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const size = Number(request.headers.get('content-length') ?? 0)
  if (size > MAX_BODY) return jsonResponse({ ok: false, error: 'Too large', status: 413 }, 413, 'no-store')
  const raw = await request.text()
  if (raw.length > MAX_BODY) return jsonResponse({ ok: false, error: 'Too large', status: 413 }, 413, 'no-store')
  const client = request.headers.get('cf-connecting-ip') ?? 'anonymous'
  // AI triage counts against the site's daily AI cap; past it, the keyword rules sort the report.
  const counters = busyCounters(edgeStores(env, caches.default, new URL(request.url).origin, waitUntil))
  const out = await handleFeedback(raw, env, client, { aiAllowed: async () => (await reserveAi(counters, 'triageFeedback', env, Date.now())).ok })
  return jsonResponse(out.body, out.status, 'no-store')
}
