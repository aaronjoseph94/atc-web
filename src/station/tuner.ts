/** Layout and snapping for the frequency dial on the flight card. */
import type { Station } from '../api/types'

/** Pixels between two channels on the dial. */
export const GAP = 78
/** The channels on the dial: ones with a frequency, low to high, one per frequency. */
export function tunerStops(stations: Station[]): Station[] {
  const seen = new Set<number>()
  return stations
    .filter((s) => s.frequencyMhz != null)
    .sort((a, b) => a.frequencyMhz! - b.frequencyMhz!)
    .filter((s) => {
      const key = Math.round(s.frequencyMhz! * 1000)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/** Index of the stop the dial settles on after being dragged `dx` pixels from `from`. */
export function settle(from: number, dx: number, velocity: number, count: number): number {
  // A flick carries on a little further than the finger went.
  const travel = -(dx + velocity * 160) / GAP
  return Math.max(0, Math.min(count - 1, Math.round(from + travel)))
}
