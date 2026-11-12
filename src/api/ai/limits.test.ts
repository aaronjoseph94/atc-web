/* oxlint-disable no-await-in-loop -- the steps in these tests happen one after another on purpose */
import { describe, expect, it } from 'vitest'
import { memoryStorage, storeCounters } from '../storage'
import { aiCaps, aiUsage, checkRate, isSameOrigin, reserveAi, stepRate, type RateDoc } from './limits'

const SELF = 'https://atc-web-62t.pages.dev'
const from = (h: Partial<{ origin: string; referer: string; fetchSite: string }>) => ({ origin: h.origin ?? null, referer: h.referer ?? null, fetchSite: h.fetchSite ?? null })

describe('isSameOrigin', () => {
  it('accepts this site’s own pages', () => {
    expect(isSameOrigin(SELF, from({ origin: SELF, fetchSite: 'same-origin' }))).toBe(true)
    expect(isSameOrigin(SELF, from({ origin: SELF }))).toBe(true)
    expect(isSameOrigin(SELF, from({ referer: `${SELF}/#/JFK` }))).toBe(true)
    expect(isSameOrigin(SELF, from({ fetchSite: 'same-origin' }))).toBe(true)
  })
  it('rejects other sites, and requests that say nothing about where they came from', () => {
    expect(isSameOrigin(SELF, from({ origin: 'https://evil.example' }))).toBe(false)
    expect(isSameOrigin(SELF, from({ origin: SELF, fetchSite: 'cross-site' }))).toBe(false)
    expect(isSameOrigin(SELF, from({ referer: 'https://evil.example/page' }))).toBe(false)
    expect(isSameOrigin(SELF, from({ origin: 'null' }))).toBe(false)
    expect(isSameOrigin(SELF, from({}))).toBe(false)
    // A preview deployment is its own origin: production pages cannot spend through it, nor the other way round.
    expect(isSameOrigin('https://claude-w3-ai.atc-web-62t.pages.dev', from({ origin: SELF }))).toBe(false)
  })
})

describe('aiCaps', () => {
  it('defaults to 3000 a day with radio held to 70% of it', () => {
    expect(aiCaps({})).toEqual({ daily: 3000, tasks: { radioCleanup: 2100 } })
  })
  it('reads the owner’s numbers and ignores nonsense', () => {
    expect(aiCaps({ AI_DAILY_CAP: '500' })).toEqual({ daily: 500, tasks: { radioCleanup: 350 } })
    expect(aiCaps({ AI_DAILY_CAP: 'many' }).daily).toBe(3000)
    expect(aiCaps({ AI_DAILY_CAP: '0' }).daily).toBe(0)
    expect(aiCaps({ AI_DAILY_CAP: '100', AI_TASK_CAPS: 'radioCleanup=20, flightStory=10,bad,weatherBrief=9999' }).tasks).toEqual({ radioCleanup: 20, flightStory: 10, weatherBrief: 100 })
  })
})

describe('stepRate', () => {
  const limits = { burst: 3, perMinute: 5 }
  it('allows a burst, then asks for a pause until the ten seconds are over', () => {
    let doc: RateDoc | undefined
    const t0 = 120_000
    for (let i = 0; i < 3; i++) {
      const r = stepRate(doc, t0 + i * 100, limits)
      expect(r.ok).toBe(true)
      doc = r.next
    }
    const r = stepRate(doc, t0 + 400, limits)
    expect(r).toMatchObject({ ok: false, retryAfterS: 10 })
    expect(stepRate(r.next, t0 + 10_000, limits).ok).toBe(true)
  })
  it('holds the per-minute ceiling across bursts', () => {
    let doc: RateDoc | undefined
    const t0 = 600_000
    let allowed = 0
    for (let s = 0; s < 60; s += 5) {
      const r = stepRate(doc, t0 + s * 1000, limits)
      if (r.ok) allowed++
      doc = r.next
    }
    expect(allowed).toBe(5)
    expect(stepRate(doc, t0 + 59_000, limits)).toMatchObject({ ok: false, retryAfterS: 1 })
    expect(stepRate(doc, t0 + 60_000, limits).ok).toBe(true)
  })
})

describe('checkRate', () => {
  it('limits each visitor on their own, without storing the address', async () => {
    const store = memoryStorage()
    const env = { AI_RATE_BURST: '2', AI_RATE_PER_MIN: '10' }
    const now = 1_000_000
    const mem = new Map<string, RateDoc>()
    expect((await checkRate(store, '203.0.113.7', env, now, mem)).ok).toBe(true)
    expect((await checkRate(store, '203.0.113.7', env, now + 1, mem)).ok).toBe(true)
    expect(await checkRate(store, '203.0.113.7', env, now + 2, mem)).toMatchObject({ ok: false })
    expect((await checkRate(store, '198.51.100.9', env, now + 3, mem)).ok).toBe(true)
    expect([...mem.keys()].some((k) => k.includes('203.0.113.7'))).toBe(false)
  })
  it('a fresh isolate still sees what the shared store counted', async () => {
    const store = memoryStorage()
    const env = { AI_RATE_BURST: '1', AI_RATE_PER_MIN: '10' }
    expect((await checkRate(store, 'a', env, 5000, new Map())).ok).toBe(true)
    expect((await checkRate(store, 'a', env, 5001, new Map())).ok).toBe(false)
  })
})

describe('daily caps', () => {
  const now = Date.UTC(2026, 10, 12, 10)
  const fresh = () => storeCounters(memoryStorage(() => now), { mirror: new Map(), now: () => now })

  it('counts each request and refuses past the cap, saying when it resets', async () => {
    const c = fresh()
    const env = { AI_DAILY_CAP: '3', AI_TASK_CAPS: 'radioCleanup=3' }
    for (let i = 0; i < 3; i++) expect(await reserveAi(c, 'flightStory', env, now)).toEqual({ ok: true })
    expect(await reserveAi(c, 'flightStory', env, now)).toEqual({ ok: false, code: 'daily_cap', retryAfterS: 14 * 3600 })
    const u = await aiUsage(c, env, now)
    expect(u).toMatchObject({ day: '2026-11-12', today: 3, cap: 3, limited: true, storage: 'memory', resetsAt: '2026-11-13T00:00:00.000Z' })
  })

  it('radio cannot starve the rest: it stops at its own cap while other tasks carry on', async () => {
    const c = fresh()
    const env = { AI_DAILY_CAP: '10' }
    for (let i = 0; i < 7; i++) expect((await reserveAi(c, 'radioCleanup', env, now)).ok).toBe(true)
    expect(await reserveAi(c, 'radioCleanup', env, now)).toMatchObject({ ok: false, code: 'task_cap' })
    expect((await reserveAi(c, 'weatherBrief', env, now)).ok).toBe(true)
    const u = await aiUsage(c, env, now)
    expect(u).toMatchObject({ today: 8, limited: false, tasks: { radioCleanup: { today: 7, cap: 7 } } })
  })

  it('starts again on the next UTC day', async () => {
    const c = fresh()
    const env = { AI_DAILY_CAP: '1' }
    expect((await reserveAi(c, 'ping', env, now)).ok).toBe(true)
    expect((await reserveAi(c, 'ping', env, now)).ok).toBe(false)
    expect((await reserveAi(c, 'ping', env, now + 15 * 3600_000)).ok).toBe(true)
  })

  it('a cap of zero switches AI off', async () => {
    expect(await reserveAi(fresh(), 'ping', { AI_DAILY_CAP: '0' }, now)).toMatchObject({ ok: false, code: 'daily_cap' })
  })
})
