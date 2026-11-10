/**
 * The life of one flight as the app has seen it: pushback, taxi, takeoff,
 * climb… or descent, final, touchdown, taxi in, gate. Worked out from the
 * positions we have recorded for it (live polls or a replayed track), so a
 * phase only gets a time if we actually saw it happen. Phases that happened
 * before we started watching, or between two position reports, are reported
 * as such instead of being given an invented time.
 *
 * Everything here is pure: the flight view hands in the track, the runways
 * and the field elevation, and draws whatever comes back.
 */
import { runwayRelation, type RunwayRelation } from '../live/events'
import type { RunwayEndGeometry } from '../map/airportDiagram'
import { distanceM, M_PER_NM, type LngLat } from '../map/geo'

/** One position report, on any clock (epoch ms for live traffic, clip ms for a replayed scene). */
export type TrackPoint = {
  t: number
  lat: number
  lon: number
  heading: number | null
  altitudeFt: number | null
  speedKt: number | null
  onGround: boolean
}

export type StepKey = 'pushback' | 'taxiOut' | 'lineUp' | 'takeoffRoll' | 'airborne' | 'climb' | 'level' | 'descent' | 'approach' | 'goAround' | 'touchdown' | 'rollout' | 'taxiIn' | 'atGate'

/**
 * `done`: seen, and over. `current`: the latest phase we saw begin.
 * `missed`: must have happened, but not while we were watching (or it fell
 * between two reports). `upcoming`: still to come.
 */
export type StepState = 'done' | 'current' | 'missed' | 'upcoming'

export type Step = {
  key: StepKey
  /** When the phase began, on the track's clock; null when it wasn't observed. */
  at: number | null
  /** When it ended, for phases whose length is worth showing (takeoff roll, rollout). */
  until: number | null
  /** The time lies between two position reports and is interpolated: good to a few seconds. */
  approx: boolean
  /** Already under way when the aircraft was first seen, so `at` is "first seen", not the start. */
  inProgress: boolean
  state: StepState
  runway: string | null
  /** Altitude the phase is about (level-off height), feet above sea level. */
  altitudeFt: number | null
}

/** Which half of a flight this airport saw. `ground`: only taxiing, direction unknown. */
export type FlightRole = 'departure' | 'arrival' | 'both' | 'overflight' | 'ground'

export type Timeline = {
  role: FlightRole
  steps: Step[]
  /** Liftoff and touchdown times when seen (same clock as the track). */
  wheelsUp: number | null
  touchdown: number | null
  /** Runway the aircraft is established on final for in its latest report. */
  finalRunway: string | null
  /** The phase in progress at the latest report. */
  current: StepKey | null
}

export type TimelineEvent = { kind: string; at: number; runway: string | null }

export type TimelineContext = {
  ends: RunwayEndGeometry[]
  elevationFt: number
  /** From the flight's route: whether this airport is its origin or destination. */
  roleHint?: 'departure' | 'arrival' | null
  /** Tower-log events for this aircraft, on the track's clock; they only supply runway names. */
  events?: TimelineEvent[]
}

// Thresholds. Speeds are ground speeds in knots, heights are feet above the field.
/** Below this an aircraft on the ground is standing still. */
const STILL_KT = 2
/** Pushbacks crawl; anything faster on the first move is a taxi under its own power. */
const PUSHBACK_MAX_KT = 7
/** Pushbacks take a minute or more; anything shorter is breakaway thrust. */
const PUSHBACK_MIN_MS = 20_000
const TAXI_KT = 7
/** Faster than any taxi: a takeoff or landing roll. */
const ROLL_KT = 40
/** Below this after landing, the rollout is over and the aircraft is taxiing. */
const ROLLOUT_END_KT = 35
/** Typical airliner acceleration on the takeoff roll, knots per second. */
const TAKEOFF_ACCEL_KT_S = 3
/** "Climb" begins when the aircraft passes this height (gear and flaps away). */
const CLIMB_AGL_FT = 1000
/** Holding an altitude this long and this tightly counts as levelling off. */
const LEVEL_HOLD_MS = 30_000
const LEVEL_BAND_FT = 150
/** A stop this long after landing, off the runways, is the gate. */
const GATE_STOP_MS = 120_000
/** Two reports further apart than this make an interpolated time approximate. */
const PRECISE_GAP_MS = 6_000

