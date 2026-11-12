/**
 * Text that settles instead of jumping: a newly heard call's words resolving
 * one by one, a status line swapping its words, a "processing" line with a
 * quiet sweep, content taking over from its skeleton. The CSS side is in
 * index.css (`.stream-word`, `.shimmer-text`, `.reveal-*`); the timings are
 * the app's motion tokens. Reduced motion (the OS or the in-app setting)
 * shows every change at once.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { DURATION, reducedMotion, useReducedMotion } from './motion'
import { usePresence } from './usePresence'

/** Ids already streamed in, so a call resolves once however often its row is redrawn or remounted. */
const streamed = new Set<string>()

/**
 * Adapted from Transitions.dev — Streaming text
 *
 * `text`, its words resolving in turn through a soft blur, the first time
 * this `id` is drawn with `play` on; plain text otherwise (history, a
 * remount, reduced motion). Key it by `id` so a different call starts afresh.
 */
export function StreamText({ text, id, play = true }: { text: string; id: string; play?: boolean }) {
  const [animate] = useState(() => play && !streamed.has(id) && !reducedMotion())
  useEffect(() => {
    if (!animate) return
    if (streamed.size > 500) streamed.clear()
    streamed.add(id)
  }, [animate, id])
  if (!animate) return <>{text}</>
  const words = text.split(/\s+/).filter(Boolean)
  // A long call still resolves in under a second.
  const gap = Math.min(45, 900 / Math.max(1, words.length))
  return (
    <span style={{ '--stream-gap': `${gap.toFixed(1)}ms` } as CSSProperties}>
      {words.map((w, i) => (
        <span key={i} className="stream-word" style={{ '--i': i } as CSSProperties}>
          {w}
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  )
}

/**
 * Adapted from Transitions.dev — Text states swap
 *
 * A short status ("Connecting…" → "Live") that, when `swapKey` changes,
 * lifts the old words out of focus and lets the new ones rise into place.
 * While the key stays the same the children update in place, so a
 * countdown ticking inside one state doesn't swap every second.
 */
export function SwapText({ swapKey, children, className = '' }: { swapKey: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduce = useReducedMotion()
  // What was last drawn, and (while it lifts away) what was up before the key changed.
  const [cur, setCur] = useState({ key: swapKey, node: children })
  const [out, setOut] = useState<{ key: string; node: ReactNode } | null>(null)
  if (swapKey !== cur.key) {
    if (!out && !reduce) setOut(cur)
    setCur({ key: swapKey, node: children })
  } else if (children !== cur.node) setCur({ key: swapKey, node: children })
  const entering = useRef(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof el.animate !== 'function') return
    if (out) {
      // Out: the old words lift away, then the new ones take their place.
      const exit = el.animate([{ transform: 'translateY(-4px)', opacity: 0, filter: 'blur(2px)' }], { duration: DURATION.swap, easing: 'cubic-bezier(0.4, 0, 0.7, 0.2)', fill: 'forwards' })
      exit.onfinish = () => {
        entering.current = true
        setOut(null)
      }
      return () => {
        exit.onfinish = null
      }
    }
    if (!entering.current) return
    // In: the new words rise from just below into focus.
    entering.current = false
    el.getAnimations().forEach((a) => a.cancel())
    el.animate([{ transform: 'translateY(4px)', opacity: 0, filter: 'blur(2px)' }, { transform: 'none', opacity: 1, filter: 'none' }], { duration: DURATION.swap + 40, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' })
  }, [out])

  return (
    <span ref={ref} className={`inline-block ${className}`}>
      {out ? out.node : children}
    </span>
  )
}

/**
 * Adapted from Transitions.dev — Thinking states
 *
 * A line with a slow highlight passing over its words, for something being
 * worked on ("Processing call…"). Still, with reduced motion.
 */
export function ShimmerText({ children, className = '' }: { children: string; className?: string }) {
  return (
    <span className={`shimmer-text ${className}`} data-text={children}>
      {children}
    </span>
  )
}

/**
 * Adapted from Transitions.dev — Skeleton loader and reveal
 *
 * The skeleton while `ready` is false; then the content, with the skeleton
 * fading out of focus over it as it comes in. Content that was ready from
 * the start just shows.
 */
export function Reveal({ ready, skeleton, children, className = '' }: { ready: boolean; skeleton: ReactNode; children: ReactNode; className?: string }) {
  const [waited, setWaited] = useState(!ready)
  if (!ready && !waited) setWaited(true)
  const bones = usePresence(!ready, DURATION.reveal)
  return (
    <span className={`reveal-stack ${className}`}>
      {bones.mounted && (
        <span key="bones" className={`block ${ready ? 'reveal-out' : ''}`} aria-hidden={ready || undefined}>
          {skeleton}
        </span>
      )}
      {ready && (
        <span key="content" className={`block ${waited ? 'reveal-in' : ''}`}>
          {children}
        </span>
      )}
    </span>
  )
}
