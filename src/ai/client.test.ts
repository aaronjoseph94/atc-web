import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAiSettings } from './aiSettings'
import { aiBlocked, aiReadyNow, askAi, AiUnavailableError, getAiRunStatus, resetAiLimits, statusAllows, useAiLimit } from './client'
import { limitMessage } from './limitNotice'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const STATUS = { configured: true, provider: 'anthropic', model: 'm', label: 'M', usage: { day: 'd', today: 1, cap: 10, limited: false, resetsAt: new Date(Date.now() + 3600_000).toISOString(), tasks: { radioCleanup: { today: 7, cap: 7 } }, storage: 'cache' } }

beforeEach(() => {
  resetAiLimits()
  useAiSettings.setState({ enabled: true })
})
afterEach(() => vi.unstubAllGlobals())

describe('askAi sharing', () => {
  it('one caller aborting does not cancel the answer for another caller', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const fetchMock = vi.fn(async () => {
      await gate
      return json({ ok: true, result: { a: 1 }, provider: 'anthropic', model: 'm' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const ctrl = new AbortController()
    const first = askAi('t-share', { x: 1 }, { signal: ctrl.signal })
    const second = askAi('t-share', { x: 1 })
    ctrl.abort()
    await expect(first).rejects.toBeTruthy()
    release()
    await expect(second).resolves.toEqual({ a: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('askAi and the server’s limits', () => {
  it('sends the task and nothing else: no key, provider or model headers', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json({ ok: true, result: 'pong' }))
    vi.stubGlobal('fetch', fetchMock)
    await askAi('t-plain', { q: 1 })
    const init = fetchMock.mock.calls[0][1]!
    expect(init.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse(String(init.body))).toEqual({ task: 't-plain', input: { q: 1 } })
  })

  it('after "AI daily limit reached", fails fast without asking again, for every task', async () => {
    const fetchMock = vi.fn(async () => json({ ok: false, error: 'AI daily limit reached', status: 429, code: 'daily_cap', retryAfterS: 7200 }, 429))
    vi.stubGlobal('fetch', fetchMock)
    const err = await askAi('t-cap', { n: 1 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AiUnavailableError)
    expect(err).toMatchObject({ status: 429, code: 'daily_cap', message: 'AI daily limit reached' })
    await expect(askAi('t-other', { n: 2 })).rejects.toMatchObject({ code: 'daily_cap' })
    await expect(askAi('t-cap', { n: 3 })).rejects.toMatchObject({ code: 'daily_cap' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(useAiLimit.getState().limited).toMatchObject({ code: 'daily_cap', task: null })
    expect(await aiReadyNow()).toBe(false)
  })

  it('asks again after a while (the cap may have been raised), not only at midnight', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn(async () => json({ ok: false, error: 'AI daily limit reached', status: 429, code: 'daily_cap', retryAfterS: 20 * 3600 }, 429))
      vi.stubGlobal('fetch', fetchMock)
      await askAi('t-recheck', {}).catch(() => {})
      await vi.advanceTimersByTimeAsync(9 * 60_000)
      await askAi('t-recheck', {}).catch(() => {})
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(2 * 60_000)
      expect(aiBlocked('t-recheck')).toBeNull()
      expect(useAiLimit.getState().limited).toBeNull()
      await askAi('t-recheck', {}).catch(() => {})
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a task’s own cap stops that task only', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const task = (JSON.parse(String(init!.body)) as { task: string }).task
      return task === 'radioCleanup' ? json({ ok: false, error: 'AI daily limit reached', status: 429, code: 'task_cap', retryAfterS: 600 }, 429) : json({ ok: true, result: 'fine' })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(askAi('radioCleanup', { text: 'a' })).rejects.toMatchObject({ code: 'task_cap' })
    await expect(askAi('radioCleanup', { text: 'b' })).rejects.toMatchObject({ code: 'task_cap' })
    await expect(askAi('weatherBrief', { x: 1 })).resolves.toBe('fine')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a rate limit pauses briefly without being reported as the daily limit', async () => {
    const fetchMock = vi.fn(async () => json({ ok: false, error: 'Too many AI requests', status: 429, code: 'rate_limited', retryAfterS: 8 }, 429))
    vi.stubGlobal('fetch', fetchMock)
    await askAi('t-rate', {}).catch(() => {})
    expect(aiBlocked('anything')).toMatchObject({ code: 'rate_limited' })
    expect(useAiLimit.getState().limited).toBeNull()
  })

  it('does nothing when switched off on this device', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    useAiSettings.setState({ enabled: false })
    await expect(askAi('t-off', {})).rejects.toMatchObject({ status: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await aiReadyNow()).toBe(false)
  })
})

describe('status', () => {
  it('is shared by callers asking at the same time', async () => {
    const fetchMock = vi.fn(async () => json(STATUS))
    vi.stubGlobal('fetch', fetchMock)
    const [a, b] = await Promise.all([getAiRunStatus(), getAiRunStatus()])
    expect(a).toEqual(b)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await aiReadyNow()).toBe(true)
  })

  it('knows a task at its own cap from the status alone', () => {
    expect(statusAllows(STATUS as never)).toBe(true)
    expect(statusAllows(STATUS as never, 'radioCleanup')).toBe(false)
    expect(statusAllows(STATUS as never, 'weatherBrief')).toBe(true)
    expect(statusAllows({ ...STATUS, configured: false } as never)).toBe(false)
    expect(statusAllows(undefined)).toBe(false)
  })

  it('a status that says the cap is reached stops requests before any is refused', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === 'POST' ? json({ ok: true, result: 1 }) : json({ ...STATUS, usage: { ...STATUS.usage, limited: true } })))
    vi.stubGlobal('fetch', fetchMock)
    expect(await aiReadyNow()).toBe(false)
    await expect(askAi('t-status-cap', {})).rejects.toMatchObject({ code: 'daily_cap' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(useAiLimit.getState().limited?.code).toBe('daily_cap')
  })
})

describe('the one notice', () => {
  it('is worded for the daily limit and for radio, and silent for a small task’s own cap', () => {
    expect(limitMessage({ code: 'daily_cap', task: null, until: 0 })).toMatch(/AI daily limit reached/)
    expect(limitMessage({ code: 'task_cap', task: 'radioCleanup', until: 0 })).toMatch(/radio calls/)
    expect(limitMessage({ code: 'task_cap', task: 'flightStory', until: 0 })).toBeNull()
  })
})
