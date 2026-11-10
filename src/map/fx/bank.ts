/**
 * Banking: aircraft lean into turns. The turn rate comes from how fast the
 * drawn heading is changing (already smooth, see `livePositions.ts`); the
 * bank angle is what a coordinated turn at that speed needs, and it is shown
 * by switching to one of two pre-drawn banked versions of the artwork.
 */

/** Bank angles (degrees) at which the slight and the steep banked drawings take over, and the margin before letting go again. */
export const BANK_STEPS = [6, 16] as const
const BANK_HYSTERESIS = 2.5
/** Turn rate smoothing time constant: a bank builds and rolls out over about a second, like the real thing. */
const RATE_TAU_MS = 900
const MAX_BANK = 35
const G = 9.81

/** Bank angle, degrees, of a coordinated turn at `rateDps` (degrees per second) and `speedKt`. Positive = right wing down. */
export function bankAngle(rateDps: number, speedKt: number): number {
  const v = Math.max(0, speedKt) * 0.5144
  const w = (rateDps * Math.PI) / 180
  const deg = (Math.atan((v * w) / G) * 180) / Math.PI
  return Math.max(-MAX_BANK, Math.min(MAX_BANK, deg))
}

/** Which banked drawing to show: 0 level, ±1 slight, ±2 steep (sign = direction), with hysteresis against flicker. */
export function bankLevel(bankDeg: number, previous: number): number {
  const mag = Math.abs(bankDeg)
  const dir = Math.sign(bankDeg)
  const prevMag = Math.sign(previous) === dir ? Math.abs(previous) : 0
  let level = 0
  for (let i = 0; i < BANK_STEPS.length; i++) {
    // Stepping up needs the full threshold; holding a level only needs to stay within the margin below it.
    const need = prevMag >= i + 1 ? BANK_STEPS[i] - BANK_HYSTERESIS : BANK_STEPS[i]
    if (mag >= need) level = i + 1
  }
  return level * dir
}

type Entry = { hdg: number; t: number; rate: number; level: number; seen: number }

/** Follows each aircraft's drawn heading from frame to frame. */
export class TurnTracker {
  private entries = new Map<string, Entry>()
  private sweptAt = 0

  /** Feed this frame's heading; returns the bank level to draw (0, ±1, ±2). */
  update(id: string, heading: number, speedKt: number, airborne: boolean, tMs: number): number {
    let e = this.entries.get(id)
    if (!e) {
      e = { hdg: heading, t: tMs, rate: 0, level: 0, seen: tMs }
      this.entries.set(id, e)
      return 0
    }
    const dt = tMs - e.t
    e.seen = tMs
    if (dt <= 0) return e.level
    // A long gap (tab in the background) says nothing about the turn.
    if (dt > 1000) {
      e.hdg = heading
      e.t = tMs
      e.rate = 0
      e.level = 0
      return 0
    }
    const d = ((heading - e.hdg + 540) % 360) - 180
    const raw = (d * 1000) / dt
    const k = 1 - Math.exp(-dt / RATE_TAU_MS)
    e.rate += (raw - e.rate) * k
    e.hdg = heading
    e.t = tMs
    e.level = airborne ? bankLevel(bankAngle(e.rate, speedKt), e.level) : 0
    return e.level
  }

  /** Forget aircraft not seen for a while (call now and then). */
  sweep(tMs: number) {
    if (tMs - this.sweptAt < 5000) return
    this.sweptAt = tMs
    for (const [id, e] of this.entries) if (tMs - e.seen > 5000) this.entries.delete(id)
  }

  clear() {
    this.entries.clear()
  }
}
