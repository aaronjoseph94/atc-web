/* oxlint-disable no-await-in-loop -- the steps in these tests happen one after another on purpose */
import { describe, expect, it, vi } from 'vitest'
import { gateInfo, handleSessionPost, sessionAllows, signSession, SESSION_TTL_S, SITEVERIFY_URL, verifySession, verifyTurnstile } from './session'

const ON = { TURNSTILE_SITE_KEY: '0x4AAAAAAA-site', TURNSTILE_SECRET_KEY: '0x4AAAAAAA-secret' }
const SELF = 'https://atc-web-62t.pages.dev'
const now = Date.UTC(2026, 10, 16, 12)
const sameOrigin = { origin: SELF, referer: null, fetchSite: 'same-origin' }

/** A siteverify stand-in: answers `success` and records what it was sent. */
function siteverify(success: boolean, codes: string[] = []) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ success, 'error-codes': codes, hostname: 'atc-web-62t.pages.dev' }), { headers: { 'content-type': 'application/json' } }))
}

describe('gateInfo', () => {
  it('is off unless both Turnstile keys are set, and only ever exposes the public one', () => {
    expect(gateInfo({})).toEqual({ required: false, siteKey: null })
    expect(gateInfo({ TURNSTILE_SITE_KEY: 'site' })).toEqual({ required: false, siteKey: null })
    expect(gateInfo({ TURNSTILE_SECRET_KEY: 'secret' })).toEqual({ required: false, siteKey: null })
    expect(gateInfo({ TURNSTILE_SITE_KEY: ' ', TURNSTILE_SECRET_KEY: 'secret' })).toEqual({ required: false, siteKey: null })
    expect(gateInfo(ON)).toEqual({ required: true, siteKey: ON.TURNSTILE_SITE_KEY })
    expect(JSON.stringify(gateInfo(ON))).not.toContain('secret')
  })
})

describe('session tokens', () => {
  it('verify for the network they were issued to, until they expire', async () => {
    const { token, expiresAt } = await signSession(ON, '203.0.113.7', now)
    expect(expiresAt).toBe(now + SESSION_TTL_S * 1000)
    expect(token).toMatch(/^v1\.\d+\.[A-Za-z0-9_-]{43}$/)
    expect(token).not.toContain('203.0.113')
    expect(await verifySession(ON, token, '203.0.113.7', now)).toBe(true)
    expect(await verifySession(ON, token, '203.0.113.7', now + (SESSION_TTL_S - 1) * 1000)).toBe(true)
    expect(await verifySession(ON, token, '203.0.113.7', expiresAt)).toBe(false)
    expect(await verifySession(ON, token, '203.0.113.7', expiresAt + 60_000)).toBe(false)
  })

  it('are bound to the IPv4 address, or to the IPv6 /64', async () => {
    const v4 = (await signSession(ON, '203.0.113.7', now)).token
    expect(await verifySession(ON, v4, '203.0.113.8', now)).toBe(false)
    const v6 = (await signSession(ON, '2001:db8:1:2::aa', now)).token
    expect(await verifySession(ON, v6, '2001:db8:1:2:ffff::1', now)).toBe(true)
    expect(await verifySession(ON, v6, '2001:db8:1:3::aa', now)).toBe(false)
  })

  it('cannot be forged, altered, or carried to a server with another key', async () => {
    const { token } = await signSession(ON, '203.0.113.7', now)
    const [v, exp, sig] = token.split('.')
    // A later expiry with the old signature.
    expect(await verifySession(ON, `${v}.${Number(exp) + 600}.${sig}`, '203.0.113.7', now)).toBe(false)
    // A flipped signature character.
    const flipped = sig.slice(0, -2) + (sig.at(-2) === 'A' ? 'B' : 'A') + sig.at(-1)
    expect(await verifySession(ON, `${v}.${exp}.${flipped}`, '203.0.113.7', now)).toBe(false)
    // Another site's secret, or an explicit SESSION_SECRET, signs differently.
    expect(await verifySession({ ...ON, TURNSTILE_SECRET_KEY: 'other' }, token, '203.0.113.7', now)).toBe(false)
    expect(await verifySession({ ...ON, SESSION_SECRET: 'separate' }, token, '203.0.113.7', now)).toBe(false)
    const own = (await signSession({ ...ON, SESSION_SECRET: 'separate' }, '203.0.113.7', now)).token
    expect(await verifySession({ ...ON, SESSION_SECRET: 'separate' }, own, '203.0.113.7', now)).toBe(true)
    // Garbage.
    for (const bad of [null, '', 'v1', 'v2.1.x', `v1.${exp}.`, `v1.${exp}.${sig}.extra`, 'x'.repeat(500)]) expect(await verifySession(ON, bad, '203.0.113.7', now)).toBe(false)
  })

  it('refuses a token claiming a longer life than the server hands out', async () => {
    const far = await signSession(ON, '203.0.113.7', now + 3 * 3600_000)
    expect(await verifySession(ON, far.token, '203.0.113.7', now)).toBe(false)
  })

  it('are not needed while the gate is off', async () => {
    expect(await sessionAllows({}, null, '203.0.113.7', now)).toBe(true)
    expect(await sessionAllows({ TURNSTILE_SITE_KEY: 'only-the-public-key' }, null, '203.0.113.7', now)).toBe(true)
    expect(await sessionAllows(ON, null, '203.0.113.7', now)).toBe(false)
    expect(await sessionAllows(ON, (await signSession(ON, '203.0.113.7', now)).token, '203.0.113.7', now)).toBe(true)
  })
})

