/**
 * Shared motion vocabulary. The CSS side lives in `index.css` (`--ease-*`,
 * `--duration-*`, `.motion-*` classes); this is the same set for code that
 * animates from script: map camera moves, sheet drags and flicks.
 *
 * Keep the two in step: a sheet that is dragged and let go should land with
 * the same curve as one opened with a tap.
 */
import { useSyncExternalStore } from 'react'
import { useSettings } from '../settings/settingsStore'

/** Durations in milliseconds, mirroring the CSS `--duration-*` tokens. */
export const DURATION = {
  /** Finger down on a control. */
  press: 90,
  /** Hover, colour and small state changes. */
  fast: 160,
  /** Popovers, toasts and pills appearing. */
  base: 240,
  /** Sheets sliding up. */
  sheet: 460,
  /** Sheets and popovers leaving: always quicker than arriving. */
  exit: 220,
} as const

/**
 * A CSS-style cubic Bézier easing as a function of progress, for script-driven
 * animation (MapLibre camera moves take an `easing` function).
 */
export function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  // Polynomial coefficients for x(s) and y(s), s being the curve parameter.
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const x = (s: number) => ((ax * s + bx) * s + cx) * s
  const y = (s: number) => ((ay * s + by) * s + cy) * s
  const dx = (s: number) => (3 * ax * s + 2 * bx) * s + cx
  return (t: number) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    // Newton steps converge in a handful of iterations for any sane curve;
    // bisection catches the flat spots where the slope vanishes.
    let s = t
    for (let i = 0; i < 6; i++) {
      const err = x(s) - t
      if (Math.abs(err) < 1e-6) return y(s)
      const d = dx(s)
      if (Math.abs(d) < 1e-6) break
      s -= err / d
    }
    let lo = 0
    let hi = 1
    s = t
    for (let i = 0; i < 30; i++) {
      const v = x(s)
      if (Math.abs(v - t) < 1e-6) break
      if (v < t) lo = s
      else hi = s
      s = (lo + hi) / 2
    }
    return y(s)
  }
}

/** Camera moves: a soft start and a long, gentle landing, so the map never lurches. */
export const CAMERA_EASE = bezier(0.4, 0, 0.2, 1)
/** Quick moves that respond to a press (zoom buttons, north-up): no wind-up, soft stop. */
export const CAMERA_EASE_OUT = bezier(0.22, 1, 0.36, 1)

/**
 * iOS-style rubber banding: the further past the edge, the less the content
 * follows, approaching `dimension` but never reaching it.
 */
export function rubberband(offset: number, dimension = 140, constant = 0.55): number {
  if (offset === 0) return 0
  const sign = Math.sign(offset)
  const x = Math.abs(offset)
  return sign * (1 - 1 / ((x * constant) / dimension + 1)) * dimension
}

/**
 * Where a flick would carry something if it coasted to a stop, given its
 * release velocity in px/ms. The same projection iOS uses to decide whether
 * a flicked sheet should close.
 */
export function projectMomentum(velocity: number, decelerationRate = 0.99): number {
  // Per-millisecond decay; the geometric series sums to v·r/(1-r).
  return (velocity * decelerationRate) / (1 - decelerationRate)
}

/**
 * How long the rest of a released drag should take: about as long as the
 * finger's speed would need to cover it, so the motion carries on at the
 * same pace instead of slowing down or jumping ahead. Clamped to feel calm.
 */
export function releaseDuration(remainingPx: number, velocity: number, min = 180, max: number = DURATION.sheet): number {
  const speed = Math.abs(velocity)
  if (speed < 0.05) return max
  // The easing curve starts at roughly twice its average speed, hence the factor.
  return Math.round(Math.min(max, Math.max(min, (Math.abs(remainingPx) / speed) * 1.6)))
}

/**
 * Release velocity from the last few pointer samples (px/ms), rather than
 * the whole gesture's average, so a slow drag ending in a flick reads as a
 * flick and a fast drag that stops dead reads as a stop.
 */
export function createVelocityTracker(windowMs = 90) {
  const samples: { t: number; v: number }[] = []
  return {
    add(t: number, v: number) {
      samples.push({ t, v })
      while (samples.length > 2 && t - samples[0].t > windowMs) samples.shift()
    },
    reset() {
      samples.length = 0
    },
    /** px per ms over the recent window; 0 if the pointer has rested. */
    velocity(now?: number): number {
      if (samples.length < 2) return 0
      const last = samples[samples.length - 1]
      // A pause before release cancels the flick.
      if (now != null && now - last.t > 60) return 0
      const first = samples[0]
      const dt = last.t - first.t
      return dt > 0 ? (last.v - first.v) / dt : 0
    },
  }
}

/** True when the user asked for less motion, in the app or in the OS. */
export function reducedMotion(): boolean {
  if (useSettings.getState().reduceMotion) return true
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

const osReduceQuery = () => (typeof matchMedia === 'undefined' ? null : matchMedia('(prefers-reduced-motion: reduce)'))

function subscribeOsReduce(cb: () => void) {
  const q = osReduceQuery()
  q?.addEventListener('change', cb)
  return () => q?.removeEventListener('change', cb)
}

/**
 * `reducedMotion()` as a hook: the in-app setting or the OS preference, and
 * re-renders when either changes. Script-driven motion (camera flights, map
 * animations, caption sweeps) can't see the CSS media query, so it reads this.
 */
export function useReducedMotion(): boolean {
  const setting = useSettings((s) => s.reduceMotion)
  const os = useSyncExternalStore(
    subscribeOsReduce,
    () => !!osReduceQuery()?.matches,
    () => false,
  )
  return setting || os
}

/** A tiny tap of the vibration motor where there is one (Android); silent elsewhere. */
export function haptic(ms = 8) {
  if (reducedMotion() || !useSettings.getState().haptics) return
  try {
    navigator.vibrate?.(ms)
  } catch {
    // Some browsers throw without a user gesture; a missing buzz is fine.
  }
}
