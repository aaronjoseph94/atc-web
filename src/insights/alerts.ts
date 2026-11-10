/**
 * Smart alerts: a small rules engine that notices the unusual (go-arounds,
 * emergencies, rejected takeoffs, the runways turning around, diversions)
 * in the tower log, the radio transcripts and the traffic itself, and
 * decides which of those are worth interrupting someone for.
 *
 * Pure: the runner (alertsRunner.ts) feeds it and shows what it admits.
 * Repeats are merged (a go-around seen in the traffic and heard on the radio
 * is one alert) and bursts are rate-limited, so it never spams.
 */
import type { Aircraft } from '../api/types'
import { friendlyFlightName } from '../flight/describe'
import { runwayRelation, type LiveEvent } from '../live/events'
import type { RunwayEndGeometry } from '../map/airportDiagram'
import type { AlertKind } from './insightSettings'

export type Alert = {
  id: string
  kind: AlertKind
  at: number
  icao24: string | null
  callsign: string | null
  runway: string | null
  title: string
  body: string
  /** What noticed it first. */
  source: 'traffic' | 'radio'
  /** How many reports were merged into it. */
  count: number
  /** The radio words that raised or confirmed it. */
  quote?: string
}

export type AlertInput = Omit<Alert, 'id' | 'count'>

// ---------------------------------------------------------------------------
// Rules: tower-log events
// ---------------------------------------------------------------------------

export function fromEvent(e: LiveEvent): AlertInput | null {
  const name = friendlyFlightName(e.callsign)
  if (e.kind === 'goaround') return { kind: 'goaround', at: e.at, icao24: e.icao24, callsign: e.callsign, runway: e.runway, title: `Go-around: ${name}`, body: e.text, source: 'traffic' }
  if (e.kind === 'emergency') return { kind: 'emergency', at: e.at, icao24: e.icao24, callsign: e.callsign, runway: null, title: `Emergency: ${name}`, body: e.text, source: 'traffic' }
  return null
}

// ---------------------------------------------------------------------------
// Rules: radio transcripts
// ---------------------------------------------------------------------------

export type HeardCall = { id: string; at: number; text: string; callsign: string | null; icao24: string | null; speaker: 'pilot' | 'controller' | null }

const RADIO_RULES: { kind: AlertKind; re: RegExp; unless?: RegExp; title: string; body: (who: string) => string }[] = [
  { kind: 'emergency', re: /\bmay\s*day\b/i, title: 'Mayday call', body: (who) => `${who} called mayday: a distress call.` },
  { kind: 'emergency', re: /\bpan[\s-]?pan\b/i, title: 'Pan-pan call', body: (who) => `${who} made a pan-pan urgency call.` },
  { kind: 'emergency', re: /\bdeclar(?:e|ed|ing)\s+(?:an\s+)?emergency\b|\bemergency\s+(?:declared|descent)\b|\bsquawk(?:ing)?\s+7[67]00\b/i, title: 'Emergency declared', body: (who) => `${who}: an emergency was declared on the radio.` },
  { kind: 'rto', re: /\b(?:reject(?:ed|ing)?|abort(?:ed|ing)?|stopping)\s+(?:the\s+)?take\s*-?\s*off\b|\brejected\s+takeoff\b/i, title: 'Rejected takeoff', body: (who) => `${who} stopped a takeoff, according to the radio.` },
  // "In the event of a go-around, fly heading…" is an instruction for later, not one happening.
  { kind: 'goaround', re: /\bgo(?:ing)?[\s-]*around\b|\bmissed\s+approach\b/i, unless: /\b(?:if|in\s+case|in\s+the\s+event|should\s+you|expect)\b[^.]{0,30}\b(?:go(?:ing)?[\s-]*around|missed\s+approach)/i, title: 'Go-around', body: (who) => `${who} is going around, heard on the radio.` },
  { kind: 'diversion', re: /\bdivert(?:ing|ed)?\b|\bdiversion\b/i, title: 'Diversion', body: (who) => `${who} mentioned a diversion on the radio.` },
]

