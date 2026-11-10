/**
 * Which runways are in use right now, and for what: worked out from what the
 * traffic is doing, with the wind as a fallback when there is too little
 * traffic to tell.
 *
 * Every time an aircraft does something that only makes sense on one runway
 * in one direction (descending on its final approach, accelerating down it,
 * climbing out past its far end, landing or departing per the tower log) it
 * leaves a "sighting" against that runway end, for arrivals or departures.
 * Sightings count fully for five minutes and fade out over the next fifteen,
 * so a runway that stops being used drops off about twenty minutes later.
 * Each aircraft counts at most once per runway and role, however many
 * snapshots it is seen in, so one slow approach can't outvote three landings.
 */
import type { Aircraft } from '../api/types'
import type { RunwayEndGeometry } from '../map/airportDiagram'
import { relativeToRunway } from '../map/airportDiagram'
import { angleDelta, M_PER_NM } from '../map/geo'
import { runwayRelation, type LiveEvent } from './events'

export type UseKind = 'arr' | 'dep'
export type RunwayRole = 'arrivals' | 'departures' | 'both'

type Sighting = { runway: string; kind: UseKind; icao24: string; at: number; weight: number }

/** What we remember about an aircraft between samples, to tell which way its speed and height are going. */
type Trend = {
  speedKt: number | null
  altitudeFt: number | null
  onGround: boolean
  /** Last change in speed (kt) and height (ft) seen, and when; positions repeat between polls. */
  dSpeed: number
  dSpeedAt: number
  dAlt: number
  dAltAt: number
  seenAt: number
}

export type RunwayUseState = {
  /** `icao24|kind|runway` → the strongest recent sighting of that aircraft doing that. */
  sightings: Map<string, Sighting>
  trends: Map<string, Trend>
  /** Tower-log events already counted. */
  events: Set<string>
}

export type RunwayUse = {
  ident: string
  /** Decayed scores: roughly "aircraft in the last few minutes". */
  arrivals: number
  departures: number
  /** Distinct aircraft seen arriving / departing on it in the last twenty minutes. */
  arrivalCount: number
  departureCount: number
  role: RunwayRole | null
}

export type ActiveRunways = {
  /** Runway ends in use (from traffic), or favoured by the wind (`basis: 'wind'`, `role` null). */
  runways: RunwayUse[]
  landing: string[]
  departing: string[]
  /** Into-wind ends, when neither the traffic nor the ATIS says anything. */
  favoured: string[]
  /** Where it comes from: traffic seen now, the ATIS broadcast, or a guess from the wind. */
  basis: 'traffic' | 'atis' | 'wind' | 'none'
}

/** Full weight for this long, then a linear fade to nothing at `FORGET_MS`. */
const HOLD_MS = 5 * 60_000
export const FORGET_MS = 20 * 60_000
/** Decayed score a role needs before a runway is called in use for it. */
const ACTIVE_SCORE = 0.5
/** A speed or height change older than this says nothing about now. */
const TREND_MS = 30_000

const EVENT_WEIGHT: Partial<Record<LiveEvent['kind'], [UseKind, number]>> = {
  landed: ['arr', 1],
  departed: ['dep', 1],
  lineup: ['dep', 0.7],
  // It will come round and land on the same runway.
  goaround: ['arr', 0.6],
}

export function createRunwayUse(): RunwayUseState {
  return { sightings: new Map(), trends: new Map(), events: new Set() }
}

function sight(state: RunwayUseState, s: Sighting) {
  const key = `${s.icao24}|${s.kind}|${s.runway}`
  const prev = state.sightings.get(key)
  // Keep the newest time and the strongest evidence.
  state.sightings.set(key, prev ? { ...s, at: Math.max(prev.at, s.at), weight: Math.max(prev.weight, s.weight) } : s)
}

/** Count tower-log events (landed, departed, lined up, went around). Safe to pass the same events again. */
export function observeEvents(state: RunwayUseState, events: LiveEvent[]) {
  for (const e of events) {
    if (state.events.has(e.id)) continue
    state.events.add(e.id)
    const w = EVENT_WEIGHT[e.kind]
    if (!w || !e.runway) continue
    sight(state, { runway: e.runway, kind: w[0], icao24: e.icao24, at: e.at, weight: w[1] })
  }
}

