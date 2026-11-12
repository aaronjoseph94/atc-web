/**
 * Live traffic, drawn smoothly: a delayed-playback buffer.
 *
 * An aircraft reports its position only every several seconds. Guessing
 * ahead from the last report (as this used to) looks alive but is wrong as
 * often as it is right: the guess overshoots a turn, cuts a corner across the
 * grass, and has to be taken back when the next report disagrees. So the map
 * instead shows traffic a few seconds late, about one and a half times the gap
 * between reports, where there is normally a known position on *both* sides
 * of the moment being drawn. Each aircraft then simply travels the curve
 * between its reports (see `motion/track.ts`):
 *
 *  - forwards only, with limited acceleration and turn rate;
 *  - on the ground, along the taxiway and runway centrelines
 *    (`motion/pavement.ts`), free only on the aprons;
 *  - coasting gently and then holding if the feed is late, blending back in
 *    when it returns;
 *  - fading across, not sliding, when a report is plainly somewhere else.
 *
 * What is shown is therefore the recent past. `sample`/`get` return the
 * aircraft as drawn (position, height and speed all of the same moment), which
 * is what everything on the map and in the panels wants; `latest` is the
 * newest raw report for the few uses that want real time. `delayMs` says how
 * late the picture is. The live radio is not delayed: see the note at
 * `delayMs`.
 *
 * The buffer also remembers where each aircraft has been drawn (for trails)
 * and fades aircraft in and out as they enter and leave coverage.
 */
import type { Aircraft } from '../api/types'
import type { TaxiLine } from '../live/taxi/graph'
import { Pavement, type PavementData } from './motion/pavement'
import { clamp, Frame } from './motion/plane'
import { HISTORY_POINTS, Track, type MotionClass, type TrackEnv } from './motion/track'

export { HISTORY_POINTS }

/** A sampled aircraft: as drawn at this moment, with a fade level. */
export type LiveAircraft = Aircraft & { opacity: number }

/** The picture is never less than this far behind, ms. */
export const MIN_DELAY_MS = 6000
/** ...and normally never more than this. */
export const MAX_DELAY_MS = 12_000
/** With a slow feed (the 15 s setting) a 12 s delay would leave nothing to draw between reports, so the cap stretches, up to this. */
const SLOW_FEED_MAX_DELAY_MS = 18_000
/** Delay per millisecond between fixes: one and a half gaps, so the next fix has normally arrived before it is needed. */
const DELAY_PER_INTERVAL = 1.5
/** The feed's rhythm is the middle value of this many recent polls. */
const RHYTHM_POLLS = 5
/** Used until the feed has shown its own rhythm. */
const DEFAULT_INTERVAL_MS = 8000
/** Reports with no timestamp are taken to be this old on arrival. */
const UNDATED_AGE_MS = 1000
/** A freshest report up to this old is believed as it stands. */
const PLAUSIBLE_LAG_MS = 3000
/** When the freshest report's age is not believable (the feed's clock and ours disagree), it is taken to be this old. */
const TYPICAL_LAG_MS = 1500
/** No report is treated as older than this on arrival. */
const MAX_FIX_AGE_MS = 60_000
/** Fade in on arrival, fade out on departure from the feed. */
const FADE_IN_MS = 700
const FADE_OUT_MS = 900