/** Alerts a transcribed call raises (at most one per kind). */
export function fromCall(c: HeardCall): AlertInput[] {
  const out: AlertInput[] = []
  const who = c.callsign ? friendlyFlightName(c.callsign) : 'An aircraft'
  const seen = new Set<AlertKind>()
  for (const r of RADIO_RULES) {
    if (seen.has(r.kind) || !r.re.test(c.text) || r.unless?.test(c.text)) continue
    seen.add(r.kind)
    out.push({ kind: r.kind, at: c.at, icao24: c.icao24, callsign: c.callsign, runway: null, title: c.callsign ? `${r.title}: ${who}` : r.title, body: r.body(who), source: 'radio', quote: c.text.length > 160 ? `${c.text.slice(0, 159)}…` : c.text })
  }
  return out
}

// ---------------------------------------------------------------------------
// Rules: rejected takeoff from the traffic
// ---------------------------------------------------------------------------

type Roll = {
  /** Last time it was seen airborne: a landing roll looks like a takeoff roll slowing down. */
  airborneAt: number
  runway: string | null
  /** Seen slow on this runway before speeding up, i.e. a takeoff roll from its start. */
  startedSlow: boolean
  peakKt: number
  peakAt: number
  alerted: boolean
  seenAt: number
}

export type RollState = Map<string, Roll>

/** Takeoff rolls this fast that slow right down again on the runway are rejected takeoffs. */
export const RTO_PEAK_KT = 60
export const RTO_DROP_KT = 30
const RECENT_AIRBORNE_MS = 5 * 60_000
const DECEL_WINDOW_MS = 60_000

/**
 * Watch takeoff rolls. Reports an aircraft that started slow on a runway,
 * accelerated past 60 kt pointing down it, then lost 30 kt while still on
 * the ground without having been airborne lately (which rules out landings).
 */
export function watchRolls(state: RollState, aircraft: Aircraft[], ends: RunwayEndGeometry[], elevationFt: number, now: number): AlertInput[] {
  const out: AlertInput[] = []
  for (const a of aircraft) {
    if (a.category?.startsWith('C')) continue
    let r = state.get(a.icao24)
    if (!r) {
      r = { airborneAt: a.onGround ? -Infinity : now, runway: null, startedSlow: false, peakKt: 0, peakAt: 0, alerted: false, seenAt: now }
      state.set(a.icao24, r)
    }
    r.seenAt = now
    if (!a.onGround) {
      r.airborneAt = now
      r.runway = null
      r.startedSlow = false
      r.peakKt = 0
      continue
    }
    const speed = a.speedKt ?? 0
    const rel = runwayRelation(a, ends, elevationFt)
    const on = rel?.kind === 'on' ? rel.runway : null
    if (!on) {
      // Left the runway: whatever was happening there is over.
      if (r.runway && speed < 30) {
        r.runway = null
        r.startedSlow = false
        r.peakKt = 0
      }
      continue
    }
    if (on !== r.runway) {
      r.runway = on
      r.startedSlow = speed < 30
      r.peakKt = speed
      r.peakAt = now
      continue
    }
    if (speed < 30 && r.peakKt < RTO_PEAK_KT) r.startedSlow = true
    if (speed > r.peakKt) {
      r.peakKt = speed
      r.peakAt = now
    }
    const fresh = now - r.airborneAt > RECENT_AIRBORNE_MS
    if (!r.alerted && fresh && r.startedSlow && r.peakKt >= RTO_PEAK_KT && speed <= r.peakKt - RTO_DROP_KT && now - r.peakAt < DECEL_WINDOW_MS) {
      r.alerted = true
      const name = friendlyFlightName(a.callsign)
      out.push({ kind: 'rto', at: now, icao24: a.icao24, callsign: a.callsign, runway: on, title: `Rejected takeoff? ${name}`, body: `${name} reached ${Math.round(r.peakKt)} kt on runway ${on}, then slowed to ${Math.round(speed)} kt without lifting off.`, source: 'traffic' })
    }
  }
  for (const [id, r] of state) if (now - r.seenAt > 120_000) state.delete(id)
  return out
}

