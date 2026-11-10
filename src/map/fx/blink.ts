/**
 * Light timing, as pure functions of the clock so they can be tested and so
 * every aircraft can run its own phase (a sky full of strobes flashing in
 * unison looks fake).
 *
 * Real patterns: wingtip strobes double-flash about once every 1.2 s; the red
 * anti-collision beacon flashes roughly 50 times a minute.
 */

export const STROBE_PERIOD_MS = 1200
/** Each flash is held a few frames: shorter flashes get lost between map redraws. */
const STROBE_FLASH_MS = 70
const STROBE_GAP_MS = 110
export const BEACON_PERIOD_MS = 1150
const BEACON_ON_MS = 190

/** A stable per-aircraft phase in [0, 1) from its address, so its lights don't all fire with everyone else's. */
export function phaseOf(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 997) / 997
}

/** Is the strobe lit at `tMs`? Two quick flashes per period. */
export function strobeOn(tMs: number, phase: number): boolean {
  const x = (((tMs + phase * STROBE_PERIOD_MS) % STROBE_PERIOD_MS) + STROBE_PERIOD_MS) % STROBE_PERIOD_MS
  return x < STROBE_FLASH_MS || (x >= STROBE_FLASH_MS + STROBE_GAP_MS && x < 2 * STROBE_FLASH_MS + STROBE_GAP_MS)
}

/** Is the beacon lit at `tMs`? One longer flash per period, out of step with the strobes. */
export function beaconOn(tMs: number, phase: number): boolean {
  const x = (((tMs + (phase * 0.61 + 0.37) * BEACON_PERIOD_MS) % BEACON_PERIOD_MS) + BEACON_PERIOD_MS) % BEACON_PERIOD_MS
  return x < BEACON_ON_MS
}
