/**
 * Timing for the number tickers (`Ticker.tsx`): how a displayed value rolls
 * from the old reading to the new one.
 */

/** How long a roll takes. */
export const TICK_MS = 650

/** Fast at first, settling softly: the way a counter wheel coasts to a stop. */
export const easeOutCubic = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3

/** Where a roll from `from` to `to` is after `elapsed` ms. */
export function tickAt(from: number, to: number, elapsed: number, duration = TICK_MS): number {
  if (elapsed >= duration) return to
  return from + (to - from) * easeOutCubic(elapsed / duration)
}
