/**
 * GET  /api/session — whether the optional Turnstile gate is on, and the
 *                     widget's public site key (`{ required, siteKey }`).
 * POST /api/session — `{ token }` from the Turnstile widget in, a short-lived
 *                     session token out (`{ ok, token, expiresAt }`), for the
 *                     `x-atc-session` header of /api/ai, /api/summarize,
 *                     /api/transcribe and /api/flight?deep=1.
 *
 * The gate is off (POST answers 404) unless TURNSTILE_SITE_KEY and
 * TURNSTILE_SECRET_KEY are both set; see src/api/session.ts and docs/ai-setup.md.
 */
import { jsonResponse } from '../../src/api/aircraftHandler'
import { originHeaders } from '../../src/api/ai/limits'
import { gateInfo, handleSessionPost, type SessionEnv } from '../../src/api/session'

export const onRequestGet: PagesFunction<SessionEnv> = async ({ env }) => jsonResponse(gateInfo(env), 200, 'no-store')

export const onRequestPost: PagesFunction<SessionEnv> = async ({ request, env }) => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ ok: false, code: 'bad_request', error: 'bad request' }, 400, 'no-store')
  }
  const out = await handleSessionPost(body, env, {
    self: new URL(request.url).origin,
    from: originHeaders((n) => request.headers.get(n)),
    client: request.headers.get('cf-connecting-ip') ?? 'anonymous',
  })
  return new Response(JSON.stringify(out.body), { status: out.status, headers: { 'content-type': 'application/json; charset=utf-8', ...out.headers } })
}
