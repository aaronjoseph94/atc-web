/**
 * An optional bot gate for the endpoints that spend the owner's money
 * (`/api/ai`, `/api/summarize`, `/api/transcribe`, and AirNav lookups on
 * `/api/flight?deep=1`).
 *
 * Off unless the owner sets both `TURNSTILE_SITE_KEY` (a plain variable; it is
 * public) and `TURNSTILE_SECRET_KEY` (a secret) in Cloudflare Pages. When on:
 *
 *  1. The page runs a Cloudflare Turnstile widget (invisible unless
 *     Cloudflare wants a click) and POSTs its token to `/api/session`.
 *  2. The server checks that token with Turnstile's siteverify and answers
 *     with a session token of its own: an expiry ~30 minutes out, bound to
 *     the visitor's network (IPv4 address, or IPv6 /64), signed with
 *     HMAC-SHA256 (key: `SESSION_SECRET`, or one derived from the Turnstile
 *     secret when that is not set).
 *  3. Paid endpoints want that token in the `x-atc-session` header and answer
 *     401 `code: "session"` (with the public site key) without it; the page
 *     then fetches a new one and tries once more.
 *
 * Nothing is stored on the server: the token carries its own expiry and the
 * signature proves the server issued it for that network.
 *
 * WebCrypto only, so it runs on Workers, in Node (dev server) and in tests.
 */
import { ipPrefix, isSameOrigin, type OriginHeaders } from './ai/limits'
import type { GateInfo } from './sessionHeader'

export { SESSION_HEADER, type GateInfo } from './sessionHeader'

export type SessionEnv = {
  /** Public site key of the Turnstile widget (a plain variable). */
  TURNSTILE_SITE_KEY?: string
  /** Secret key of the same widget (a secret). Both must be set for the gate to be on. */
  TURNSTILE_SECRET_KEY?: string
  /** Optional: signs session tokens. Without it a key is derived from TURNSTILE_SECRET_KEY. */
  SESSION_SECRET?: string
}

/** How long a session token is good for. */
export const SESSION_TTL_S = 30 * 60
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const SITEVERIFY_TIMEOUT_MS = 8000
const VERSION = 'v1'

/** Whether the gate is on, and the public key the page needs to run the widget. */
export function gateInfo(env: SessionEnv): GateInfo {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim() || null
  const secret = env.TURNSTILE_SECRET_KEY?.trim()
  return siteKey && secret ? { required: true, siteKey } : { required: false, siteKey: null }
}

const enc = (s: string) => new TextEncoder().encode(s)

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
    return Uint8Array.from(bin, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

async function signingKey(env: SessionEnv) {
  const explicit = env.SESSION_SECRET?.trim()
  const turnstile = env.TURNSTILE_SECRET_KEY?.trim()
  if (!explicit && !turnstile) return null
  // Never the Turnstile secret itself: a key derived from it, for this purpose only.
  const material = explicit ? enc(explicit) : new Uint8Array(await crypto.subtle.digest('SHA-256', enc(`atc-session-key:${VERSION}:${turnstile}`)))
  return crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

const payload = (exp: number, client: string) => enc(`${VERSION}|${exp}|${ipPrefix(client)}`)

/** A session token for `client` (an IP address), good for `SESSION_TTL_S`. */
export async function signSession(env: SessionEnv, client: string, now = Date.now()): Promise<{ token: string; expiresAt: number }> {
  const key = await signingKey(env)
  if (!key) throw new Error('no session key')
  const exp = Math.floor(now / 1000) + SESSION_TTL_S
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, payload(exp, client)))
  return { token: `${VERSION}.${exp}.${b64url(sig)}`, expiresAt: exp * 1000 }
}

/** True when `token` was signed by this server for `client`'s network and has not expired. */
export async function verifySession(env: SessionEnv, token: string | null | undefined, client: string, now = Date.now()): Promise<boolean> {
  if (!token || token.length > 200) return false
  const m = /^v1\.(\d{9,12})\.([A-Za-z0-9_-]{43})$/.exec(token.trim())
  if (!m) return false
  const exp = Number(m[1])
  // Expired, or claiming a lifetime this server never hands out.
  if (exp * 1000 <= now || exp * 1000 > now + (SESSION_TTL_S + 60) * 1000) return false
  const key = await signingKey(env)
  const sig = fromB64url(m[2])
  if (!key || !sig) return false
  // crypto.subtle.verify compares in constant time.
  return crypto.subtle.verify('HMAC', key, sig, payload(exp, client))
}

/** True when the request may go on: the gate is off, or it carries a valid session token. */
export async function sessionAllows(env: SessionEnv, token: string | null | undefined, client: string, now = Date.now()): Promise<boolean> {
  if (!gateInfo(env).required) return true
  return verifySession(env, token, client, now)
}

/** The 401 body a gated endpoint answers with; carries the public site key so the page can run the widget. */
export function sessionRefusal(env: SessionEnv) {
  return { ok: false as const, error: 'A quick check that this is a browser is needed first.', status: 401, code: 'session' as const, siteKey: gateInfo(env).siteKey }
}

export type TurnstileResult = { ok: boolean; codes: string[] }

/** Ask Turnstile whether the widget's token is good (each token can be checked once). */
export async function verifyTurnstile(env: SessionEnv, token: string, client: string, fetchImpl: typeof fetch = fetch): Promise<TurnstileResult> {
  const secret = env.TURNSTILE_SECRET_KEY?.trim()
  if (!secret) return { ok: false, codes: ['missing-input-secret'] }
  const form = new URLSearchParams({ secret, response: token })
  if (client && client !== 'anonymous' && client !== 'local') form.set('remoteip', client)
  try {
    const res = await fetchImpl(SITEVERIFY_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS) })
    const body = (await res.json().catch(() => null)) as { success?: unknown; 'error-codes'?: unknown } | null
    const codes = Array.isArray(body?.['error-codes']) ? body['error-codes'].filter((c): c is string => typeof c === 'string').slice(0, 5) : []
    return { ok: res.ok && body?.success === true, codes }
  } catch {
    return { ok: false, codes: ['siteverify-unreachable'] }
  }
}

export type SessionContext = {
  self: string
  from: OriginHeaders
  /** The visitor's IP address. */
  client: string
  now?: number
  fetch?: typeof fetch
}

export type SessionAnswer = { status: number; body: Record<string, unknown>; headers: Record<string, string> }

const answer = (status: number, body: Record<string, unknown>): SessionAnswer => ({ status, body, headers: { 'cache-control': 'no-store' } })

/** `POST /api/session` body `{ token }` (from the Turnstile widget) → `{ ok, token, expiresAt }`. */
export async function handleSessionPost(body: unknown, env: SessionEnv, ctx: SessionContext): Promise<SessionAnswer> {
  if (!gateInfo(env).required) return answer(404, { ok: false, code: 'off', error: 'This site does not ask for a check.' })
  if (!isSameOrigin(ctx.self, ctx.from)) return answer(403, { ok: false, code: 'origin', error: 'Only accepted from this site.' })
  const token = (body as { token?: unknown } | null)?.token
  if (typeof token !== 'string' || !token || token.length > 2048) return answer(400, { ok: false, code: 'bad_request', error: 'token required' })
  const check = await verifyTurnstile(env, token, ctx.client, ctx.fetch)
  if (!check.ok) return answer(403, { ok: false, code: 'turnstile', error: 'The check did not pass.', codes: check.codes })
  const s = await signSession(env, ctx.client, ctx.now)
  return answer(200, { ok: true, token: s.token, expiresAt: new Date(s.expiresAt).toISOString(), ttlS: SESSION_TTL_S })
}