type Sample = TrackPoint & {
  /** Height above the field; 0 on the ground. */
  agl: number | null
  /** Vertical rate, ft/min, from the altitudes around this sample. */
  vr: number | null
  /** Ground speed: reported, else from movement since the previous report. */
  gs: number
  still: boolean
  rel: RunwayRelation
}

const empty = (key: StepKey): Step => ({ key, at: null, until: null, approx: false, inProgress: false, state: 'missed', runway: null, altitudeFt: null })

function analyse(points: TrackPoint[], ctx: TimelineContext): Sample[] {
  const pts = points.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.lat) && Number.isFinite(p.lon)).sort((a, b) => a.t - b.t)
  const out: Sample[] = []
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const prev = pts[i - 1]
    const moved = prev ? distanceM([prev.lon, prev.lat], [p.lon, p.lat]) : 0
    const dt = prev ? (p.t - prev.t) / 1000 : 0
    const derived = prev && dt > 0.5 ? moved / M_PER_NM / (dt / 3600) : null
    const gs = p.speedKt ?? derived ?? 0
    // A reported speed is trusted; without one, parked targets jitter by tens of metres.
    const still = p.onGround && (p.speedKt != null ? p.speedKt < STILL_KT : moved < 25)
    const agl = p.onGround ? 0 : p.altitudeFt == null ? null : p.altitudeFt - ctx.elevationFt
    const rel = runwayRelation(
      { icao24: '', callsign: '', lat: p.lat, lon: p.lon, heading: p.heading ?? 0, headingKnown: p.heading != null, altitudeFt: p.altitudeFt, speedKt: p.speedKt, onGround: p.onGround },
      ctx.ends,
      ctx.elevationFt,
    )
    out.push({ ...p, agl, vr: null, gs, still, rel })
  }
  for (let i = 0; i < out.length; i++) out[i].vr = out[i].onGround ? 0 : climbRate(out, i)
  return out
}

/** Vertical rate around sample `i` from the airborne reports within ±25 s. */
function climbRate(s: Sample[], i: number): number | null {
  const t = s[i].t
  let a = i
  let b = i
  while (a > 0 && t - s[a - 1].t <= 25_000 && !s[a - 1].onGround && s[a - 1].altitudeFt != null) a--
  while (b < s.length - 1 && s[b + 1].t - t <= 25_000 && !s[b + 1].onGround && s[b + 1].altitudeFt != null) b++
  const span = s[b].t - s[a].t
  if (span < 5_000 || s[a].altitudeFt == null || s[b].altitudeFt == null) return null
  return ((s[b].altitudeFt! - s[a].altitudeFt!) / span) * 60_000
}

const mid = (a: number, b: number) => a + (b - a) / 2
const findFrom = (s: Sample[], from: number, to: number, ok: (p: Sample, i: number) => boolean) => {
  for (let i = Math.max(0, from); i < to; i++) if (ok(s[i], i)) return i
  return -1
}
const onRunway = (p: Sample) => (p.rel?.kind === 'on' ? p.rel.runway : null)

/** The moment between two reports when a value crossed `level`, by linear interpolation. */
function crossing(a: Sample, b: Sample, va: number, vb: number, level: number) {
  if (vb === va) return b.t
  const u = Math.min(1, Math.max(0, (level - va) / (vb - va)))
  return a.t + (b.t - a.t) * u
}

type Found = Partial<Record<StepKey, Step>>