export class LivePositionBuffer {
  private tracks = new Map<string, Track>()
  private frame: Frame | null = null
  private data: PavementData | null = null
  private pavement: { aircraft: Pavement | null; vehicle: Pavement | null } | null = null
  private roads: TaxiLine[] | null = null
  private roadsAsked = false
  /** Typical time between an aircraft's fixes, ms, and how stale the previous fix typically was when the next arrived. */
  private interval: number | null = null
  private staleness: number | null = null
  private recent: [number, number][] = []
  private hintMs: number | null = null
  /** Smallest "age" seen for a report: about the feed's real lag, plus any disagreement between the feed's clock and ours. */
  private skew: number | null = null
  private readonly env: TrackEnv

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this
    this.env = {
      get frame() {
        return self.frame!
      },
      pavement: (cls) => this.pavementFor(cls),
    }
  }

  /**
   * How far behind real time traffic is being drawn, ms: about 1.5 times the
   * gap between reports, kept between 6 and 12 s (longer only when the feed
   * itself is slower than that). Anything that must line up with the drawn
   * aircraft (tower-log events, for one) should wait this long. The live
   * radio is heard in real time, so a transmission can be up to this far
   * ahead of the picture; the highlight still lands on the right aircraft.
   */
  get delayMs(): number {
    const interval = this.interval ?? this.hintMs ?? DEFAULT_INTERVAL_MS
    const need = this.staleness != null ? this.staleness + 600 : 0
    return clamp(Math.max(DELAY_PER_INTERVAL * interval, need), MIN_DELAY_MS, delayCap(interval))
  }

  /** How far behind one aircraft is drawn right now (it follows `delayMs`, more for an aircraft heard from less often). */
  delayOf(icao24: string): number | null {
    return this.tracks.get(icao24)?.delay ?? null
  }

  /** Tell the buffer how often the feed is polled, so the delay is right from the first report instead of after a few. */
  expectInterval(ms: number) {
    this.hintMs = ms
  }

  /**
   * Give (or take away) the airport's pavement. Ground traffic follows it
   * from its next report on; without it, ground traffic moves freely.
   */
  setPavement(data: PavementData | null) {
    this.data = data
    this.pavement = null
    this.roads = null
    this.roadsAsked = false
  }

  private pavementFor(cls: MotionClass): Pavement | null {
    if (!this.data || !this.frame) return null
    this.pavement ??= { aircraft: new Pavement(this.data, this.frame), vehicle: null }
    if (cls !== 'vehicle') return this.pavement.aircraft
    // Vehicles also use the service roads, fetched the first time one appears.
    if (!this.roadsAsked && this.data.roads) {
      this.roadsAsked = true
      const data = this.data
      void data
        .roads!()
        .then((roads) => {
          if (this.data !== data || !roads.length) return
          this.roads = roads
          if (this.pavement) this.pavement.vehicle = null
        })
        .catch(() => {})
    }
    if (this.roads && !this.pavement.vehicle) this.pavement.vehicle = new Pavement(this.data, this.frame, this.roads)
    return this.pavement.vehicle ?? this.pavement.aircraft
  }

  /**
   * Record a new snapshot. `now` (the `performance.now()` clock) and
   * `wallNow` (the `Date.now()` clock the feed's timestamps are compared
   * with) are injectable for tests.
   */
  push(list: Aircraft[], now = performance.now(), wallNow = Date.now()) {
    if (!this.frame && list.length) this.frame = new Frame([list[0].lon, list[0].lat])

    // How old is the freshest report? If that is not believable the clocks disagree: take the excess out of every age.
    let freshest = Infinity
    for (const ac of list) if (typeof ac.positionTime === 'number' && Number.isFinite(ac.positionTime)) freshest = Math.min(freshest, wallNow - ac.positionTime)
    if (Number.isFinite(freshest)) this.skew = this.skew == null ? freshest : Math.min(this.skew + 20, freshest)
    const offset = this.skew == null ? 0 : this.skew - believedLag(this.skew)

    const seen = new Set<string>()
    const intervals: number[] = []
    const stale: number[] = []
    const delay = this.delayMs
    for (const ac of list) {
      seen.add(ac.icao24)
      // Date each fix when it was measured (reports are seconds old on arrival), not when it happened to arrive.
      const age = typeof ac.positionTime === 'number' && Number.isFinite(ac.positionTime) ? clamp(wallNow - ac.positionTime - offset, 0, MAX_FIX_AGE_MS) : UNDATED_AGE_MS
      const t = now - age
      const tr = this.tracks.get(ac.icao24)
      if (!tr) {
        this.tracks.set(ac.icao24, new Track(this.env, ac, t, now, delay))
        continue
      }
      tr.step(now)
      tr.misses = 0
      tr.goneAt = null
      if (tr.offer(ac, t, now) && tr.lastInterval != null && tr.lastGapMs != null) {
        intervals.push(tr.lastInterval)
        stale.push(tr.lastGapMs)
      }
    }

    // The feed's rhythm, from the aircraft that had something new this time.
    if (intervals.length) {
      intervals.sort((a, b) => a - b)
      stale.sort((a, b) => a - b)
      const med = intervals[intervals.length >> 1]
      const p90 = stale[Math.min(stale.length - 1, Math.floor(stale.length * 0.9))]
      // The middle of the last few polls, so one missed poll (a doubled gap) changes nothing.
      this.recent.push([med, p90])
      if (this.recent.length > RHYTHM_POLLS) this.recent.shift()
      this.interval = middle(this.recent.map((r) => r[0]))
      this.staleness = middle(this.recent.map((r) => r[1]))
    }
    const target = this.delayMs
    for (const [id, tr] of this.tracks) {
      // An aircraft heard from much less often than the rest is drawn a little later still, so it too has a fix ahead of it.
      const own = tr.ownInterval()
      tr.delayTarget = own != null && own > 1.3 * (this.interval ?? own) ? clamp(DELAY_PER_INTERVAL * own, target, delayCap(own)) : target
      if (seen.has(id)) continue
      tr.misses += 1
      if (tr.misses >= 2 && tr.goneAt == null) tr.goneAt = now
      if (tr.goneAt != null && now - tr.goneAt > FADE_OUT_MS) this.tracks.delete(id)
    }
  }

  /** Drop everything (airport change). The pavement, if any, is kept until `setPavement` replaces it. */
  clear() {
    this.tracks.clear()
    this.frame = null
    this.pavement = null
    this.interval = null
    this.staleness = null
    this.recent = []
    this.skew = null
  }

  /** Every aircraft as drawn at `now`, fading those that are arriving or leaving. */
  sample(now = performance.now()): LiveAircraft[] {
    const out: LiveAircraft[] = []
    for (const [id, tr] of this.tracks) {
      const opacity = fade(tr, now)
      if (opacity <= 0 && tr.goneAt != null) {
        this.tracks.delete(id)
        continue
      }
      tr.step(now)
      out.push({ ...tr.latest, ...tr.drawn(), opacity: opacity * tr.jumpFade(now) })
    }
    return out
  }

  /** One aircraft as drawn right now, or null if it isn't tracked. */
  get(icao24: string, now = performance.now()): LiveAircraft | null {
    const tr = this.tracks.get(icao24)
    if (!tr) return null
    tr.step(now)
    return { ...tr.latest, ...tr.drawn(), opacity: fade(tr, now) * tr.jumpFade(now) }
  }

  /** The newest raw report for an aircraft (real time, a few seconds ahead of where it is drawn), or null. */
  latest(icao24: string): Aircraft | null {
    return this.tracks.get(icao24)?.latest ?? null
  }

  /** Past drawn positions of one aircraft, oldest first, ending where it is drawn now. */
  trail(icao24: string, maxPoints = HISTORY_POINTS, now = performance.now()): [number, number][] {
    const tr = this.tracks.get(icao24)
    if (!tr) return []
    tr.step(now)
    return tr.trail(maxPoints)
  }

  /** Ids of every tracked aircraft. */
  ids(): string[] {
    return [...this.tracks.keys()]
  }

  /** The drawn motion of one aircraft, for tests and the measuring scripts: distance along its path (m), speed (m/s) and delay (ms). */
  motion(icao24: string, now = performance.now()): { s: number; v: number; delay: number; slack: number } | null {
    const tr = this.tracks.get(icao24)
    if (!tr) return null
    tr.step(now)
    return { s: tr.s, v: tr.v, delay: tr.delay, slack: tr.slack }
  }
}

