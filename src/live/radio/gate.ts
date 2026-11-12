/**
 * Holds each transcribed call back until the AI has processed it, so what
 * people read is the cleaned call with the right speaker, not the raw
 * recognition first and a correction after.
 *
 *  - A call waits for its answer for at most `waitMs`. When the answer
 *    comes in time the call is published with it; when the time is up it is
 *    published without (the caller marks it "unprocessed").
 *  - When no answer can come at all (AI off, not set up, over the daily
 *    cap), `process` says so by returning null and the call goes out at once.
 *  - Calls on one channel come out in the order they went in: a later call
 *    whose answer is ready waits behind an earlier one that is still
 *    waiting (which its own time limit will release).
 *  - An answer that arrives after its call went out without it is handed to
 *    `upgrade`, which improves the call where it stands.
 *
 * Pure bookkeeping: no stores, no network, timers injectable for tests.
 */

export type GateOptions<T, R> = {
  /** Longest a call is held back for its answer. */
  waitMs: number
  /** Per call instead of `waitMs` (e.g. until the moment the call will be heard). */
  waitFor?: (item: T) => number
  /** Calls with the same channel keep their order. */
  channel: (item: T) => string
  /** Start processing; the promise resolves to the answer, or null when there is none. Return null when no answer can come, to skip the wait. */
  process: (item: T) => Promise<R | null> | null
  publish: (item: T, result: R | null) => void
  /** The answer for a call already published without one. */
  upgrade: (item: T, result: R) => void
  /** Told whenever the number of calls being held changes. */
  onChange?: (waiting: number) => void
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export type Gate<T> = {
  /** Hand a call to the gate; it is published now or within `waitMs`. */
  submit: (item: T) => void
  /** Publish everything being held, now, without answers (answers that still arrive are upgrades). */
  release: () => void
  /** Calls being held. */
  readonly waiting: number
}

type Entry<T, R> = { item: T; ready: boolean; published: boolean; result: R | null; timer: unknown }

export function createGate<T, R>(opts: GateOptions<T, R>): Gate<T> {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const lanes = new Map<string, Entry<T, R>[]>()
  let waiting = 0

  const changed = () => opts.onChange?.(waiting)

  /** Publish from the front of the lane for as long as the front is ready. */
  const flush = (lane: Entry<T, R>[]) => {
    let out = 0
    while (lane.length && lane[0].ready) {
      const e = lane.shift()!
      e.published = true
      waiting--
      out++
      // One call's listener throwing must not strand the calls behind it.
      try {
        opts.publish(e.item, e.result)
      } catch (err) {
        console.error('[radio] publishing a call failed', err)
      }
    }
    if (out) changed()
  }

  return {
    submit(item) {
      const key = opts.channel(item)
      let lane = lanes.get(key)
      if (!lane) lanes.set(key, (lane = []))
      const mine = lane
      const pending = opts.process(item)
      const e: Entry<T, R> = { item, ready: pending === null, published: false, result: null, timer: null }
      mine.push(e)
      waiting++
      if (pending) {
        e.timer = setTimer(() => {
          e.ready = true
          flush(mine)
        }, Math.max(0, opts.waitFor ? opts.waitFor(item) : opts.waitMs))
        void pending
          .then(
            (r) => r,
            () => null,
          )
          .then((r) => {
            clearTimer(e.timer)
            if (e.published) {
              if (r != null) opts.upgrade(e.item, r)
              return
            }
            // Timed out but still queued behind an earlier call: the late answer is in time after all.
            if (r != null) e.result = r
            e.ready = true
            flush(mine)
          })
      }
      changed()
      flush(mine)
    },
    release() {
      for (const lane of lanes.values()) {
        for (const e of lane) {
          clearTimer(e.timer)
          e.ready = true
        }
        flush(lane)
      }
    },
    get waiting() {
      return waiting
    },
  }
}