function departureSteps(s: Sample[], end: number, k: number, found: Found) {
  let from = 0
  let taxiStart: number | null = null
  // Pushback: first seen standing still off the runways, then creeping away
  // for a while. A crawl that turns into a taxi within seconds is just an
  // aircraft pulling away from a stand or a hold under its own power.
  if (s[0]?.still && !onRunway(s[0])) {
    const j = findFrom(s, 1, end, (p) => !p.still)
    if (j > 0) {
      const began = mid(s[j - 1].t, s[j].t)
      const fast = findFrom(s, j, end, (p) => p.gs >= PUSHBACK_MAX_KT)
      const crawlMs = (fast >= 0 ? s[fast].t : s[end - 1].t) - began
      if (s[j].gs < PUSHBACK_MAX_KT && crawlMs >= PUSHBACK_MIN_MS) found.pushback = { ...empty('pushback'), at: began, approx: s[j].t - s[j - 1].t > PRECISE_GAP_MS }
      else taxiStart = began
      from = j
    }
  }
  // Taxi out: moving under its own power along the taxiways.
  const taxi = findFrom(s, from, end, (p) => p.onGround && p.gs >= TAXI_KT && p.gs < ROLL_KT && !onRunway(p))
  // The takeoff roll: the first time it goes faster than any taxi.
  const roll = findFrom(s, 0, end, (p) => p.onGround && p.gs >= ROLL_KT)
  if (taxi >= 0 && (roll < 0 || taxi < roll)) found.taxiOut = { ...empty('taxiOut'), at: taxiStart ?? s[taxi].t, approx: taxiStart != null, inProgress: taxi === 0 }
  // Line up: slow (or stopped) on a runway, pointing down it, before the roll.
  const lineUp = findFrom(s, Math.max(0, taxi), roll >= 0 ? roll : end, (p) => p.onGround && p.gs < 30 && !!onRunway(p))
  if (lineUp >= 0) found.lineUp = { ...empty('lineUp'), at: s[lineUp].t, inProgress: lineUp === 0, runway: onRunway(s[lineUp]) }
  if (roll >= 0) {
    const p = s[roll]
    const prev = s[roll - 1]
    // The roll began before the first fast report: back off by how long it takes to reach that speed.
    const at = prev && prev.onGround && prev.gs < ROLL_KT ? Math.max(prev.t, p.t - (p.gs / TAKEOFF_ACCEL_KT_S) * 1000) : p.t
    found.takeoffRoll = { ...empty('takeoffRoll'), at, approx: !!prev, inProgress: roll === 0, runway: onRunway(p) ?? found.lineUp?.runway ?? null }
  }
  if (k > 0) {
    const g = s[k - 1]
    const a = s[k]
    // Back off the first airborne report by the height it had already gained.
    let at = mid(g.t, a.t)
    if (a.agl != null && a.vr != null && a.vr > 100) at = Math.min(a.t, Math.max(g.t, a.t - (a.agl / a.vr) * 60_000))
    found.airborne = { ...empty('airborne'), at, approx: a.t - g.t > PRECISE_GAP_MS, runway: found.takeoffRoll?.runway ?? found.lineUp?.runway ?? null }
    if (found.takeoffRoll) found.takeoffRoll.until = at
  }
}

/** Climb (passing 1,000 ft) and level-off within an airborne stretch `[from, to)`. */
function climbAndLevel(s: Sample[], from: number, to: number, found: Found, seenFrom: number) {
  const c = findFrom(s, from, to, (p) => !p.onGround && p.agl != null && p.agl >= CLIMB_AGL_FT)
  if (c >= 0) {
    const p = s[c]
    const climbing = (p.vr ?? 0) > 300 || s.slice(c + 1, to).some((q) => q.altitudeFt != null && p.altitudeFt != null && q.altitudeFt > p.altitudeFt + 300)
    if (climbing) {
      const prev = s[c - 1]
      if (c > seenFrom && prev && prev.agl != null && prev.agl < CLIMB_AGL_FT) {
        found.climb = { ...empty('climb'), at: crossing(prev, p, prev.agl, p.agl!, CLIMB_AGL_FT), approx: p.t - prev.t > PRECISE_GAP_MS }
      } else found.climb = { ...empty('climb'), at: p.t, inProgress: true }
    }
  }
  const start = c >= 0 && found.climb ? c : from
  const l = levelOff(s, start, to)
  if (l) found.level = { ...empty('level'), at: s[l.i].t, inProgress: l.i === seenFrom, altitudeFt: l.altitudeFt }
}

/** First report in `[from, to)` after which the altitude holds steady for a while, well clear of the field. */
function levelOff(s: Sample[], from: number, to: number): { i: number; altitudeFt: number } | null {
  for (let i = Math.max(0, from); i < to; i++) {
    const p = s[i]
    if (p.onGround || p.altitudeFt == null || p.agl == null || p.agl < 2500) continue
    let j = i
    let steady = true
    while (j + 1 < to && s[j + 1].t - p.t <= LEVEL_HOLD_MS + 10_000) {
      j++
      const q = s[j]
      if (q.onGround || q.altitudeFt == null || Math.abs(q.altitudeFt - p.altitudeFt) > LEVEL_BAND_FT) {
        steady = false
        break
      }
    }
    // The height it settles at is where the steady stretch ends, not where it began easing off.
    if (steady && s[j].t - p.t >= LEVEL_HOLD_MS) return { i, altitudeFt: Math.round(s[j].altitudeFt! / 100) * 100 }
  }
  return null
}

