/**
 * A number that changes without jumping. Two ways:
 *
 * - `roll` (the default): speed, altitude and climb rate on the flight card
 *   and in the detail view, which count through to their new value.
 * - `digits`: counts that step (aircraft in view, traffic counters, a tab's
 *   badge), where only the digits that changed drift out and in, up when the
 *   number rose and down when it fell (see `.digit-*` in index.css).
 *
 * Roll:
 *
 * The value eases from wherever it is showing to the new one (a fresh value
 * mid-roll carries on from there), formatted on every frame with the same
 * formatter the static text uses, in tabular figures so the digits don't
 * jostle. Frames are written straight into the DOM, so a roll costs no React
 * renders. Screen readers get the settled value only. Reduced motion, the
 * first appearance and a missing value all show the value at once.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { reducedMotion, useReducedMotion } from './motion'
import { tickAt } from './tick'

type Props = {
  value: number | null | undefined
  /** Turns a number (or a missing one) into the text shown, e.g. `formatAltitude`. */
  format: (v: number | null | undefined) => string
  className?: string
  /** `roll` counts through the values between; `digits` changes only the digits that differ. */
  variant?: 'roll' | 'digits'
}

export function Ticker({ variant = 'roll', ...props }: Props) {
  return variant === 'digits' ? <Digits {...props} /> : <Roll {...props} />
}

function Roll({ value, format, className }: Omit<Props, 'variant'>) {
  const ref = useRef<HTMLSpanElement>(null)
  const shown = useRef<number | null | undefined>(value)
  const fmt = useRef(format)
  const [initial] = useState(() => format(value))
  const text = format(value)

  useLayoutEffect(() => {
    fmt.current = format
  })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const from = shown.current
    // Nothing to roll from or to, or nothing visible would change: just show it.
    if (value == null || from == null || !Number.isFinite(from) || reducedMotion() || fmt.current(from) === fmt.current(value)) {
      shown.current = value
      el.textContent = text
      return
    }
    const start = performance.now()
    let raf = 0
    const step = () => {
      const v = tickAt(from, value, performance.now() - start)
      shown.current = v
      el.textContent = fmt.current(v)
      if (v !== value) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // A new unit or format shows at once (through `text`); the roll only follows the value.
  }, [value, text])

  return (
    <span className={`tabular-nums ${className ?? ''}`}>
      <span ref={ref} aria-hidden>
        {initial}
      </span>
      <span className="sr-only">{text}</span>
    </span>
  )
}

/*
 * Adapted from Transitions.dev — Number subtle change
 * Each changed digit gets a slot holding the old digit and the new one;
 * digits that stayed the same are plain text. A change of length (9 → 10)
 * brings every digit in, with nothing to swap out.
 */
function Digits({ value, format, className }: Omit<Props, 'variant'>) {
  const text = format(value)
  const reduce = useReducedMotion()
  const [st, setSt] = useState({ text, value, prev: null as string | null, dir: 1, n: 0 })
  if (text !== st.text) setSt({ text, value, prev: reduce ? null : st.text, dir: (value ?? 0) >= (st.value ?? 0) ? 1 : -1, n: st.n + 1 })
  const prev = st.prev
  const same = prev != null && prev.length === text.length
  return (
    <span className={`tabular-nums ${className ?? ''}`}>
      {/* A new key on every change restarts the animations. */}
      <span key={st.n} aria-hidden style={{ '--dir': st.dir } as CSSProperties}>
        {prev == null
          ? text
          : text.split('').map((ch, i) =>
              same && prev[i] === ch ? (
                ch
              ) : (
                <span key={i} className="digit-slot">
                  {same && <span className="digit-old">{prev[i]}</span>}
                  <span className="digit-new">{ch}</span>
                </span>
              ),
            )}
      </span>
      <span className="sr-only">{text}</span>
    </span>
  )
}
