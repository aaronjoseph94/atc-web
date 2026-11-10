import { describe, expect, it } from 'vitest'
import { createQueue, hiddenTracker } from './queue'

/** A job runner whose jobs finish when the test says so. */
function runner() {
  const started: number[] = []
  const finish = new Map<number, () => void>()
  const aborted: number[] = []
  const run = (job: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      started.push(job)
      finish.set(job, resolve)
      signal.addEventListener('abort', () => {
        aborted.push(job)
        resolve()
      })
    })
  return { run, started, aborted, done: async (job: number) => {
    finish.get(job)?.()
    // Let the queue's finally() and the next start run.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  } }
}

describe('createQueue', () => {
  it('runs at most two at once and starts the next when one finishes', async () => {
    const r = runner()
    const q = createQueue<number>({ run: r.run, maxInFlight: 2, maxWaiting: 10 })
    for (const j of [1, 2, 3, 4]) q.push(j)
    expect(r.started).toEqual([1, 2])
    expect(q.size).toEqual({ waiting: 2, inFlight: 2 })
    await r.done(1)
    expect(r.started).toEqual([1, 2, 3])
    await r.done(3)
    await r.done(2)
    expect(r.started).toEqual([1, 2, 3, 4])
  })

  it('drops the oldest waiting calls in a burst', async () => {
    const r = runner()
    const dropped: number[] = []
    const q = createQueue<number>({ run: r.run, maxInFlight: 2, maxWaiting: 2, onDrop: (j) => dropped.push(j) })
    for (const j of [1, 2, 3, 4, 5, 6]) q.push(j)
    expect(r.started).toEqual([1, 2])
    expect(dropped).toEqual([3, 4])
    await r.done(1)
    await r.done(2)
    expect(r.started).toEqual([1, 2, 5, 6])
  })

  it('starts nothing while paused, and clear() aborts what is running', async () => {
    const r = runner()
    let paused = false
    const dropped: number[] = []
    const q = createQueue<number>({ run: r.run, maxInFlight: 1, paused: () => paused, onDrop: (j) => dropped.push(j) })
    q.push(1)
    q.push(2)
    paused = true
    q.push(3)
    expect(dropped).toEqual([3])
    await r.done(1)
    // The waiting job is dropped rather than started while nobody is looking.
    expect(r.started).toEqual([1])
    expect(dropped).toEqual([3, 2])
    paused = false
    q.push(4)
    q.push(5)
    q.clear()
    await Promise.resolve()
    expect(r.aborted).toEqual([4])
    expect(dropped).toEqual([3, 2, 5])
  })

  it('carries on after a job throws', async () => {
    const started: number[] = []
    const q = createQueue<number>({
      run: async (j) => {
        started.push(j)
        throw new Error('nope')
      },
      maxInFlight: 1,
    })
    q.push(1)
    q.push(2)
    await new Promise((r) => setTimeout(r, 0))
    expect(started).toEqual([1, 2])
  })
})

describe('hiddenTracker', () => {
  it('says the page has been hidden long only after the delay', () => {
    let now = 0
    const listeners: (() => void)[] = []
    const doc = { hidden: false, addEventListener: (_: string, fn: () => void) => listeners.push(fn), removeEventListener: () => {} }
    const h = hiddenTracker(1000, doc as unknown as Document, () => now)
    expect(h.hiddenLong()).toBe(false)
    doc.hidden = true
    listeners.forEach((f) => f())
    now = 500
    expect(h.hiddenLong()).toBe(false)
    now = 1500
    expect(h.hiddenLong()).toBe(true)
    doc.hidden = false
    listeners.forEach((f) => f())
    expect(h.hiddenLong()).toBe(false)
  })
})