/** Runs of consecutive "on final" reports, bridging a single stray report. */
function finalRuns(s: Sample[], from: number, to: number): { start: number; end: number; runway: string }[] {
  const runs: { start: number; end: number; runway: string }[] = []
  for (let i = from; i < to; i++) {
    const rel = s[i].rel
    if (s[i].onGround || rel?.kind !== 'final') continue
    const last = runs[runs.length - 1]
    if (last && last.runway === rel.runway && i - last.end <= 2) last.end = i
    else runs.push({ start: i, end: i, runway: rel.runway })
  }
  return runs
}

/** Did the aircraft climb away after this final instead of landing? */
function climbedAway(s: Sample[], run: { start: number; end: number }, to: number): number {
  let low = Infinity
  for (let i = run.start; i <= run.end; i++) low = Math.min(low, s[i].agl ?? Infinity)
  if (!Number.isFinite(low)) return -1
  return findFrom(s, run.end + 1, to, (p) => !p.onGround && p.agl != null && p.agl > low + 400 && (p.vr ?? 0) > 300)
}

function arrivalSteps(s: Sample[], from: number, m: number, found: Found, ctx: TimelineContext) {
  const n = s.length
  const airEnd = m >= 0 ? m : n
  // Descent: coming down from well above the field.
  let top = from
  for (let i = from; i < airEnd; i++) if ((s[i].altitudeFt ?? -Infinity) > (s[top].altitudeFt ?? -Infinity)) top = i
  const descentFrom = found.airborne ? top : from
  // Already established on final counts as the approach, not the descent.
  const d = findFrom(s, descentFrom, airEnd, (p, i) => !p.onGround && p.rel?.kind !== 'final' && p.agl != null && p.agl > CLIMB_AGL_FT && (p.vr ?? 0) < -400 && (i + 1 >= airEnd || (s[i + 1].vr ?? -1) < -100))
  if (d >= 0) found.descent = { ...empty('descent'), at: s[d].t, inProgress: d === from }
  // Levelled off before descending (an arrival seen in level flight first).
  if (!found.airborne) {
    const l = levelOff(s, from, d >= 0 ? d : airEnd)
    if (l) found.level = { ...empty('level'), at: s[l.i].t, inProgress: l.i === from, altitudeFt: l.altitudeFt }
  }

  const runs = finalRuns(s, from, airEnd)
  let landingRun: (typeof runs)[number] | null = null
  let missedRun: (typeof runs)[number] | null = null
  let goAroundAt = -1
  for (const run of runs) {
    const next = runs.find((r) => r.start > run.end)?.start ?? airEnd
    const away = climbedAway(s, run, next)
    if (away >= 0) {
      missedRun = run
      goAroundAt = away
    } else landingRun = run
  }
  const goEvent = ctx.events?.find((e) => e.kind === 'goaround')
  if (missedRun && goAroundAt >= 0) {
    found.goAround = { ...empty('goAround'), at: s[goAroundAt].t, approx: true, runway: missedRun.runway ?? goEvent?.runway ?? null }
  }
  const run = landingRun ?? (m < 0 ? missedRun : null)
  if (run) found.approach = { ...empty('approach'), at: s[run.start].t, inProgress: run.start === from, runway: run.runway }

  if (m >= 0) {
    const a = s[m - 1]
    const g = s[m]
    let at = mid(a.t, g.t)
    if (a.agl != null && a.vr != null && a.vr < -100) at = Math.min(g.t, Math.max(a.t, a.t + (a.agl / -a.vr) * 60_000))
    const runway = onRunway(g) ?? found.approach?.runway ?? ctx.events?.find((e) => e.kind === 'landed')?.runway ?? null
    found.touchdown = { ...empty('touchdown'), at, approx: g.t - a.t > PRECISE_GAP_MS, runway }
    found.rollout = { ...empty('rollout'), at, approx: found.touchdown.approx, runway }
  }
  groundAfterLanding(s, Math.max(0, m), m < 0, found)
}

