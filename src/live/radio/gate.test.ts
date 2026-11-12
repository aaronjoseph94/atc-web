import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGate } from './gate'

type Call = { id: string; ch?: string }

/** A gate whose answers the test resolves by hand, with a log of what came out and when. */
function setup(waitMs = 8000) {
  const answers = new Map<string, (r: string | null) => void>()
  const out: string[] = []
  const upgrades: string[] = []
  const waiting: number[] = []
  /** Ids for which no answer can come (AI off, over the cap): `process` returns null. */
  const unavailable = new Set<string>()
  const gate = createGate<Call, string>({
    waitMs,
    channel: (c) => c.ch ?? 'twr',
    process: (c) => (unavailable.has(c.id) ? null : new Promise<string | null>((resolve) => answers.set(c.id, resolve))),
    publish: (c, r) => out.push(r ? `${c.id}:${r}` : `${c.id}:unprocessed`),
    upgrade: (c, r) => upgrades.push(`${c.id}:${r}`),
    onChange: (n) => waiting.push(n),
  })
  const answer = async (id: string, r: string | null) => {
    answers.get(id)!(r)
    await vi.advanceTimersByTimeAsync(0)
  }
  return { gate, out, upgrades, waiting, unavailable, answer }
}

describe('createGate', () => {
  beforeEach(() => void vi.useFakeTimers())
  afterEach(() => void vi.useRealTimers())

  it('holds a call until its answer arrives, then publishes it processed', async () => {
    const g = setup()
    g.gate.submit({ id: 'a' })
    expect(g.out).toEqual([])
    expect(g.gate.waiting).toBe(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(g.out).toEqual([])
    await g.answer('a', 'clean')
    expect(g.out).toEqual(['a:clean'])
    expect(g.gate.waiting).toBe(0)
    expect(g.waiting.at(-1)).toBe(0)
  })

  it('after the wait, publishes the call unprocessed', async () => {
    const g = setup()
    g.gate.submit({ id: 'a' })
    await vi.advanceTimersByTimeAsync(7999)
    expect(g.out).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(g.out).toEqual(['a:unprocessed'])
  })

  it('a late answer upgrades the call in place instead of publishing it again', async () => {
    const g = setup()
    g.gate.submit({ id: 'a' })
    await vi.advanceTimersByTimeAsync(8000)
    await g.answer('a', 'clean')
    expect(g.out).toEqual(['a:unprocessed'])
    expect(g.upgrades).toEqual(['a:clean'])
  })

  it('a failed request publishes at once, unprocessed, and upgrades nothing', async () => {
    const g = setup()
    g.gate.submit({ id: 'a' })
    await g.answer('a', null)
    expect(g.out).toEqual(['a:unprocessed'])
    await vi.advanceTimersByTimeAsync(20_000)
    expect(g.out).toEqual(['a:unprocessed'])
    expect(g.upgrades).toEqual([])
  })

  it('skips the wait entirely when no answer can come', () => {
    const g = setup()
    g.unavailable.add('a')
    g.gate.submit({ id: 'a' })
    // Synchronously: not even a tick of delay.
    expect(g.out).toEqual(['a:unprocessed'])
    expect(g.gate.waiting).toBe(0)
  })

  it('keeps the order on a channel: a later call waits behind an earlier one that is still waiting', async () => {
    const g = setup()
    g.gate.submit({ id: 'a' })
    await vi.advanceTimersByTimeAsync(1000)
    g.gate.submit({ id: 'b' })
    await g.answer('b', 'clean-b')
    expect(g.out).toEqual([])
    await g.answer('a', 'clean-a')
    expect(g.out).toEqual(['a:clean-a', 'b:clean-b'])
  })

  it('an earlier call that times out lets the later, answered one through right behind it', async () => {
    const g = setup()
    g.gate.submit({ id: 'a' })
    await vi.advanceTimersByTimeAsync(1000)
    g.gate.submit({ id: 'b' })
    await g.answer('b', 'clean-b')
    await vi.advanceTimersByTimeAsync(6999)
    expect(g.out).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(g.out).toEqual(['a:unprocessed', 'b:clean-b'])
    // The earlier call's answer, when it finally comes, is an upgrade.
    await g.answer('a', 'clean-a')
    expect(g.upgrades).toEqual(['a:clean-a'])
  })

  it('a call that needs no answer still waits its turn behind one that does', async () => {
    const g = setup()
    g.gate.submit({ id: 'a' })
    g.unavailable.add('roger')
    g.gate.submit({ id: 'roger' })
    expect(g.out).toEqual([])
    await g.answer('a', 'clean')
    expect(g.out).toEqual(['a:clean', 'roger:unprocessed'])
  })

  it('channels do not wait for each other', async () => {
    const g = setup()
    g.gate.submit({ id: 'a', ch: 'twr' })
    g.gate.submit({ id: 'b', ch: 'gnd' })
    await g.answer('b', 'clean-b')
    expect(g.out).toEqual(['b:clean-b'])
  })

  it('two calls that both time out come out in the order they were heard', async () => {
    const g = setup()
    g.gate.submit({ id: 'a' })
    g.gate.submit({ id: 'b' })
    await vi.advanceTimersByTimeAsync(8000)
    expect(g.out).toEqual(['a:unprocessed', 'b:unprocessed'])
  })

  it('release lets everything go now; answers that still arrive are upgrades', async () => {
    const g = setup()
    g.gate.submit({ id: 'a' })
    g.gate.submit({ id: 'b' })
    g.gate.release()
    expect(g.out).toEqual(['a:unprocessed', 'b:unprocessed'])
    expect(g.gate.waiting).toBe(0)
    await g.answer('b', 'clean-b')
    expect(g.upgrades).toEqual(['b:clean-b'])
    // The timers were cancelled: nothing is published twice.
    await vi.advanceTimersByTimeAsync(20_000)
    expect(g.out).toHaveLength(2)
  })

  it('one listener throwing does not strand the calls behind it', async () => {
    const out: string[] = []
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const gate = createGate<Call, string>({
      waitMs: 100,
      channel: () => 'x',
      process: () => null,
      publish: (c) => {
        if (c.id === 'bad') throw new Error('boom')
        out.push(c.id)
      },
      upgrade: () => {},
    })
    gate.submit({ id: 'bad' })
    gate.submit({ id: 'good' })
    expect(out).toEqual(['good'])
    err.mockRestore()
  })
})
