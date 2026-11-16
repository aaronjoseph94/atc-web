/**
 * Browser side of the optional Turnstile gate (see ./session.ts).
 *
 * While the owner has not turned the gate on, none of this does anything:
 * no script is loaded, no header is added and every request goes out exactly
 * as it would without this module.
 *
 * Once the server says the gate is on (`session.required` in `GET /api/ai`, or
 * a 401 `code: "session"` from a paid endpoint, both carrying the public site
 * key), the page loads Cloudflare's Turnstile script, runs the widget once
 * (invisible unless Cloudflare wants a click), swaps its token for a session
 * token at `POST /api/session`, keeps that in memory only, renews it a few
 * minutes before it expires, and sends it as `x-atc-session`.
 */
import { SESSION_HEADER, type GateInfo } from './sessionHeader'

type TurnstileOptions = {
  sitekey: string
  appearance?: 'always' | 'execute' | 'interaction-only'
  callback?: (token: string) => void
  'error-callback'?: (code?: string) => void
  'expired-callback'?: () => void
  'timeout-callback'?: () => void
}
/** The few DOM pieces used, typed here because src/api is also compiled for Workers (no DOM types there). */
type El = { setAttribute(name: string, value: string): void; style: { cssText: string }; remove(): void; src?: string; async?: boolean; onload?: unknown; onerror?: unknown }
type Doc = { createElement(tag: string): El; head: { appendChild(el: El): unknown }; body: { appendChild(el: El): unknown } }
const doc = () => (globalThis as unknown as { document: Doc }).document
type Turnstile = { render: (el: El, opts: TurnstileOptions) => string | undefined; remove: (id: string) => void }

export const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
/** Renew this long before the token runs out. */
const RENEW_BEFORE_MS = 5 * 60_000
/** Give up on the widget after this long (a challenge nobody answers). */
const WIDGET_TIMEOUT_MS = 60_000
/** After a failed attempt, wait this long before running the widget again. */
const RETRY_AFTER_FAIL_MS = 30_000

let siteKey: string | null = null
let current: { token: string; expiresAt: number } | null = null
let pending: Promise<string | null> | null = null
let failedUntil = 0
let script: Promise<Turnstile> | null = null

const turnstileOf = () => (globalThis as { turnstile?: Turnstile }).turnstile

/** Forget everything (tests). */
export function resetSession() {
  siteKey = null
  current = null
  pending = null
  failedUntil = 0
  script = null
}

/** True once the server has said the gate is on. */
export const sessionRequired = () => siteKey != null

/** What the server said about the gate; when it is on, a session is fetched ahead of the first paid request. */
export function noteGate(info: GateInfo | null | undefined) {
  if (!info?.required || !info.siteKey) return
  siteKey = info.siteKey
  void ensureSession()
}

/** The header to send with a paid request: the session token while it is good, else nothing. Starts a renewal when it is close to running out. */
export function sessionHeaders(now = Date.now()): Record<string, string> {
  if (!current) return {}
  if (now >= current.expiresAt - RENEW_BEFORE_MS) void ensureSession()
  return now < current.expiresAt - 5_000 ? { [SESSION_HEADER]: current.token } : {}
}

function loadScript(): Promise<Turnstile> {
  const ready = turnstileOf()
  if (ready) return Promise.resolve(ready)
  script ??= new Promise<Turnstile>((resolve, reject) => {
    const el = doc().createElement('script')
    el.src = TURNSTILE_SCRIPT
    el.async = true
    el.onload = () => {
      const t = turnstileOf()
      if (t) resolve(t)
      else reject(new Error('turnstile did not load'))
    }
    el.onerror = () => reject(new Error('turnstile did not load'))
    doc().head.appendChild(el)
  }).catch((err: unknown) => {
    script = null
    throw err
  })
  return script
}

/** Run the widget once and resolve with its token. It stays invisible unless Cloudflare wants an interaction. */
async function runWidget(key: string): Promise<string> {
  const turnstile = await loadScript()
  const box = doc().createElement('div')
  box.setAttribute('data-atc-turnstile', '')
  box.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483000'
  doc().body.appendChild(box)
  let id: string | undefined
  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('turnstile timed out')), WIDGET_TIMEOUT_MS)
      const fail = (why: string) => () => {
        clearTimeout(timer)
        reject(new Error(why))
      }
      id = turnstile.render(box, {
        sitekey: key,
        appearance: 'interaction-only',
        callback: (token) => {
          clearTimeout(timer)
          resolve(token)
        },
        'error-callback': fail('turnstile error'),
        'expired-callback': fail('turnstile expired'),
        'timeout-callback': fail('turnstile timed out'),
      })
    })
  } finally {
    try {
      if (id) turnstile.remove(id)
    } catch {
      // Already gone.
    }
    box.remove()
  }
}

/** A good session token, fetching or renewing one when needed; null while the gate is off or the check failed. */
export function ensureSession(opts: { force?: boolean } = {}): Promise<string | null> {
  const key = siteKey
  if (!key) return Promise.resolve(null)
  const now = Date.now()
  if (!opts.force && current && now < current.expiresAt - RENEW_BEFORE_MS) return Promise.resolve(current.token)
  if (pending) return pending
  // Just failed: not again at once, or every paid request would run the widget.
  if (now < failedUntil) return Promise.resolve(!opts.force && current && now < current.expiresAt ? current.token : null)
  const p: Promise<string | null> = (async () => {
    try {
      const token = await runWidget(key)
      const res = await fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
      const body = (await res.json().catch(() => null)) as { ok?: boolean; token?: unknown; expiresAt?: unknown } | null
      if (!res.ok || !body?.ok || typeof body.token !== 'string') throw new Error(`session ${res.status}`)
      const expiresAt = typeof body.expiresAt === 'string' ? Date.parse(body.expiresAt) : NaN
      current = { token: body.token, expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 25 * 60_000 }
      failedUntil = 0
      return current.token
    } catch {
      failedUntil = Date.now() + RETRY_AFTER_FAIL_MS
      return null
    } finally {
      pending = null
    }
  })()
  pending = p
  return p
}

function withSession(init: RequestInit | undefined): RequestInit | undefined {
  const extra = sessionHeaders()
  if (!Object.keys(extra).length) return init
  return { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers).entries()), ...extra } }
}

/**
 * `fetch` for the paid endpoints: adds the session header when there is one,
 * and when the server answers 401 `code: "session"` gets a (new) session and
 * tries once more. With the gate off it is a plain `fetch`. The body must be
 * reusable (a string or a Blob), as it may be sent twice.
 */
export async function fetchWithSession(url: string, init?: RequestInit): Promise<Response> {
  if (siteKey && !current) await ensureSession()
  const sent = current?.token
  const res = await fetch(url, withSession(init))
  if (res.status !== 401) return res
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { code?: unknown; siteKey?: unknown } | null
  if (body?.code !== 'session' || typeof body.siteKey !== 'string' || !body.siteKey) return res
  siteKey = body.siteKey
  // Another request has already replaced the token we sent: just use the new one.
  if (current && current.token !== sent) return fetch(url, withSession(init))
  // The token we sent (if any) was not accepted: a new network, or it ran out.
  current = null
  const token = await ensureSession({ force: true })
  if (!token) return res
  return fetch(url, withSession(init))
}