/** Rollout end, taxi in and the gate, from the ground reports starting at `from`. */
function groundAfterLanding(s: Sample[], from: number, seenRolling: boolean, found: Found) {
  const n = s.length
  if (seenRolling) {
    // Only seen on the ground, first report already at landing-roll speed.
    if (!(s[0]?.onGround && s[0].gs >= ROLL_KT)) return
    found.rollout = { ...empty('rollout'), at: s[0].t, inProgress: true, runway: onRunway(s[0]) }
  }
  if (!found.rollout) return
  const q = findFrom(s, from + 1, n, (p) => p.onGround && p.gs < ROLLOUT_END_KT)
  if (q < 0) return
  found.rollout.until = s[q].t
  found.taxiIn = { ...empty('taxiIn'), at: s[q].t, approx: s[q].t - s[q - 1].t > PRECISE_GAP_MS }
  // The gate: the last stretch of standing still, off the runways, long enough not to be a hold.
  let j = n - 1
  if (!s[j].still) return
  while (j - 1 > q && s[j - 1].still && distanceM([s[j - 1].lon, s[j - 1].lat], [s[n - 1].lon, s[n - 1].lat]) < 30) j--
  if (s[n - 1].t - s[j].t >= GATE_STOP_MS && !onRunway(s[j])) found.atGate = { ...empty('atGate'), at: s[j].t }
}

function groundRole(s: Sample[], hint: TimelineContext['roleHint']): FlightRole {
  const fast = s.findIndex((p) => p.gs >= ROLL_KT)
  if (fast === 0) return 'arrival'
  if (fast > 0) return s.slice(fast + 1).some((p) => p.gs < s[fast].gs - 15) && !s.slice(0, fast).some((p) => onRunway(p) && p.gs < 30) ? 'arrival' : 'departure'
  if (hint) return hint
  const moved = s.findIndex((p) => !p.still)
  if (s[0]?.still && moved > 0) return 'departure'
  if (s.some((p) => onRunway(p))) return 'departure'
  return 'ground'
}

function airRole(s: Sample[], hint: TimelineContext['roleHint']): FlightRole {
  const runs = finalRuns(s, 0, s.length)
  if (runs.length) return 'arrival'
  if (hint) return hint
  const first = s[0]
  const last = s[s.length - 1]
  const a0 = first.altitudeFt
  const a1 = last.altitudeFt
  if (a0 == null || a1 == null) return 'overflight'
  if ((first.agl ?? Infinity) < 3000 && ((first.vr ?? 0) > 300 || a1 > a0 + 500)) return 'departure'
  if (a1 < a0 - 500 && (last.agl ?? Infinity) < 10_000) return 'arrival'
  return 'overflight'
}

const DEPARTURE: StepKey[] = ['pushback', 'taxiOut', 'lineUp', 'takeoffRoll', 'airborne', 'climb', 'level']
const ARRIVAL: StepKey[] = ['level', 'descent', 'approach', 'goAround', 'touchdown', 'rollout', 'taxiIn', 'atGate']
/** Shown only when seen: they don't happen to every flight. */
const OPTIONAL = new Set<StepKey>(['level', 'goAround'])

/**
 * Build the timeline for one aircraft. `points` is its track so far, oldest
 * first; the newest point is "now".
 */
