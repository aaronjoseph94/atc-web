/**
 * Turns successive live traffic snapshots into a tower log: who departed,
 * who landed, who went around, and on which runway.
 *
 * There is no radio in the free feeds, so this is the next best thing: the
 * same events a controller would have just talked about, worked out from
 * positions alone and stated as facts ("landed runway 27C"), never as quotes.
 */
import type { Aircraft } from '../api/types'
import { friendlyFlightName } from '../flight/describe'
import { relativeToRunway, type RunwayEndGeometry } from '../map/airportDiagram'
import { angleDelta, M_PER_FT, M_PER_NM } from '../map/geo'

export type LiveEventKind = 'departed' | 'landed' | 'goaround' | 'lineup' | 'emergency'

export type LiveEvent = {
  id: string
  /** Epoch milliseconds. */
  at: number
  kind: LiveEventKind
  icao24: string
  callsign: string
  /** Runway designator as painted, when one could be matched. */
  runway: string | null
  /** Plain sentence for captions and the log. */
  text: string
  lon: number
  lat: number
}

/** What we remember about each aircraft between snapshots. */
type Memory = {
  onGround: boolean
  /** Runway end the aircraft was last established on final for. */
  finalFor: string | null
  /** Lowest height above the field seen on that final, feet. */
  lowestAglFt: number
  /** Was reported lined up (so we don't repeat it every poll). */
  linedUp: string | null
  /** Already announced as an emergency. */
  alerted: boolean
  /** When it last touched down, so a landing roll isn't mistaken for lining up. */
  landedAt: number
  seenAt: number
}

export type EventState = Map<string, Memory>

/** How an aircraft currently relates to the runways. */
export type RunwayRelation =
  | { kind: 'final'; runway: string; distanceNm: number }
  | { kind: 'on'; runway: string }
  | null

/** How long after touchdown an aircraft on a runway is assumed to still be vacating it. */
const LANDING_ROLL_MS = 4 * 60_000

const EMERGENCY_SQUAWKS: Record<string, string> = {
  '7500': 'is squawking 7500 (unlawful interference)',
  '7600': 'is squawking 7600 (radio failure)',
  '7700': 'is squawking 7700 (general emergency)',
}

/**
 * Which runway is this aircraft using? On the ground: the runway it is
 * physically on and aligned with. In the air: the runway it is lined up with
 * on final, low and close enough to plausibly be landing.
 */
export function runwayRelation(a: Aircraft, ends: RunwayEndGeometry[], elevationFt: number): RunwayRelation {
  let best: RunwayRelation = null
  let bestScore = Infinity
  for (const end of ends) {
    if (a.headingKnown !== false && Math.abs(angleDelta(end.bearing, a.heading)) > 20) continue
    const { along, cross } = relativeToRunway(end, [a.lon, a.lat])
    if (a.onGround) {
      if (along > -60 && along < end.lengthM + 60 && Math.abs(cross) < end.widthM / 2 + 12) {
        const score = Math.abs(cross)
        if (score < bestScore) {
          bestScore = score
          best = { kind: 'on', runway: end.ident }
        }
      }
      continue
    }
    const agl = (a.altitudeFt ?? Infinity) - elevationFt
    const out = -along
    // Inside 8 nm, within a widening cone of the centreline, and not above a ~4.5° path.
    if (out > 0 && out < 8 * M_PER_NM && Math.abs(cross) < 120 + out * 0.07 && agl < 600 + (out / M_PER_NM) * 480) {
      const score = Math.abs(cross) + out * 0.02
      if (score < bestScore) {
        bestScore = score
        best = { kind: 'final', runway: end.ident, distanceNm: out / M_PER_NM }
      }
    }
  }
  return best
}

/** Runway whose pavement or first mile of climb-out contains the point, regardless of heading. */
function nearestRunway(a: Aircraft, ends: RunwayEndGeometry[]): string | null {
  let best: string | null = null
  let bestCross = Infinity
  for (const end of ends) {
    if (Math.abs(angleDelta(end.bearing, a.heading)) > 30) continue
    const { along, cross } = relativeToRunway(end, [a.lon, a.lat])
    if (along > -200 && along < end.lengthM + 1.5 * M_PER_NM && Math.abs(cross) < 250 && Math.abs(cross) < bestCross) {
      bestCross = Math.abs(cross)
      best = end.ident
    }
  }
  return best
}

const on = (runway: string | null, prefix = ' runway ') => (runway ? `${prefix}${runway}` : '')

/**
 * Compare a snapshot with what we remembered and report what happened.
 * Mutates and returns `state`; `now` is epoch milliseconds.
 */
