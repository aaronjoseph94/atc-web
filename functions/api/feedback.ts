/**
 * POST /api/feedback — in-app feedback: triaged (AI with the server's key, or
 * keyword rules) and filed as a GitHub issue when GITHUB_FEEDBACK_TOKEN and
 * GITHUB_FEEDBACK_REPO are set. See src/api/feedbackHandler.ts.
 */
import { jsonResponse } from '../../src/api/aircraftHandler'
import { handleFeedback, MAX_BODY, type FeedbackEnv } from '../../src/api/feedbackHandler'

export const onRequestPost: PagesFunction<FeedbackEnv> = async ({ request, env }) => {
  const size = Number(request.headers.get('content-length') ?? 0)
  if (size > MAX_BODY) return jsonResponse({ ok: false, error: 'Too large', status: 413 }, 413, 'no-store')
  const raw = await request.text()
  if (raw.length > MAX_BODY) return jsonResponse({ ok: false, error: 'Too large', status: 413 }, 413, 'no-store')
  const client = request.headers.get('cf-connecting-ip') ?? 'anonymous'
  const out = await handleFeedback(raw, env, client)
  return jsonResponse(out.body, out.status, 'no-store')
}