export function buildTimeline(points: TrackPoint[], ctx: TimelineContext): Timeline {
  let s = analyse(points, ctx)
  const blank: Timeline = { role: 'ground', steps: [], wheelsUp: null, touchdown: null, finalRunway: null, current: null }
  if (!s.length) return blank

  // An aircraft that landed and then took off again (a quick turnaround, or a
  // touch-and-go) is on its second life: start from where it slowed down.
  const firstTakeoff = s.findIndex((p, i) => i > 0 && s[i - 1].onGround && !p.onGround)
  const firstLanding = s.findIndex((p, i) => i > 0 && !s[i - 1].onGround && p.onGround)
  if (firstLanding > 0 && firstTakeoff > firstLanding) {
    const cut = s.findIndex((p, i) => i >= firstLanding && p.onGround && p.gs < ROLLOUT_END_KT)
    if (cut > 0) s = analyse(points.slice().sort((a, b) => a.t - b.t).slice(cut), ctx)
  }
  const n = s.length
  const k = s.findIndex((p, i) => i > 0 && s[i - 1].onGround && !p.onGround)
  const m = s.findIndex((p, i) => i > Math.max(0, k) && !s[i - 1].onGround && p.onGround)

  let role: FlightRole
  if (k > 0 && m > k) role = 'both'
  else if (k > 0) role = 'departure'
  else if (m > 0) role = 'arrival'
  else if (s.every((p) => p.onGround)) role = groundRole(s, ctx.roleHint)
  else role = airRole(s, ctx.roleHint)

  const found: Found = {}
  if (role === 'departure' || role === 'both' || role === 'ground') {
    departureSteps(s, k > 0 ? k : n, k, found)
    if (k > 0 || role === 'departure') {
      const airFrom = k > 0 ? k : s.findIndex((p) => !p.onGround)
      if (airFrom >= 0) climbAndLevel(s, airFrom, m > 0 ? m : n, found, k > 0 ? -1 : airFrom)
    }
  }
  if (role === 'arrival' || role === 'both') arrivalSteps(s, role === 'both' ? k : 0, m, found, ctx)
  if (role === 'overflight') {
    climbAndLevel(s, 0, n, found, 0)
    const d = findFrom(s, 0, n, (p) => (p.vr ?? 0) < -500 && (p.agl ?? 0) > CLIMB_AGL_FT)
    if (d >= 0) found.descent = { ...empty('descent'), at: s[d].t, inProgress: d === 0 }
  }
  // Tower-log events know the runway when the geometry couldn't tell.
  if (found.airborne && !found.airborne.runway) found.airborne.runway = ctx.events?.find((e) => e.kind === 'departed')?.runway ?? null

  const keys: StepKey[] =
    role === 'departure' ? DEPARTURE : role === 'arrival' ? ARRIVAL : role === 'both' ? [...DEPARTURE, ...ARRIVAL.filter((x) => x !== 'level')] : role === 'overflight' ? ['climb', 'level', 'descent'] : DEPARTURE
  // Optional phases, and everything unseen for flights whose direction we can't tell, are left out.
  const strict = role === 'overflight' || role === 'ground'
  let steps = keys.map((key) => found[key] ?? empty(key)).filter((st) => st.at != null || (!strict && !OPTIONAL.has(st.key)))
  if (role === 'ground') steps = steps.filter((st) => st.key !== 'takeoffRoll' && st.key !== 'airborne')

  // A go-around before the approach that ended in a landing reads in time order.
  const ga = steps.findIndex((st) => st.key === 'goAround')
  if (ga >= 0) {
    const [g] = steps.splice(ga, 1)
    // Before the first phase seen after it; else straight after the last one seen.
    let at = steps.findIndex((st) => st.at != null && st.at > g.at!)
    if (at < 0) at = steps.reduce((acc, st, i) => (st.at != null ? i + 1 : acc), 0)
    steps.splice(at, 0, g)
  }

  let last = -1
  steps.forEach((st, i) => {
    if (st.at != null) last = i
  })
  steps = steps.map((st, i) => ({ ...st, state: i === last ? 'current' : st.at != null ? 'done' : i < last ? 'missed' : 'upcoming' }))

  const latest = s[n - 1]
  return {
    role,
    steps,
    wheelsUp: found.airborne?.at ?? null,
    touchdown: found.touchdown?.at ?? null,
    finalRunway: !latest.onGround && latest.rel?.kind === 'final' ? latest.rel.runway : null,
    current: last >= 0 ? steps[last].key : null,
  }
}

/** Display name for a step; a level-off at airliner heights is the cruise. */
export function stepLabel(step: Pick<Step, 'key' | 'altitudeFt'>, role: FlightRole = 'departure'): string {
  switch (step.key) {
    case 'pushback':
      return 'Pushback'
    case 'taxiOut':
      return role === 'ground' ? 'Taxiing' : 'Taxi out'
    case 'lineUp':
      return 'Line up'
    case 'takeoffRoll':
      return 'Takeoff roll'
    case 'airborne':
      return 'Wheels up'
    case 'climb':
      return 'Climb'
    case 'level':
      return (step.altitudeFt ?? 0) >= 18_000 ? 'Cruise' : 'Level off'
    case 'descent':
      return 'Descent'
    case 'approach':
      return 'Final approach'
    case 'goAround':
      return 'Go-around'
    case 'touchdown':
      return 'Touchdown'
    case 'rollout':
      return 'Rollout'
    case 'taxiIn':
      return 'Taxi in'
    case 'atGate':
      return 'At gate'
  }
}