export function detectEvents(
  state: EventState,
  aircraft: Aircraft[],
  ends: RunwayEndGeometry[],
  elevationFt: number,
  now: number,
): LiveEvent[] {
  const events: LiveEvent[] = []
  const emit = (kind: LiveEventKind, a: Aircraft, runway: string | null, text: string) =>
    events.push({ id: `${a.icao24}-${kind}-${now}`, at: now, kind, icao24: a.icao24, callsign: a.callsign, runway, text, lon: a.lon, lat: a.lat })

  for (const a of aircraft) {
    // Tugs and follow-me cars carry transponders too; they don't take off.
    if (a.category?.startsWith('C')) continue
    const name = friendlyFlightName(a.callsign)
    const rel = runwayRelation(a, ends, elevationFt)
    const agl = a.altitudeFt == null ? null : a.altitudeFt - elevationFt
    const prev = state.get(a.icao24)
    const mem: Memory = prev ?? { onGround: a.onGround, finalFor: null, lowestAglFt: Infinity, linedUp: null, alerted: false, landedAt: -Infinity, seenAt: now }

    const emergency = (a.squawk && EMERGENCY_SQUAWKS[a.squawk]) || (a.emergency ? `has declared an emergency (${a.emergency})` : null)
    if (emergency && !mem.alerted) {
      mem.alerted = true
      emit('emergency', a, null, `${name} ${emergency}.`)
    } else if (!emergency) mem.alerted = false

    if (prev) {
      // Wheels up: was on the ground, now airborne and moving like an aircraft.
      if (prev.onGround && !a.onGround && (a.speedKt ?? 0) > 70) {
        const rwy = nearestRunway(a, ends)
        emit('departed', a, rwy, `${name} took off${on(rwy, ' from runway ')}.`)
        mem.linedUp = null
      }
      // Wheels down: was airborne, now on the ground on (or just off) a runway.
      if (!prev.onGround && a.onGround) {
        const rwy = rel?.kind === 'on' ? rel.runway : (prev.finalFor ?? nearestRunway(a, ends))
        emit('landed', a, rwy, `${name} landed${on(rwy, ' on runway ')}.`)
        mem.finalFor = null
        mem.lowestAglFt = Infinity
        mem.landedAt = now
      }
      // Go-around: got low on short final, never touched down, now climbing away.
      if (!a.onGround && prev.finalFor && agl != null && prev.lowestAglFt < 700 && agl > prev.lowestAglFt + 500 && (a.verticalRateFpm ?? 0) > 500) {
        emit('goaround', a, prev.finalFor, `${name} went around${on(prev.finalFor, ' at runway ')} and is climbing away.`)
        mem.finalFor = null
        mem.lowestAglFt = Infinity
      }
      // Lined up: stationary or slow on a runway, pointing down it, and not
      // simply rolling out after landing (which looks the same for a moment).
      if (a.onGround && rel?.kind === 'on' && (a.speedKt ?? 0) < 25 && prev.onGround && mem.linedUp !== rel.runway && a.headingKnown !== false && now - mem.landedAt > LANDING_ROLL_MS) {
        mem.linedUp = rel.runway
        emit('lineup', a, rel.runway, `${name} is lined up on runway ${rel.runway}.`)
      }
    }

    if (!a.onGround && rel?.kind === 'final' && (a.verticalRateFpm ?? -1) <= 200) {
      if (mem.finalFor !== rel.runway) mem.lowestAglFt = Infinity
      mem.finalFor = rel.runway
      if (agl != null) mem.lowestAglFt = Math.min(mem.lowestAglFt, agl)
    }
    if (a.onGround && rel?.kind !== 'on') mem.linedUp = null

    mem.onGround = a.onGround
    mem.seenAt = now
    state.set(a.icao24, mem)
  }

  // Forget aircraft that left the area a while ago.
  for (const [id, mem] of state) if (now - mem.seenAt > 120_000) state.delete(id)
  return events
}

/** Sentence fragment for the flight card: what this aircraft is doing relative to the runways. */
export function describeRelation(rel: RunwayRelation, a: Aircraft, elevationFt: number): string | null {
  if (!rel) return null
  if (rel.kind === 'on') {
    const speed = a.speedKt ?? 0
    if (speed > 60) return `Rolling on runway ${rel.runway}`
    return `On runway ${rel.runway}`
  }
  const agl = a.altitudeFt == null ? null : Math.max(0, a.altitudeFt - elevationFt)
  const dist = rel.distanceNm < 1 ? 'under a mile' : `${rel.distanceNm.toFixed(1)} nm`
  return `On final for runway ${rel.runway}, ${dist} out${agl != null ? `, ${Math.round(agl / 50) * 50} ft above the field` : ''}`
}

/** Runways in use lately, from the log: where aircraft have been landing and departing. */
export function runwaysInUse(events: LiveEvent[], sinceMs: number): { landing: string[]; departing: string[] } {
  const count = (kind: LiveEventKind) => {
    const tally = new Map<string, number>()
    for (const e of events) if (e.kind === kind && e.runway && e.at >= sinceMs) tally.set(e.runway, (tally.get(e.runway) ?? 0) + 1)
    return [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r)
  }
  return { landing: count('landed'), departing: count('departed') }
}

export const FEET_PER_METRE = 1 / M_PER_FT