/** Runway end this airborne aircraft is climbing away from, if it's on the climb-out. */
function climbingOutOf(a: Aircraft, ends: RunwayEndGeometry[], agl: number): string | null {
  if (agl > 2500 || a.headingKnown === false) return null
  let best: string | null = null
  let bestCross = Infinity
  for (const end of ends) {
    if (Math.abs(angleDelta(end.bearing, a.heading)) > 20) continue
    const { along, cross } = relativeToRunway(end, [a.lon, a.lat])
    const beyond = Math.max(0, along - end.lengthM)
    // From the back half of the runway out to three miles past its end, inside a widening corridor.
    if (along < end.lengthM * 0.4 || beyond > 3 * M_PER_NM) continue
    if (Math.abs(cross) > 150 + beyond * 0.12) continue
    if (Math.abs(cross) < bestCross) {
      bestCross = Math.abs(cross)
      best = end.ident
    }
  }
  return best
}

/**
 * Look at one snapshot of the traffic. Call it every few seconds with the
 * latest positions; `now` is epoch milliseconds.
 */
export function observeTraffic(state: RunwayUseState, aircraft: Aircraft[], ends: RunwayEndGeometry[], elevationFt: number, now: number) {
  for (const a of aircraft) {
    // Tugs and follow-me cars carry transponders too.
    if (a.category?.startsWith('C')) continue
    const prev = state.trends.get(a.icao24)
    const t: Trend = prev ?? { speedKt: a.speedKt, altitudeFt: a.altitudeFt, onGround: a.onGround, dSpeed: 0, dSpeedAt: -Infinity, dAlt: 0, dAltAt: -Infinity, seenAt: now }
    if (prev) {
      if (a.speedKt != null && prev.speedKt != null && a.speedKt !== prev.speedKt && a.onGround === prev.onGround) {
        t.dSpeed = a.speedKt - prev.speedKt
        t.dSpeedAt = now
      }
      if (a.altitudeFt != null && prev.altitudeFt != null && a.altitudeFt !== prev.altitudeFt) {
        t.dAlt = a.altitudeFt - prev.altitudeFt
        t.dAltAt = now
      }
    }
    const accel = now - t.dSpeedAt < TREND_MS ? t.dSpeed : 0
    const climb = now - t.dAltAt < TREND_MS ? t.dAlt : 0
    const vr = a.verticalRateFpm
    const rel = runwayRelation(a, ends, elevationFt)
    const recently = (kind: UseKind, runway: string, withinMs: number) => {
      const s = state.sightings.get(`${a.icao24}|${kind}|${runway}`)
      return !!s && now - s.at < withinMs
    }

    if (!a.onGround && rel?.kind === 'final') {
      // On final means coming down: a reported descent, or height lost since the last fix.
      // Over the threshold a level reading is just the flare.
      const descending = vr != null ? vr <= -150 || (rel.distanceNm < 1.5 && vr <= 200) : climb < 0
      if (descending) sight(state, { runway: rel.runway, kind: 'arr', icao24: a.icao24, at: now, weight: Math.max(0.6, 0.95 - rel.distanceNm * 0.045) })
    } else if (!a.onGround && a.altitudeFt != null) {
      const climbing = vr != null ? vr >= 300 : climb > 0
      const rwy = climbing ? climbingOutOf(a, ends, a.altitudeFt - elevationFt) : null
      if (rwy && !recently('arr', rwy, 3 * 60_000)) sight(state, { runway: rwy, kind: 'dep', icao24: a.icao24, at: now, weight: 0.9 })
    } else if (a.onGround && rel?.kind === 'on' && a.headingKnown !== false) {
      const speed = a.speedKt ?? 0
      const justLanded = recently('arr', rel.runway, 4 * 60_000) || (prev != null && !prev.onGround)
      if (speed >= 40 && accel > 2 && !justLanded) {
        // Picking up speed down the runway: a takeoff roll.
        sight(state, { runway: rel.runway, kind: 'dep', icao24: a.icao24, at: now, weight: 1 })
      } else if (speed >= 30 && (accel < -2 || (prev != null && !prev.onGround))) {
        // Slowing down fast on the runway: a landing roll.
        sight(state, { runway: rel.runway, kind: 'arr', icao24: a.icao24, at: now, weight: 0.9 })
      } else if (speed < 5 && prev?.onGround && !justLanded) {
        // Stopped on the runway pointing down it: lined up and waiting. (Taxiing
        // along a runway moves faster than this, so it isn't mistaken for a lineup.)
        sight(state, { runway: rel.runway, kind: 'dep', icao24: a.icao24, at: now, weight: 0.6 })
      }
    }

    t.speedKt = a.speedKt
    t.altitudeFt = a.altitudeFt
    t.onGround = a.onGround
    t.seenAt = now
    state.trends.set(a.icao24, t)
  }
  for (const [id, t] of state.trends) if (now - t.seenAt > 120_000) state.trends.delete(id)
  for (const [key, s] of state.sightings) if (now - s.at > FORGET_MS) state.sightings.delete(key)
}

