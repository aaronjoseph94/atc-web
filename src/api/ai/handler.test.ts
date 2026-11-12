/* oxlint-disable no-await-in-loop -- the steps in these tests happen one after another on purpose */
import { describe, expect, it, vi } from 'vitest'
import { memoryCache } from '../sourceHealth'
import { memoryStorage, storeCounters } from '../storage'
import { aiStatus, handleAiPost, type AiRequestContext } from './handler'
import type { ResolvedAi, RunAiArgs, RunAiResult } from './run'

const SELF = 'https://atc.test'
const KEY = { ANTHROPIC_API_KEY: 'sk-test' }
const now = Date.UTC(2026, 10, 12, 10)

/** A request context with empty stores and a model that answers at once. */
function ctx(over: Partial<AiRequestContext> = {}) {
  const store = memoryStorage(() => now)
  const run = vi.fn(async (_ai: ResolvedAi, _args: RunAiArgs): Promise<RunAiResult> => ({ text: '{"ok":true}', json: { ok: true }, provider: 'anthropic', model: 'claude-haiku-5-5' }))
  const c: AiRequestContext = {
    self: SELF,
    from: { origin: SELF, referer: null, fetchSite: 'same-origin' },
    client: '203.0.113.7',
    counters: storeCounters(store, { mirror: new Map(), now: () => now }),
    rates: store,
    rateMemory: new Map(),
    answers: memoryCache(100, () => now),
    now,
    run,
    ...over,
  }
  return { c, run }
}

// `ping` is never cached; `explainTerm` is (identical questions share an answer).
const ping = { task: 'ping', input: {} }
const term = (t: string) => ({ task: 'explainTerm', input: { term: t } })