/**
 * How old the freshest report really is, given how old it looks (`skew`, ms).
 * Up to a few seconds it is believed. Beyond that, or when it claims to come
 * from the future, the clocks disagree: the answer slides (smoothly, so a
 * value hovering at the edge cannot flip the timeline) to a typical lag.
 */
export function believedLag(skew: number): number {
  if (skew < 0) return TYPICAL_LAG_MS * (1 - Math.exp(skew / 2000))
  if (skew <= PLAUSIBLE_LAG_MS) return skew
  return TYPICAL_LAG_MS + (PLAUSIBLE_LAG_MS - TYPICAL_LAG_MS) * Math.exp(-(skew - PLAUSIBLE_LAG_MS) / 2000)
}

function middle(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  return s[s.length >> 1]
}

/** The longest delay allowed for a feed with this gap between fixes. */
function delayCap(intervalMs: number): number {
  return Math.max(MAX_DELAY_MS, Math.min(SLOW_FEED_MAX_DELAY_MS, 1.2 * intervalMs))
}

function fade(tr: Track, now: number): number {
  const fadeIn = Math.max(0, Math.min(1, (now - tr.bornAt) / FADE_IN_MS))
  const fadeOut = tr.goneAt == null ? 1 : Math.max(0, 1 - (now - tr.goneAt) / FADE_OUT_MS)
  return Math.max(0, Math.min(1, 0.25 + 0.75 * fadeIn) * fadeOut)
}