/** How much a sighting still counts: fully for five minutes, then fading to zero at twenty. */
export function decay(ageMs: number): number {
  if (ageMs <= HOLD_MS) return 1
  return Math.max(0, 1 - (ageMs - HOLD_MS) / (FORGET_MS - HOLD_MS))
}

/** Runway designators in reading order: `4L 4R 9L 22R 27C`. */
export function sortIdents(list: string[]): string[] {
  return [...list].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

/** The other end of the same runway. `runwayEnds` lists the two ends of each runway one after the other. */
export function oppositeEnds(ends: RunwayEndGeometry[]): Map<string, string> {
  const out = new Map<string, string>()
  for (let i = 0; i + 1 < ends.length; i += 2) {
    out.set(ends[i].ident, ends[i + 1].ident)
    out.set(ends[i + 1].ident, ends[i].ident)
  }
  return out
}

/** Headwind along a runway end, knots (negative = tailwind). */
function headwind(end: RunwayEndGeometry, wind: Wind): number {
  return Math.cos((angleDelta(end.bearing, wind.windDirDeg ?? 0) * Math.PI) / 180) * (wind.windKt ?? 0)
}

type Wind = { windDirDeg: number | null; windKt: number | null }

/**
 * The runways in use now. With no telling traffic, falls back to what the
 * ATIS announces (`basis: 'atis'`), and failing that to the ends the wind
 * favours (`basis: 'wind'`), which is what the tower would most likely pick
 * but is labelled as a guess.
 */
export function activeRunways(
  state: RunwayUseState,
  ends: RunwayEndGeometry[],
  now: number,
  wind?: Wind | null,
  atis?: { landing: string[]; departing: string[] } | null,
): ActiveRunways {
  const score = new Map<string, RunwayUse>()
  const known = new Set(ends.map((e) => e.ident))
  for (const s of state.sightings.values()) {
    if (!known.has(s.runway)) continue
    const k = decay(now - s.at)
    if (k <= 0) continue
    const r = score.get(s.runway) ?? { ident: s.runway, arrivals: 0, departures: 0, arrivalCount: 0, departureCount: 0, role: null }
    if (s.kind === 'arr') {
      r.arrivals += s.weight * k
      r.arrivalCount++
    } else {
      r.departures += s.weight * k
      r.departureCount++
    }
    score.set(s.runway, r)
  }

  // Both ends of one runway lit up is usually a misreading; keep the busier
  // end, or the into-wind one when they are close and the wind is decisive.
  const opposite = oppositeEnds(ends)
  const total = (r: RunwayUse | undefined) => (r ? r.arrivals + r.departures : 0)
  const strong = wind?.windDirDeg != null && (wind.windKt ?? 0) >= 6
  for (const r of [...score.values()]) {
    const other = score.get(opposite.get(r.ident) ?? '')
    if (!other) continue
    const mine = total(r)
    const theirs = total(other)
    if (mine < theirs * 0.5) score.delete(r.ident)
    else if (mine <= theirs && theirs < mine * 2 && strong) {
      const end = ends.find((e) => e.ident === r.ident)
      if (end && headwind(end, wind!) < -3) score.delete(r.ident)
    }
  }

  const runways: RunwayUse[] = []
  for (const r of score.values()) {
    const arr = r.arrivals >= ACTIVE_SCORE
    const dep = r.departures >= ACTIVE_SCORE
    if (!arr && !dep) continue
    runways.push({ ...r, role: arr && dep ? 'both' : arr ? 'arrivals' : 'departures' })
  }
  if (runways.length) {
    const byIdent = (list: RunwayUse[]) => sortIdents(list.map((r) => r.ident))
    return {
      runways: runways.sort((a, b) => a.ident.localeCompare(b.ident, 'en', { numeric: true })),
      landing: byIdent(runways.filter((r) => r.role !== 'departures')),
      departing: byIdent(runways.filter((r) => r.role !== 'arrivals')),
      favoured: [],
      basis: 'traffic',
    }
  }

  if (atis && (atis.landing.length || atis.departing.length)) {
    const idents = sortIdents([...new Set([...atis.landing, ...atis.departing])])
    const announced = idents.map((ident): RunwayUse => {
      const arr = atis.landing.includes(ident)
      const dep = atis.departing.includes(ident)
      return { ident, arrivals: 0, departures: 0, arrivalCount: 0, departureCount: 0, role: arr && dep ? 'both' : arr ? 'arrivals' : 'departures' }
    })
    return { runways: announced, landing: sortIdents(atis.landing), departing: sortIdents(atis.departing), favoured: [], basis: 'atis' }
  }

  // Too quiet to tell: aircraft land and take off into the wind, so the
  // longest runways pointing most nearly into it are the likely ones.
  if (wind?.windDirDeg != null && (wind.windKt ?? 0) >= 3) {
    const winds = ends.map((e) => ({ e, h: headwind(e, wind) }))
    const best = Math.max(...winds.map((w) => w.h))
    const margin = Math.max(2, (wind.windKt ?? 0) * 0.2)
    const favoured = winds
      .filter((w) => w.h > 0 && w.h >= best - margin)
      .sort((a, b) => b.e.lengthM - a.e.lengthM)
      .slice(0, 4)
      .map((w) => w.e.ident)
    if (favoured.length) {
      return {
        runways: favoured.map((ident) => ({ ident, arrivals: 0, departures: 0, arrivalCount: 0, departureCount: 0, role: null })),
        landing: [],
        departing: [],
        favoured: sortIdents(favoured),
        basis: 'wind',
      }
    }
  }
  return { runways: [], landing: [], departing: [], favoured: [], basis: 'none' }
}

const ARR_WORD = /^(ARR|ARRS|ARRIVAL|ARRIVALS|ARRIVING|APCH|APCHS|APPROACH|APPROACHES|LDG|LNDG|LANDING|ILS|RNAV|VISUAL)$/
const DEP_WORD = /^(DEP|DEPS|DEPG|DEPTG|DEPARTING|DEPARTURE|DEPARTURES|TKOF|TAKEOFF)$/
const RWY_WORD = /^(RWY|RWYS|RY|RYS|RUNWAY|RUNWAYS)(\d{1,2}[LRC]?)?$/
const IDENT = /^0?(\d{1,2}[LRC]?)$/
/** A clause saying a runway (or its lights, or its ILS) is not usable. */
const UNUSABLE = /\b(CLSD|CLOSED|OTS|NA|U\/S|UNAVBL|UNUSABLE|NOT IN USE)\b/

/**
 * Runways the ATIS says are in use: `VISUAL APPROACH RWY 26L`, `DEPG RWYS,
 * 26L, 28`, `APPROACH IN USE ILS RY 31L`. A word like APCH or DEPG sets what
 * the runways named after it (in the same sentence) are for. Runways in a
 * clause that calls them closed or out of service are skipped, and only
 * runways that exist at the airport are kept, so NOTAM chatter can't add any.
 */
export function runwaysFromAtis(texts: string[], ends: RunwayEndGeometry[]): { landing: string[]; departing: string[] } {
  const known = new Map(ends.map((e) => [e.ident.replace(/^0/, ''), e.ident]))
  const landing = new Set<string>()
  const departing = new Set<string>()
  for (const text of texts) {
    for (const sentence of text.toUpperCase().split(/\.(?:\s|$)/)) {
      let mode: UseKind | null = null
      let listing = false
      for (const clause of sentence.split(',')) {
        const unusable = UNUSABLE.test(clause)
        for (const word of clause.trim().split(/\s+/)) {
          if (ARR_WORD.test(word)) mode = 'arr'
          else if (DEP_WORD.test(word)) mode = 'dep'
          const rwy = RWY_WORD.exec(word)
          const ident = rwy ? rwy[2] : listing ? IDENT.exec(word)?.[1] : undefined
          if (rwy) listing = true
          else if (!ident && word !== 'AND' && word !== '&' && word !== '') listing = false
          if (!ident || !mode || unusable) continue
          const id = known.get(ident.replace(/^0/, ''))
          if (id) (mode === 'arr' ? landing : departing).add(id)
        }
      }
    }
  }
  return { landing: sortIdents([...landing]), departing: sortIdents([...departing]) }
}

/** One line for the weather panel: `Landing 22L 22R · Departing 22R 31L`, or the wind's guess. */
export function summariseRunwayUse(a: ActiveRunways | null | undefined): string | null {
  if (!a) return null
  if (a.basis === 'wind') return `Wind favours ${a.favoured.join(' ')}`
  const parts = [a.landing.length ? `Landing ${a.landing.join(' ')}` : '', a.departing.length ? `Departing ${a.departing.join(' ')}` : ''].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}