describe('handleAiPost', () => {
  it('runs a task with the server’s key', async () => {
    const { c, run } = ctx()
    const out = await handleAiPost(ping, KEY, c)
    expect(out.status).toBe(200)
    expect(out.body).toMatchObject({ ok: true, task: 'ping', provider: 'anthropic' })
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0]).toMatchObject({ provider: 'anthropic', key: 'sk-test', model: 'claude-haiku-5-5' })
  })

  it('refuses requests that do not come from this site, before anything is spent', async () => {
    const { c, run } = ctx({ from: { origin: 'https://evil.example', referer: null, fetchSite: 'cross-site' } })
    const out = await handleAiPost(ping, KEY, c)
    expect(out.status).toBe(403)
    expect(out.body).toMatchObject({ ok: false, code: 'origin' })
    const bare = ctx({ from: { origin: null, referer: null, fetchSite: null } })
    expect((await handleAiPost(ping, KEY, bare.c)).status).toBe(403)
    expect(run).not.toHaveBeenCalled()
    expect((await aiStatus(KEY, c.counters, now)).usage.today).toBe(0)
  })

  it('says so when no key is set, and never looks at keys in the request', async () => {
    const { c, run } = ctx()
    const out = await handleAiPost({ ...ping, anthropicKey: 'sk-from-browser' }, {}, c)
    expect(out.status).toBe(401)
    expect(out.body).toMatchObject({ ok: false, code: 'not_configured' })
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects unknown tasks and oversized input', async () => {
    const { c } = ctx()
    expect((await handleAiPost({ task: 'nope', input: {} }, KEY, c)).status).toBe(404)
    expect((await handleAiPost({ task: 'ping', input: { junk: 'x'.repeat(30_000) } }, KEY, c)).status).toBe(413)
  })

  it('stops at the daily cap with a clear 429', async () => {
    const { c, run } = ctx()
    const env = { ...KEY, AI_DAILY_CAP: '2' }
    expect((await handleAiPost(ping, env, c)).status).toBe(200)
    expect((await handleAiPost(ping, env, c)).status).toBe(200)
    const out = await handleAiPost(ping, env, c)
    expect(out.status).toBe(429)
    expect(out.body).toMatchObject({ ok: false, error: 'AI daily limit reached', code: 'daily_cap', retryAfterS: 14 * 3600 })
    expect(out.headers['retry-after']).toBe(String(14 * 3600))
    expect(run).toHaveBeenCalledTimes(2)
    const st = await aiStatus(env, c.counters, now)
    expect(st).toMatchObject({ configured: true, provider: 'anthropic', model: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', usage: { today: 2, cap: 2, limited: true } })
  })

  it('answers from the cache are free: not counted, not rate limited, still served past the cap', async () => {
    const { c, run } = ctx()
    const env = { ...KEY, AI_DAILY_CAP: '1', AI_RATE_BURST: '1' }
    const first = await handleAiPost(term('squawk'), env, c)
    expect(first.status).toBe(200)
    for (let i = 0; i < 5; i++) {
      const again = await handleAiPost(term('squawk'), env, c)
      expect(again.status).toBe(200)
      expect(again.headers['x-atc-ai-cache']).toBe('hit')
      expect(again.body).toEqual(first.body)
    }
    expect(run).toHaveBeenCalledTimes(1)
    expect((await aiStatus(env, c.counters, now)).usage.today).toBe(1)
    // A different question is a real request again, and the cap is reached.
    expect((await handleAiPost(term('ils'), env, { ...c, client: 'someone-else' })).body).toMatchObject({ code: 'daily_cap' })
  })

  it('rate limits one visitor without touching the others', async () => {
    const { c, run } = ctx()
    const env = { ...KEY, AI_RATE_BURST: '2' }
    expect((await handleAiPost(ping, env, c)).status).toBe(200)
    expect((await handleAiPost(ping, env, c)).status).toBe(200)
    const out = await handleAiPost(ping, env, c)
    expect(out.status).toBe(429)
    expect(out.body).toMatchObject({ code: 'rate_limited' })
    expect((await handleAiPost(ping, env, { ...c, client: '198.51.100.9' })).status).toBe(200)
    expect(run).toHaveBeenCalledTimes(3)
    // A refused request is not counted against the day.
    expect((await aiStatus(env, c.counters, now)).usage.today).toBe(3)
  })

  it('holds the radio task to its own share', async () => {
    const { c } = ctx()
    const env = { ...KEY, AI_DAILY_CAP: '10', AI_TASK_CAPS: 'radioCleanup=1', AI_RATE_BURST: '50' }
    const radio = (text: string) => ({ task: 'radioCleanup', input: { text, station: { airport: 'JFK', name: 'Kennedy', role: 'TWR', label: 'Tower', mhz: 119.1 }, recent: [], traffic: [], runways: [], taxiways: [], guess: { speaker: 'unknown', callsigns: [] } } })
    expect((await handleAiPost(radio('delta one two three cleared to land'), env, c)).status).toBe(200)
    expect((await handleAiPost(radio('delta one two three contact ground'), env, c)).body).toMatchObject({ code: 'task_cap', status: 429 })
    expect((await handleAiPost(ping, env, c)).status).toBe(200)
  })

  it('reports "not set up" in the status without a key', async () => {
    const { c } = ctx()
    expect(await aiStatus({}, c.counters, now)).toMatchObject({ configured: false, provider: null, model: null, label: null, providers: { anthropic: false, openrouter: false }, usage: { today: 0, cap: 3000, limited: false } })
  })

  it('runs the device’s pick of model and provider, and never a model off the list', async () => {
    const both = { ANTHROPIC_API_KEY: 'sk-ant', OPENROUTER_API_KEY: 'sk-or' }
    const { c, run } = ctx()
    await handleAiPost(ping, both, { ...c, choice: { model: 'claude-sonnet-5-5', provider: 'openrouter' } })
    await handleAiPost(ping, both, { ...c, choice: { model: 'claude-opus-5-5' } })
    await handleAiPost(ping, { ...both, AI_MODEL: 'claude-opus-5-5' }, c)
    expect(run.mock.calls.map(([ai]) => [ai.provider, ai.model])).toEqual([
      ['openrouter', 'anthropic/claude-sonnet-5.5'],
      ['anthropic', 'claude-haiku-5-5'],
      ['anthropic', 'claude-haiku-5-5'],
    ])
  })

  it('keeps cached answers apart per model: a Sonnet answer is never served to a Haiku request', async () => {
    const { c, run } = ctx()
    run.mockImplementation(async (ai) => ({ text: ai.model, json: { by: ai.model }, provider: ai.provider, model: ai.model }))
    const haiku = await handleAiPost(term('squawk'), KEY, c)
    const sonnet = await handleAiPost(term('squawk'), KEY, { ...c, choice: { model: 'claude-sonnet-5-5' } })
    expect(sonnet.headers['x-atc-ai-cache']).toBeUndefined()
    expect(sonnet.body).toMatchObject({ model: 'claude-sonnet-5-5', result: { by: 'claude-sonnet-5-5' } })
    const haikuAgain = await handleAiPost(term('squawk'), KEY, { ...c, choice: { model: 'claude-haiku-5-5' } })
    expect(haikuAgain.headers['x-atc-ai-cache']).toBe('hit')
    expect(haikuAgain.body).toEqual(haiku.body)
    const sonnetAgain = await handleAiPost(term('squawk'), KEY, { ...c, choice: { model: 'claude-sonnet-5-5' } })
    expect(sonnetAgain.body).toEqual(sonnet.body)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('the status says which providers are set up and what answers this device, never a key', async () => {
    const { c } = ctx()
    const env = { ANTHROPIC_API_KEY: 'sk-ant-SECRET', OPENROUTER_API_KEY: 'sk-or-SECRET', AI_MODEL: 'claude-sonnet-5-5', AI_PROVIDER: 'openrouter' }
    const st = await aiStatus(env, c.counters, now)
    expect(st).toMatchObject({
      configured: true,
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-5.5',
      label: 'Claude Sonnet 5.5',
      providers: { anthropic: true, openrouter: true },
      models: [
        { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
        { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
      ],
      defaults: { model: 'claude-sonnet-5-5', provider: 'openrouter' },
    })
    expect(JSON.stringify(st)).not.toContain('SECRET')
    expect(await aiStatus(env, c.counters, now, { model: 'claude-haiku-5-5', provider: 'anthropic' })).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' })
  })
})