// ---------------------------------------------------------------------------
// Arrival estimate
// ---------------------------------------------------------------------------

export type ArrivalEstimate = { remainingMs: number; distanceNm: number; groundspeedKt: number }

/** Furthest out an arrival estimate is offered. */
export const ETA_MAX_NM = 150

/**
 * Time to the destination runway at the speed the aircraft has been making
 * over the last minute (an average, so one noisy report doesn't make the
 * countdown jump). Straight-line distance, so a pattern still to fly makes it
 * early; null on the ground, too far out, or too slow to say.
 */
export function arrivalEstimate(points: TrackPoint[], target: LngLat): ArrivalEstimate | null {
  const last = points[points.length - 1]
  if (!last || last.onGround) return null
  const distanceNm = distanceM([last.lon, last.lat], target) / M_PER_NM
  if (distanceNm > ETA_MAX_NM) return null
  // Time-weighted mean speed over the last minute.
  let sum = 0
  let weight = 0
  for (let i = points.length - 1; i > 0 && last.t - points[i].t < 60_000; i--) {
    const a = points[i - 1]
    const b = points[i]
    if (a.speedKt == null || b.speedKt == null || a.onGround) continue
    const dt = Math.min(b.t - a.t, 60_000 - (last.t - b.t))
    if (dt <= 0) continue
    sum += ((a.speedKt + b.speedKt) / 2) * dt
    weight += dt
  }
  const gs = weight > 0 ? sum / weight : last.speedKt
  if (gs == null || gs < 50) return null
  return { remainingMs: (distanceNm / gs) * 3_600_000, distanceNm, groundspeedKt: gs }
}

// ---------------------------------------------------------------------------
// Small formatting and chart helpers
// ---------------------------------------------------------------------------

/** `4:05`, `1:04:05`: for countdowns and "airborne for". */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** `38 s`, `4 min`, `1 h 05 min`: for phase lengths and "ago". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const min = Math.round(s / 60)
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`
}

/**
 * SVG path through the points as a monotone cubic (Fritsch–Carlson): smooth,
 * but never overshooting, so a level-off stays flat and the line never
 * pretends the aircraft went higher than it did.
 */
export function monotonePath(pts: [number, number][]): string {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M${f(pts[0][0])} ${f(pts[0][1])}`
  const dx: number[] = []
  const slope: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0])
    slope.push(dx[i] === 0 ? 0 : (pts[i + 1][1] - pts[i][1]) / dx[i])
  }
  const tangent: number[] = [slope[0]]
  for (let i = 1; i < n - 1; i++) tangent.push(slope[i - 1] * slope[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / slope[i - 1] + (dx[i] + 2 * dx[i - 1]) / slope[i]))
  tangent.push(slope[n - 2])
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    d += ` C${f(pts[i][0] + h)} ${f(pts[i][1] + tangent[i] * h)} ${f(pts[i + 1][0] - h)} ${f(pts[i + 1][1] - tangent[i + 1] * h)} ${f(pts[i + 1][0])} ${f(pts[i + 1][1])}`
  }
  return d
}

const f = (v: number) => (Math.round(v * 10) / 10).toString()

/** A value of the track at time `t`, interpolated between the reports either side. */
export function valueAt(points: TrackPoint[], t: number, pick: (p: TrackPoint) => number | null): number | null {
  if (!points.length) return null
  let lo = 0
  let hi = points.length - 1
  if (t <= points[0].t) return pick(points[0])
  if (t >= points[hi].t) return pick(points[hi])
  while (hi - lo > 1) {
    const midIdx = (lo + hi) >> 1
    if (points[midIdx].t <= t) lo = midIdx
    else hi = midIdx
  }
  const a = pick(points[lo])
  const b = pick(points[hi])
  if (a == null || b == null) return a ?? b
  const span = points[hi].t - points[lo].t
  return span <= 0 ? b : a + ((b - a) * (t - points[lo].t)) / span
}
