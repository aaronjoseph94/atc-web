import { describe, expect, it, vi } from 'vitest'
import { hedgedFirst, memoryCache, SourceHealth, UpstreamError } from './sourceHealth'

describe('SourceHealth', () => {
  it('opens after repeated failures, half-opens after the cool-down, closes on success', () => {
    let now = 0
    const h = new SourceHealth({ failureThreshold: 2, cooldownMs: 1000, now: () => now })
    h.recordFailure('a', new Error('x'))
    expect(h.state('a')).toBe('closed')
    h.recordFailure('a', new Error('x'))
    expect(h.state('a')).toBe('open')
    expect(h.status('a', 'adsb')).toMatchObject({ breaker: 'open', ok: false, error: 'x', retryAt: new Date(1000).toISOString() })
    now = 1000
    expect(h.state('a')).toBe('half-open')
    h.recordSuccess('a', 120, 7)
    expect(h.state('a')).toBe('closed')
    expect(h.status('a', 'adsb')).toMatchObject({ ok: true, latencyMs: 120, count: 7, error: null })
  })

  it('doubles the cool-down each time a trial fails, up to the maximum', () => {
    let now = 0
    const h = new SourceHealth({ failureThreshold: 1, cooldownMs: 1000, maxCooldownMs: 3000, now: () => now })
    h.recordFailure('a', new Error('x')) // open until 1000
    now = 1000
    h.recordFailure('a', new Error('x')) // trial failed: 2000
    expect(h.status('a', 'adsb').retryAt).toBe(new Date(3000).toISOString())
    now = 3000
    h.recordFailure('a', new Error('x')) // capped at 3000
    expect(h.status('a', 'adsb').retryAt).toBe(new Date(6000).toISOString())
  })

  it('opens at once, for the maximum, on 429 or 403', () => {
    const h = new SourceHealth({ failureThreshold: 5, cooldownMs: 1000, maxCooldownMs: 9000, now: () => 0 })
    h.recordFailure('a', new UpstreamError('HTTP 429', 429))
    expect(h.status('a', 'adsb').retryAt).toBe(new Date(9000).toISOString())
  })

  it('orders closed, then half-open, then open (soonest first)', () => {
    let now = 0
    const h = new SourceHealth({ failureThreshold: 1, cooldownMs: 1000, now: () => now })
    const src = ['a', 'b', 'c', 'd'].map((name) => ({ name }))
    h.recordFailure('a', new Error('x')) // open until 1000
    now = 500
    h.recordFailure('b', new Error('x')) // open until 1500
    now = 1200 // a half-open, b open
    expect(h.order(src).map((s) => s.name)).toEqual(['c', 'd', 'a', 'b'])
  })

  it('reports timeouts plainly', () => {
    const h = new SourceHealth()
    h.recordFailure('a', new DOMException('signal timed out', 'TimeoutError'))
    expect(h.status('a', 'weather').error).toBe('timed out')
  })
})

describe('hedgedFirst', () => {
  it('returns the first good value in order', async () => {
    const r = await hedgedFirst([
      { name: 'a', run: async () => null },
      { name: 'b', run: async () => 'B' },
    ])
    expect(r).toEqual({ value: 'B', source: 'b' })
  })

  it('starts the fallback when the primary is slow', async () => {
    const r = await hedgedFirst(
      [
        { name: 'slow', run: (s) => new Promise((_, rej) => s.addEventListener('abort', () => rej(new Error('aborted')))) },
        { name: 'fast', run: async () => 1 },
      ],
      { hedgeMs: 5 },
    )
    expect(r.source).toBe('fast')
  })

  it('does not call the fallback when the primary answers in time', async () => {
    const b = vi.fn(async () => 2)
    await hedgedFirst([{ name: 'a', run: async () => 1 }, { name: 'b', run: b }], { hedgeMs: 50 })
    expect(b).not.toHaveBeenCalled()
  })

  it('collects every error when nothing is good, and feeds the breaker', async () => {
    const h = new SourceHealth({ failureThreshold: 1 })
    const r = await hedgedFirst(
      [
        { name: 'a', run: async () => Promise.reject(new Error('HTTP 500')) },
        { name: 'b', run: async () => null },
      ],
      { health: h },
    )
    expect(r).toEqual({ value: null, source: null, errors: ['a: HTTP 500', 'b: no data'] })
    expect(h.state('a')).toBe('open')
    expect(h.state('b')).toBe('closed')
  })
})

describe('memoryCache', () => {
  it('expires entries and evicts the oldest past the cap', async () => {
    let now = 0
    const c = memoryCache(2, () => now)
    await c.put('a', 1, 10)
    expect(await c.get('a')).toBe(1)
    now = 10_000
    expect(await c.get('a')).toBeUndefined()
    await c.put('x', 1, 60)
    await c.put('y', 2, 60)
    await c.put('z', 3, 60)
    expect(await c.get('x')).toBeUndefined()
    expect(await c.get('z')).toBe(3)
  })
})
