// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureSession, fetchWithSession, noteGate, resetSession, sessionHeaders } from './sessionClient'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const refusal = () => json({ ok: false, code: 'session', siteKey: 'site-key', status: 401 }, 401)

/** A Turnstile stand-in that passes at once (or fails), recording each render. */
function fakeTurnstile(pass = true) {
  const renders: { sitekey: string; appearance?: string }[] = []
  const t = {
    render: vi.fn((_el: unknown, opts: { sitekey: string; appearance?: string; callback?: (t: string) => void; 'error-callback'?: () => void }) => {
      renders.push({ sitekey: opts.sitekey, appearance: opts.appearance })
      queueMicrotask(() => (pass ? opts.callback?.(`widget-${renders.length}`) : opts['error-callback']?.()))
      return `w${renders.length}`
    }),
    remove: vi.fn(),
  }
  ;(globalThis as { turnstile?: unknown }).turnstile = t
  return { t, renders }
}

const headerOf = (init: RequestInit | undefined, name: string) => new Headers(init?.headers).get(name)

describe('session client', () => {
  beforeEach(() => resetSession())
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    delete (globalThis as { turnstile?: unknown }).turnstile
    document.head.querySelectorAll('script').forEach((s) => s.remove())
  })

  it('with the gate off, is a plain fetch: same arguments, no script, no extra request', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => json({ ok: true }))
    vi.stubGlobal('fetch', f)
    const init = { method: 'POST', body: '{}' }
    const res = await fetchWithSession('/api/ai', init)
    expect(res.status).toBe(200)
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0]).toEqual(['/api/ai', init])
    noteGate({ required: false, siteKey: null })
    expect(sessionHeaders()).toEqual({})
    expect(await ensureSession()).toBeNull()
    expect(document.querySelector('script[src*="turnstile"]')).toBeNull()
  })

  it('a 401 "session" runs the widget, swaps its token at /api/session and retries once with the header', async () => {
    const { renders } = fakeTurnstile()
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString()
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/session') return json({ ok: true, token: 'v1.session', expiresAt })
      return headerOf(init, 'x-atc-session') === 'v1.session' ? json({ ok: true, result: 1 }) : refusal()
    })
    vi.stubGlobal('fetch', f)
    const res = await fetchWithSession('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"task":"ping"}' })
    expect(res.status).toBe(200)
    expect(renders).toEqual([{ sitekey: 'site-key', appearance: 'interaction-only' }])
    const session = f.mock.calls.find((c) => c[0] === '/api/session')!
    expect(JSON.parse(session[1]!.body as string)).toEqual({ token: 'widget-1' })
    const retry = f.mock.calls.at(-1)!
    expect(headerOf(retry[1], 'content-type')).toBe('application/json')
    expect(retry[1]!.body).toBe('{"task":"ping"}')
    // Later requests carry the token straight away, without running the widget again.
    await fetchWithSession('/api/summarize', { method: 'POST', body: '{}' })
    expect(headerOf(f.mock.calls.at(-1)![1], 'x-atc-session')).toBe('v1.session')
    expect(renders).toHaveLength(1)
    // The widget is taken down once it has answered.
    expect(document.querySelector('[data-atc-turnstile]')).toBeNull()
  })

  it('loads Turnstile’s script (explicit render) only once the gate is known to be on', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true })))
    noteGate({ required: true, siteKey: 'site-key' })
    const tag = document.querySelector<HTMLScriptElement>('script[src*="challenges.cloudflare.com"]')
    expect(tag?.src).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit')
  })

  it('renews the session before it runs out', async () => {
    fakeTurnstile()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.UTC(2026, 10, 16, 12))
    let n = 0
    const f = vi.fn(async (url: string) => (url === '/api/session' ? json({ ok: true, token: `v1.t${++n}`, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() }) : json({ ok: true })))
    vi.stubGlobal('fetch', f)
    noteGate({ required: true, siteKey: 'site-key' })
    expect(await ensureSession()).toBe('v1.t1')
    expect(sessionHeaders()).toEqual({ 'x-atc-session': 'v1.t1' })
    // Twenty-six minutes on: still good, but close enough to its end that a new one is fetched.
    vi.setSystemTime(Date.now() + 26 * 60_000)
    expect(sessionHeaders()).toEqual({ 'x-atc-session': 'v1.t1' })
    expect(await ensureSession()).toBe('v1.t2')
    expect(sessionHeaders()).toEqual({ 'x-atc-session': 'v1.t2' })
  })

  it('when the check fails, hands back the 401 and does not run the widget again at once', async () => {
    const { renders } = fakeTurnstile(false)
    const f = vi.fn(async (_url: string, _init?: RequestInit) => refusal())
    vi.stubGlobal('fetch', f)
    expect((await fetchWithSession('/api/transcribe', { method: 'POST', body: new Blob(['x']) })).status).toBe(401)
    expect((await fetchWithSession('/api/transcribe', { method: 'POST', body: new Blob(['x']) })).status).toBe(401)
    expect(renders).toHaveLength(1)
    expect(f.mock.calls.every((c) => c[0] !== '/api/session')).toBe(true)
  })

  it('requests refused together share one renewal, and a newer token is reused rather than replaced', async () => {
    const { renders } = fakeTurnstile()
    let issued = 0
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/session') return json({ ok: true, token: `v1.t${++issued}`, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() })
      // Only the second session is accepted (the first was "from another network").
      return headerOf(init, 'x-atc-session') === 'v1.t2' ? json({ ok: true }) : refusal()
    })
    vi.stubGlobal('fetch', f)
    noteGate({ required: true, siteKey: 'site-key' })
    expect(await ensureSession()).toBe('v1.t1')
    const all = await Promise.all([1, 2, 3].map(() => fetchWithSession('/api/ai', { method: 'POST', body: '{}' })))
    expect(all.map((r) => r.status)).toEqual([200, 200, 200])
    expect(issued).toBe(2)
    expect(renders).toHaveLength(2)
    // A request that went out with the old token after the renewal just retries with the new one.
    const late = await fetchWithSession('/api/ai', { method: 'POST', body: '{}' })
    expect(late.status).toBe(200)
    expect(issued).toBe(2)
  })

  it('a 401 that is not about the session is returned as it is', async () => {
    const f = vi.fn(async () => json({ ok: false, code: 'not_configured' }, 401))
    vi.stubGlobal('fetch', f)
    const res = await fetchWithSession('/api/ai', { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ code: 'not_configured' })
    expect(f).toHaveBeenCalledTimes(1)
  })
})
