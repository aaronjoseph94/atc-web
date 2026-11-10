/**
 * The session's spotting log for one airport: every aircraft met is scored
 * once (when its type is first known), and the notable ones are kept, newest
 * first, with when they were last in range and which way they were going.
 *
 * Pure bookkeeping, no timers or stores, so it can be tested with plain
 * snapshots; `useSpotter` drives it from the live traffic.
 */
import type { Aircraft } from '../api/types'
import { directionText, fallbackLine, spotDirection, spotName, type Direction } from './notes'
import { normType, scoreRarity, type Rarity } from './rarity'

export type Spot = Rarity & {
  icao24: string
  callsign: string
  type: string | null
  /** Everyday type name ("Boeing 747-8"). */
  name: string
  airport: string
  firstAt: number
  lastAt: number
  direction: Direction
  /** Deterministic "why it's notable" line (the AI may offer a better one). */
  line: string
}

/** Most spots kept per airport and session. */
export const SPOT_LIMIT = 40

export class Spotter {
  readonly airport: string
  readonly elevationFt: number
  /** Type → airframes of that type met this session. */
  private seen = new Map<string, Set<string>>()
  /** Aircraft already judged (with a known type), so a score never changes under the user. */
  private judged = new Set<string>()
  private list: Spot[] = []

  constructor(airport: string, elevationFt = 0) {
    this.airport = airport
    this.elevationFt = elevationFt
  }

  /** Notable aircraft so far, newest first. */
  get spots(): readonly Spot[] {
    return this.list
  }

  /** How many airframes of a type this session has met. */
  seenCount(type: string): number {
    return this.seen.get(type)?.size ?? 0
  }

  /**
   * Take one traffic snapshot. Returns the spots added by it (to announce)
   * and whether anything in the list changed (to re-render).
   */
  scan(list: readonly Aircraft[], now: number): { added: Spot[]; changed: boolean } {
    const added: Spot[] = []
    let changed = false
    const byIcao = new Map(this.list.map((s, i) => [s.icao24, i]))
    for (const a of list) {
      if (a.category?.startsWith('C')) continue
      const at = byIcao.get(a.icao24)
      if (at != null) {
        const s = this.list[at]
        const direction = spotDirection(a, this.elevationFt)
        if (direction !== s.direction || now - s.lastAt > 15_000) {
          this.list[at] = { ...s, lastAt: now, direction, callsign: a.callsign || s.callsign }
          changed = true
        }
        continue
      }
      if (this.judged.has(a.icao24)) continue
      const type = normType(a.type)
      // Wait for the type unless something else (a military callsign, a glider category) already stands out.
      const count = type ? this.seenCount(type) : 0
      const r = scoreRarity(a, this.airport, count)
      if (!type && !r.notable) continue
      this.judged.add(a.icao24)
      if (type) {
        let set = this.seen.get(type)
        if (!set) this.seen.set(type, (set = new Set()))
        set.add(a.icao24)
      }
      if (!r.notable) continue
      const spot: Spot = {
        ...r,
        icao24: a.icao24,
        callsign: a.callsign,
        type,
        name: spotName(type),
        airport: this.airport,
        firstAt: now,
        lastAt: now,
        direction: spotDirection(a, this.elevationFt),
        line: fallbackLine(type, r),
      }
      added.push(spot)
    }
    if (added.length) {
      this.list = [...added.sort((x, y) => y.score - x.score), ...this.list].slice(0, SPOT_LIMIT)
      changed = true
    }
    return { added, changed }
  }
}

/** "Rare: Antonov An-124 Ruslan inbound to ORD". */
export function toastText(s: Pick<Spot, 'name' | 'direction' | 'airport' | 'rare' | 'military'>): string {
  const label = s.military?.vip ? 'VIP' : s.military ? 'Military' : s.rare ? 'Rare' : 'Notable'
  return `${label}: ${s.name} ${directionText(s.direction, s.airport)}`
}

/**
 * Toast pacing: at most one every `gapMs`, and no more than `max` in any
 * `windowMs`. Never the same aircraft twice.
 */
export class ToastGate {
  private times: number[] = []
  private told = new Set<string>()
  private gapMs: number
  private max: number
  private windowMs: number
  constructor(gapMs = 120_000, max = 4, windowMs = 30 * 60_000) {
    this.gapMs = gapMs
    this.max = max
    this.windowMs = windowMs
  }

  allow(icao24: string, now: number): boolean {
    if (this.told.has(icao24)) return false
    this.times = this.times.filter((t) => now - t < this.windowMs)
    const last = this.times[this.times.length - 1]
    if (last != null && now - last < this.gapMs) return false
    if (this.times.length >= this.max) return false
    this.times.push(now)
    this.told.add(icao24)
    return true
  }
}
