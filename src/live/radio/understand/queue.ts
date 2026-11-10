/**
 * A small work queue for the per-call AI requests: at most two in flight,
 * a few waiting, the oldest waiting ones dropped when a burst of calls
 * comes in (a stale cleanup is worth little), and nothing new started while
 * nobody is looking (the tab hidden for a while).
 */

export type QueueOptions<T> = {
  run: (job: T, signal: AbortSignal) => Promise<void>
  /** Requests at once. */
  maxInFlight?: number
  /** Jobs allowed to wait; beyond this the oldest waiting is dropped. */
  maxWaiting?: number
  /** True while new work should not start (tab hidden for long); waiting jobs are dropped. */
  paused?: () => boolean
  /** Told about every dropped job, so its "pending" state can be cleared. */
  onDrop?: (job: T) => void
}

export type WorkQueue<T> = {
  push: (job: T) => void
  /** Drop everything waiting and abort what is in flight. */
  clear: () => void
  /** Re-check the pause state and start what can start. */
  pump: () => void
  readonly size: { waiting: number; inFlight: number }
}

export function createQueue<T>(opts: QueueOptions<T>): WorkQueue<T> {
  const maxInFlight = opts.maxInFlight ?? 2
  const maxWaiting = opts.maxWaiting ?? 4
  let waiting: T[] = []
  const running = new Set<AbortController>()

  const drop = (jobs: T[]) => {
    for (const j of jobs) opts.onDrop?.(j)
  }

  const pump = () => {
    if (opts.paused?.()) {
      const gone = waiting
      waiting = []
      drop(gone)
      return
    }
    while (running.size < maxInFlight && waiting.length) {
      const job = waiting.shift()!
      const ctl = new AbortController()
      running.add(ctl)
      // A job that throws is the job's business; the queue carries on.
      void opts
        .run(job, ctl.signal)
        .catch(() => {})
        .finally(() => {
          running.delete(ctl)
          pump()
        })
    }
  }

  return {
    push(job) {
      if (opts.paused?.()) {
        drop([job])
        return
      }
      waiting.push(job)
      if (waiting.length > maxWaiting) drop(waiting.splice(0, waiting.length - maxWaiting))
      pump()
    },
    clear() {
      const gone = waiting
      waiting = []
      drop(gone)
      for (const c of running) c.abort()
    },
    pump,
    get size() {
      return { waiting: waiting.length, inFlight: running.size }
    },
  }
}

/**
 * Tracks how long the page has been hidden. `hiddenLong()` is true once it
 * has been hidden for `ms` (the radio may play on in a background tab, but
 * nobody is reading the transcript).
 */
export function hiddenTracker(ms: number, doc: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> | null = typeof document !== 'undefined' ? document : null, now: () => number = Date.now) {
  let since: number | null = doc?.hidden ? now() : null
  const on = () => {
    since = doc?.hidden ? (since ?? now()) : null
  }
  doc?.addEventListener('visibilitychange', on)
  return {
    hiddenLong: () => since != null && now() - since >= ms,
    stop: () => doc?.removeEventListener('visibilitychange', on),
  }
}
