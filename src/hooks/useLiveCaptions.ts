import { useEffect } from 'react'
import type { LiveEvent } from '../live/events'
import { useRadio } from '../live/radio/radioStore'
import { usePlayhead } from '../playback/playheadStore'

/** A caption stays this long when nothing else is waiting, and at least this long when something is. */
const LINGER_MS = 7500
const MIN_MS = 3400
/** A radio call stays on the caption line this long after its transcript arrives (or until the next call). */
const RADIO_LINGER_MS = 9000

/** True while the radio is (trying to be) on air: its calls own the caption line. */
const radioOnAir = () => {
  const r = useRadio.getState()
  return r.on && r.status !== 'off' && r.status !== 'nofeed'
}

/**
 * Feeds the caption line in live mode.
 *
 * With the radio playing, each transcribed call is shown until the next one
 * (or for a few seconds). Otherwise tower-log events are shown one at a
 * time: several things can happen in the same poll, and each gets its
 * moment instead of the last one winning.
 */
export function useLiveCaptions() {
  useEffect(() => {
    let queue: LiveEvent[] = []
    let timer = 0
    let showing = false
    let radioTimer = 0

    const advance = () => {
      window.clearTimeout(timer)
      const next = radioOnAir() ? undefined : queue.shift()
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
      // The radio has the floor; the log still records everything.
      if (radioOnAir()) return
      // Emergencies jump the queue; a backlog keeps only the latest few.
      queue = [...fresh.filter((e) => e.kind === 'emergency'), ...queue, ...fresh.filter((e) => e.kind !== 'emergency')].slice(-4)
      if (!showing) advance()
    })

    // Radio calls: each one replaces the last, then fades after a while.
    const unsubscribeRadio = useRadio.subscribe((r, prev) => {
      if (r.caption !== prev.caption && r.caption && r.caption.id !== prev.caption?.id) {
        // A tower-log caption steps aside for the radio.
        if (usePlayhead.getState().caption) {
          queue = []
          showing = false
          window.clearTimeout(timer)
          usePlayhead.getState().setCaption(null)
        }
        window.clearTimeout(radioTimer)
        const id = r.caption.id
        radioTimer = window.setTimeout(() => {
          if (useRadio.getState().caption?.id === id) useRadio.getState().patch({ caption: null })
        }, RADIO_LINGER_MS)
      }
      if (r.on !== prev.on && !r.on) window.clearTimeout(radioTimer)
    })

    return () => {
      unsubscribe()
      unsubscribeRadio()
      window.clearTimeout(timer)
      window.clearTimeout(radioTimer)
    }
  }, [])
}