// ---------------------------------------------------------------------------
// Rules: the runways turning around
// ---------------------------------------------------------------------------

export type RunwayDirState = { landing: string[]; since: number } | null

/**
 * A change of direction: everything now landing is the far end of runways
 * that were landing before (27L/27R → 9L/9R), as happens when the wind
 * swings round. Mixed or partial changes are left to the runway panel.
 * Returns the alert (if any) and the state to keep.
 */
export function watchRunwayDirection(prev: RunwayDirState, landing: string[], opposite: Map<string, string>, now: number): { state: RunwayDirState; alert: AlertInput | null } {
  if (!landing.length) return { state: prev, alert: null }
  if (!prev) return { state: { landing, since: now }, alert: null }
  const before = new Set(prev.landing)
  const flipped = landing.every((r) => !before.has(r) && before.has(opposite.get(r) ?? '')) && landing.length > 0
  const same = landing.length === prev.landing.length && landing.every((r) => before.has(r))
  if (same) return { state: prev, alert: null }
  const state = { landing, since: now }
  if (!flipped) return { state, alert: null }
  return {
    state,
    alert: { kind: 'runway', at: now, icao24: null, callsign: null, runway: landing[0], title: 'Runways turned around', body: `Aircraft are now landing on ${landing.join(', ')}, the opposite direction to before (${prev.landing.join(', ')}). Usually the wind has changed.`, source: 'traffic' },
  }
}

// ---------------------------------------------------------------------------
// Admission: merge repeats, limit bursts
// ---------------------------------------------------------------------------

/** Reports of the same thing about the same aircraft within this window are one alert. */
export const MERGE_MS = 5 * 60_000
/** At most this many new alerts per window; emergencies always get through. */
export const BURST = 3
export const BURST_MS = 2 * 60_000
/** A runway change can't usefully repeat sooner than this. */
const RUNWAY_COOLDOWN_MS = 15 * 60_000

export type Admission = { action: 'new'; alert: Alert } | { action: 'merge'; alert: Alert } | { action: 'drop'; reason: 'disabled' | 'burst' | 'cooldown' }

let seq = 0

/**
 * Decide what to do with a report, given the alerts already raised (any
 * order). Merging returns the existing alert updated (count, the radio quote
 * if it adds one); a new one gets an id.
 */
export function admit(log: Alert[], input: AlertInput, enabled: ReadonlySet<AlertKind>, now: number): Admission {
  if (!enabled.has(input.kind)) return { action: 'drop', reason: 'disabled' }
  const same = log.find(
    (a) =>
      a.kind === input.kind &&
      Math.abs(input.at - a.at) < (input.kind === 'runway' ? RUNWAY_COOLDOWN_MS : MERGE_MS) &&
      (input.kind === 'runway' || (!!input.icao24 && a.icao24 === input.icao24) || (!!input.callsign && a.callsign === input.callsign) || (!input.icao24 && !input.callsign && !a.icao24 && !a.callsign)),
  )
  if (same) {
    if (input.kind === 'runway') return { action: 'drop', reason: 'cooldown' }
    // What the traffic saw (with its runway) reads better than "heard on the radio"; the radio keeps its quote.
    const words = input.source === 'traffic' && same.source === 'radio' ? { title: input.title, body: input.body } : {}
    return { action: 'merge', alert: { ...same, ...words, count: same.count + 1, quote: same.quote ?? input.quote, runway: same.runway ?? input.runway, icao24: same.icao24 ?? input.icao24, callsign: same.callsign ?? input.callsign } }
  }
  if (input.kind !== 'emergency' && log.filter((a) => now - a.at < BURST_MS && a.kind !== 'emergency').length >= BURST) return { action: 'drop', reason: 'burst' }
  return { action: 'new', alert: { ...input, id: `alert-${input.at}-${++seq}`, count: 1 } }
}
