import { useEffect } from 'react'
import type { LiveEvent } from '../live/events'
import { usePlayhead } from '../playback/playheadStore'

/** A caption stays this long when nothing else is waiting, and at least this long when something is. */
const LINGER_MS = 7500
const MIN_MS = 3400

/**
 * Feeds tower-log events to the subtitle one at a time. Several things can
 * happen in the same poll; each gets its moment instead of the last one
 * winning.
 */
export function useLiveCaptions() {
  useEffect(() => {
    let queue: LiveEvent[] = []
    let timer = 0
    let showing = false

    const advance = () => {
      window.clearTimeout(timer)
      const next = queue.shift()
      showing = !!next
      usePlayhead.getState().setCaption(next ?? null)
      if (next) timer = window.setTimeout(advance, queue.length ? MIN_MS : LINGER_MS)
    }

    const unsubscribe = usePlayhead.subscribe((s, prev) => {
      if (s.airportIcao !== prev.airportIcao || s.mode !== 'live') {
        queue = []
        showing = false
        window.clearTimeout(timer)
        return
      }
      if (s.events === prev.events) return
      const known = new Set(prev.events.map((e) => e.id))
      // Store order is newest first; captions read oldest first.
      const fresh = s.events.filter((e) => !known.has(e.id)).toReversed()
      if (!fresh.length) return
      // Emergencies jump the queue; a backlog keeps only the latest few.
      queue = [...fresh.filter((e) => e.kind === 'emergency'), ...queue, ...fresh.filter((e) => e.kind !== 'emergency')].slice(-4)
      if (!showing) advance()
    })
    return () => {
      unsubscribe()
      window.clearTimeout(timer)
    }
  }, [])
}
