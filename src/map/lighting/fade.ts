/**
 * A value easing from one level to another over a fixed time, restartable
 * from wherever it is when the goal changes mid-way. Pure, so it can be
 * tested without a clock.
 */

/** A full day-to-night change takes this long. */
export const FADE_MS = 2000

export type Fade = { from: number; to: number; start: number; duration: number }

/**
 * Start a fade from `current` to `to` at time `now`. Small steps (the sun
 * moving a little between checks) take proportionally less time, but never
 * so little that they look like a jump.
 */
export function startFade(current: number, to: number, now: number, fullMs = FADE_MS): Fade {
  const span = Math.abs(to - current)
  return { from: current, to, start: now, duration: span === 0 ? 0 : Math.max(fullMs * 0.3, fullMs * Math.min(1, span)) }
}

/** Value of a fade at `now`, eased in and out. */
export function fadeValue(f: Fade, now: number): number {
  if (f.duration <= 0 || now >= f.start + f.duration) return f.to
  const x = Math.max(0, (now - f.start) / f.duration)
  const e = x * x * (3 - 2 * x)
  return f.from + (f.to - f.from) * e
}

export function fadeDone(f: Fade, now: number): boolean {
  return f.duration <= 0 || now >= f.start + f.duration
}