describe('verifyTurnstile', () => {
  it('posts the secret, the widget token and the visitor’s address to siteverify', async () => {
    const f = siteverify(true)
    expect(await verifyTurnstile(ON, 'widget-token', '203.0.113.7', f as unknown as typeof fetch)).toEqual({ ok: true, codes: [] })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe(SITEVERIFY_URL)
    expect(init?.method).toBe('POST')
    const form = new URLSearchParams(init?.body as URLSearchParams)
    expect(Object.fromEntries(form)).toEqual({ secret: ON.TURNSTILE_SECRET_KEY, response: 'widget-token', remoteip: '203.0.113.7' })
  })

  it('says no when siteverify does, or cannot be reached', async () => {
    expect(await verifyTurnstile(ON, 't', '203.0.113.7', siteverify(false, ['invalid-input-response']) as unknown as typeof fetch)).toEqual({ ok: false, codes: ['invalid-input-response'] })
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    expect(await verifyTurnstile(ON, 't', '203.0.113.7', down as unknown as typeof fetch)).toEqual({ ok: false, codes: ['siteverify-unreachable'] })
    expect((await verifyTurnstile({}, 't', '203.0.113.7', siteverify(true) as unknown as typeof fetch)).ok).toBe(false)
  })
})

describe('POST /api/session', () => {
  const ctx = (f: ReturnType<typeof siteverify>, over: Partial<Parameters<typeof handleSessionPost>[2]> = {}) => ({ self: SELF, from: sameOrigin, client: '203.0.113.7', now, fetch: f as unknown as typeof fetch, ...over })

  it('swaps a good widget token for a session token that the paid endpoints accept', async () => {
    const f = siteverify(true)
    const out = await handleSessionPost({ token: 'widget-token' }, ON, ctx(f))
    expect(out.status).toBe(200)
    expect(out.headers['cache-control']).toBe('no-store')
    expect(out.body).toMatchObject({ ok: true, ttlS: SESSION_TTL_S, expiresAt: new Date(now + SESSION_TTL_S * 1000).toISOString() })
    expect(await sessionAllows(ON, out.body.token as string, '203.0.113.7', now + 60_000)).toBe(true)
    expect(JSON.stringify(out.body)).not.toContain(ON.TURNSTILE_SECRET_KEY)
  })

  it('refuses a widget token Turnstile rejects', async () => {
    const out = await handleSessionPost({ token: 'stale' }, ON, ctx(siteverify(false, ['timeout-or-duplicate'])))
    expect(out.status).toBe(403)
    expect(out.body).toMatchObject({ ok: false, code: 'turnstile', codes: ['timeout-or-duplicate'] })
    expect(out.body.token).toBeUndefined()
  })

  it('refuses other sites, missing tokens, and everything while the gate is off', async () => {
    const f = siteverify(true)
    expect((await handleSessionPost({ token: 't' }, ON, ctx(f, { from: { origin: 'https://evil.example', referer: null, fetchSite: 'cross-site' } }))).status).toBe(403)
    expect((await handleSessionPost({ token: 't' }, ON, ctx(f, { from: { origin: null, referer: null, fetchSite: null } }))).status).toBe(403)
    expect((await handleSessionPost({}, ON, ctx(f))).status).toBe(400)
    expect((await handleSessionPost({ token: 'x'.repeat(5000) }, ON, ctx(f))).status).toBe(400)
    const off = await handleSessionPost({ token: 't' }, {}, ctx(f))
    expect(off.status).toBe(404)
    expect(off.body).toMatchObject({ code: 'off' })
    expect(f).not.toHaveBeenCalled()
  })
})
