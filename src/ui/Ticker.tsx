/**
 * A number that rolls to its new value instead of jumping: speed, altitude
 * and climb rate on the flight card and in the detail view.
 *
 * The value eases from wherever it is showing to the new one (a fresh value
 * mid-roll carries on from there), formatted on every frame with the same
 * formatter the static text uses, in tabular figures so the digits don't
 * jostle. Frames are written straight into the DOM, so a roll costs no React
 * renders. Screen readers get the settled value only. Reduced motion, the
 * first appearance and a missing value all show the value at once.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { reducedMotion } from './motion'
import { tickAt } from './tick'

type Props = {
  value: number | null | undefined
  /** Turns a number (or a missing one) into the text shown, e.g. `formatAltitude`. */
  format: (v: number | null | undefined) => string
  className?: string
}

export function Ticker({ value, format, className }: Props) {
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
