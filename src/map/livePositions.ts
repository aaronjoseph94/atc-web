/**
 * Smooths live traffic between polls.
 *
 * A new ADS-B fix arrives only every several seconds, and by then any blend
 * between the previous two fixes is already over, so planes used to freeze,
 * then teleport. Instead each aircraft keeps a short forecast: it coasts on
 * its reported speed and heading, and when a new fix arrives the position
 * error decays over a couple of seconds instead of snapping.
 *
 * The buffer also remembers where each aircraft has been (for trails) and
 * fades aircraft in and out as they enter and leave coverage.
 */
import type { Aircraft } from '../api/types'

/** A sampled aircraft: the fix, moved to "now", with a fade level for drawing. */
export type LiveAircraft = Aircraft & { opacity: number }

type Track = {
  fix: Aircraft
  fixAt: number
  /** Knots used to coast. Zero for parked aircraft. */
  coastKt: number
  /** Degrees true, the heading the icon eases toward. */
  coastHdg: number
  /** Whether `coastHdg` is real (reported or derived from movement). */
  hdgKnown: boolean
  /** Shown position minus the fix, at `fixAt`. Multiplied by a decay each frame. */
  errLat: number
  errLon: number
  /** Signed heading error in degrees (−180..180) at `fixAt`. */
  errHdg: number
  /** Degrees per second the aircraft was turning between its last two fixes; the icon keeps turning at this rate between fixes. */
  turnRate: number
  /** Polls missed since this aircraft was last seen. Fades out after two. */
  misses: number
  bornAt: number
  /** Set when the aircraft has left the feed; it is dropped once faded out. */
  goneAt: number | null
  /** Past fixes as `[lon, lat]`, oldest first. */
  history: [number, number][]
}

/** e^-1 of the correction is gone after this long (~1.6s to settle onto a new fix). */
const EASE_MS = 1600
/**
 * Heading corrections settle with a critically damped ease over about this
 * time constant: unlike a plain exponential, it starts at zero speed, so a
 * new fix never makes the icon twitch, it just leans into the new heading.
 */
const HDG_EASE_MS = 650
/** Keep turning at the measured rate for at most this long after a fix (about one poll); after that, hold the heading. */
const TURN_COAST_MS = 7000
/** Turn rates (degrees per second) worth acting on, and the most believed: a steep airliner turn is ~3°/s, taxi turns are quicker. */
const TURN_MIN_DPS = 0.25
const TURN_MAX_AIR_DPS = 4
const TURN_MAX_GROUND_DPS = 12
/** Stop inventing position this long after the last real fix. */
const MAX_COAST_MS = 20_000
/** Farther than this (~3 nm) is treated as a brand-new track and snapped. */
const SNAP_DEG = 0.05
/** Ground targets wander by tens of metres; smaller moves are held still. */
const PARKED_HOLD_DEG = 0.00045
const PARKED_KT = 6
/** Fade in on arrival, fade out on departure from the feed. */
const FADE_IN_MS = 700
const FADE_OUT_MS = 900
/** Fixes kept per aircraft for its trail. */
export const HISTORY_POINTS = 120
/** A fix must move this far (degrees, ~20 m) to add a trail point. */
const HISTORY_MIN_DEG = 0.0002

/** 1 knot = 1 nm/h, and 60 nm = 1 degree of latitude. */
const DEG_PER_MS_PER_KT = 1 / (60 * 3_600_000)

export class LivePositionBuffer {
  private tracks = new Map<string, Track>()

  /** Record a new snapshot. `now` is injectable for tests. */
  push(list: Aircraft[], now = performance.now()) {
    const seen = new Set<string>()
    for (const ac of list) {
      seen.add(ac.icao24)
      const prev = this.tracks.get(ac.icao24)
      if (!prev) {
        this.tracks.set(ac.icao24, {
          fix: ac,
          fixAt: now,
          coastKt: movingSpeed(ac, null),
          coastHdg: ac.heading,
          hdgKnown: ac.headingKnown !== false,
          errLat: 0,
          errLon: 0,
          errHdg: 0,
          turnRate: 0,
          misses: 0,
          bornAt: now,
          goneAt: null,
          history: [[ac.lon, ac.lat]],
        })
        continue
      }

      const shown = pose(prev, now)
      const jump = separationDeg(shown.lat, shown.lon, ac.lat, ac.lon)
      const parked = isParked(ac)
      const dt = Math.max(0, now - prev.fixAt)
      const derived = deriveMotion(prev.fix, ac, dt)
      const reportedHdg = ac.headingKnown !== false

      // Pin noisy parked targets so they don't twitch at the gate.
      const pin = parked && jump < PARKED_HOLD_DEG
      const snap = !pin && jump > SNAP_DEG
      const fix = pin ? { ...ac, lat: prev.fix.lat, lon: prev.fix.lon } : ac
      const coastKt = pin ? 0 : ac.speedKt != null && ac.speedKt >= 0 ? movingSpeed(ac, null) : (derived?.kt ?? prev.coastKt)
      // Prefer the reported track; without one, the direction it actually moved; else keep what we had.
      const coastHdg = pin ? prev.coastHdg : reportedHdg && ac.speedKt != null ? ac.heading : (derived?.hdg ?? (reportedHdg ? ac.heading : prev.coastHdg))
      const hdgKnown = pin ? prev.hdgKnown : reportedHdg || derived != null || prev.hdgKnown

      // How fast it was turning: from two reported tracks only (derived ones are too noisy), and never for parked aircraft.
      const turnRate = pin || snap || !reportedHdg || prev.fix.headingKnown === false || parked ? 0 : measureTurn(prev.coastHdg, coastHdg, dt, ac.onGround, prev.turnRate)

      prev.fix = fix
      prev.fixAt = now
      prev.turnRate = turnRate
      prev.coastKt = coastKt
      prev.coastHdg = coastHdg
      prev.hdgKnown = hdgKnown
      prev.errLat = snap ? 0 : shown.lat - fix.lat
      prev.errLon = snap ? 0 : shown.lon - fix.lon
      prev.errHdg = snap ? 0 : shortestDelta(coastHdg, shown.heading)
      prev.misses = 0
      prev.goneAt = null

      if (snap) prev.history = [[fix.lon, fix.lat]]
      else {
        const last = prev.history[prev.history.length - 1]
        if (!last || Math.abs(last[0] - fix.lon) > HISTORY_MIN_DEG || Math.abs(last[1] - fix.lat) > HISTORY_MIN_DEG) {
          prev.history.push([fix.lon, fix.lat])
          if (prev.history.length > HISTORY_POINTS) prev.history.shift()
        }
      }
    }

    for (const [id, tr] of this.tracks) {
      if (seen.has(id)) continue
      tr.misses += 1
      if (tr.misses >= 2 && tr.goneAt == null) tr.goneAt = now
      if (tr.goneAt != null && now - tr.goneAt > FADE_OUT_MS) this.tracks.delete(id)
    }
  }

  /** Drop everything (airport change). */
  clear() {
    this.tracks.clear()
  }

  /** Predicted positions for `now`, fading aircraft that are arriving or leaving. */
  sample(now = performance.now()): LiveAircraft[] {
    const out: LiveAircraft[] = []
    for (const [id, tr] of this.tracks) {
      const opacity = fade(tr, now)
      if (opacity <= 0) {
        if (tr.goneAt != null) this.tracks.delete(id)
        continue
      }
      const p = pose(tr, now)
      out.push({ ...tr.fix, lat: p.lat, lon: p.lon, heading: p.heading, headingKnown: tr.hdgKnown, opacity })
    }
    return out
  }

  /** One aircraft's drawn position right now, or null if it isn't tracked. */
  get(icao24: string, now = performance.now()): LiveAircraft | null {
    const tr = this.tracks.get(icao24)
    if (!tr) return null
    const p = pose(tr, now)
    return { ...tr.fix, lat: p.lat, lon: p.lon, heading: p.heading, headingKnown: tr.hdgKnown, opacity: fade(tr, now) }
  }

  /** Past positions of one aircraft, oldest first, ending where it is drawn now. */
  trail(icao24: string, maxPoints = HISTORY_POINTS, now = performance.now()): [number, number][] {
    const tr = this.tracks.get(icao24)
    if (!tr) return []
    const p = pose(tr, now)
    // The newest history point is the current fix; the drawn pose replaces it
    // so the line always ends under the icon.
    const past = tr.history.slice(-maxPoints, -1)
    return [...past, [p.lon, p.lat]]
  }

  /** Ids of every tracked aircraft with enough history to draw a wake. */
  ids(): string[] {
    return [...this.tracks.keys()]
  }
}

function fade(tr: Track, now: number): number {
  const fadeIn = Math.max(0, Math.min(1, (now - tr.bornAt) / FADE_IN_MS))
  const fadeOut = tr.goneAt == null ? 1 : Math.max(0, 1 - (now - tr.goneAt) / FADE_OUT_MS)
  return Math.max(0, Math.min(1, 0.25 + 0.75 * fadeIn) * fadeOut)
}

/**
 * Where this track should be drawn at `now`. Pure function of the last fix.
 * A turning aircraft keeps turning between fixes (along an arc, for about one
 * poll), so turns read as one continuous motion instead of a hold-then-swing.
 */
function pose(tr: Track, now: number): { lat: number; lon: number; heading: number } {
  const dt = Math.max(0, now - tr.fixAt)
  const decay = Math.exp(-dt / EASE_MS)
  const coastMs = Math.min(dt, MAX_COAST_MS)
  const turnMs = Math.min(coastMs, TURN_COAST_MS)
  const turned = (tr.turnRate * turnMs) / 1000
  let coast: { lat: number; lon: number }
  if (turned === 0) coast = project(tr.fix.lat, tr.fix.lon, tr.coastHdg, tr.coastKt, coastMs)
  else {
    const arc = projectArc(tr.fix.lat, tr.fix.lon, tr.coastHdg, tr.turnRate, tr.coastKt, turnMs)
    coast = project(arc.lat, arc.lon, tr.coastHdg + turned, tr.coastKt, coastMs - turnMs)
  }
  return {
    lat: coast.lat + tr.errLat * decay,
    lon: coast.lon + tr.errLon * decay,
    heading: (((tr.coastHdg + turned + tr.errHdg * headingEase(dt)) % 360) + 360) % 360,
  }
}

/** Share of a heading correction still left `dt` ms after a fix: critically damped, so it starts flat and has no corner. */
export function headingEase(dt: number): number {
  const x = Math.max(0, dt) / HDG_EASE_MS
  return (1 + x) * Math.exp(-x)
}

/**
 * Turn rate in degrees per second between two reported headings `dtMs`
 * apart. Small rates are noise and read as straight; the rest is blended
 * with the previous estimate and capped at what the aircraft can plausibly do.
 */
export function measureTurn(fromHdg: number, toHdg: number, dtMs: number, onGround: boolean, prevRate = 0): number {
  if (dtMs < 400 || dtMs > 30_000) return 0
  const rate = (shortestDelta(fromHdg, toHdg) * 1000) / dtMs
  if (Math.abs(rate) < TURN_MIN_DPS) return 0
  const max = onGround ? TURN_MAX_GROUND_DPS : TURN_MAX_AIR_DPS
  // Agreeing with the last estimate: smooth; a reversal: believe the new one.
  const blended = Math.sign(rate) === Math.sign(prevRate) ? 0.65 * rate + 0.35 * prevRate : rate
  return Math.max(-max, Math.min(max, blended))
}

function isParked(ac: Aircraft) {
  return ac.onGround && (ac.speedKt ?? 0) < PARKED_KT
}

/** Reported speed, forced to 0 when the aircraft is parked. */
function movingSpeed(ac: Aircraft, fallback: number | null) {
  if (isParked(ac)) return 0
  if (ac.speedKt != null && ac.speedKt >= 0) return ac.speedKt
  return fallback ?? 0
}

/** Speed and track angle implied by two successive fixes, when the feed omits them. */
function deriveMotion(a: Aircraft, b: Aircraft, dtMs: number): { kt: number; hdg: number } | null {
  // A reported near-zero speed means parked; no speed at all means we have to look at movement.
  if (dtMs < 400 || (b.speedKt != null && isParked(b))) return null
  const deg = separationDeg(a.lat, a.lon, b.lat, b.lon)
  // Less than ~15 m of movement says nothing reliable about direction.
  if (deg < 0.00014) return null
  const kt = (deg * 60) / (dtMs / 3_600_000)
  if (!Number.isFinite(kt) || kt > 750) return null
  return { kt, hdg: trackHeading(a.lat, a.lon, b.lat, b.lon) }
}

function project(lat: number, lon: number, heading: number, speedKt: number, dtMs: number) {
  if (speedKt <= 0 || dtMs <= 0) return { lat, lon }
  const dist = speedKt * DEG_PER_MS_PER_KT * dtMs
  const rad = (heading * Math.PI) / 180
  const dLat = dist * Math.cos(rad)
  const cosLat = Math.max(0.25, Math.cos((lat * Math.PI) / 180))
  const dLon = (dist * Math.sin(rad)) / cosLat
  return { lat: lat + dLat, lon: lon + dLon }
}

/** Move along a circular arc: start heading `heading`, turning `rateDps` degrees per second, for `dtMs`. */
function projectArc(lat: number, lon: number, heading: number, rateDps: number, speedKt: number, dtMs: number) {
  if (speedKt <= 0 || dtMs <= 0) return { lat, lon }
  const v = speedKt * DEG_PER_MS_PER_KT // degrees of latitude per ms
  const w = (rateDps * Math.PI) / 180 / 1000 // radians per ms
  const h0 = (heading * Math.PI) / 180
  const h1 = h0 + w * dtMs
  // Integral of (sin h, cos h) dt over the arc, in closed form.
  const dEast = (v / w) * (Math.cos(h0) - Math.cos(h1))
  const dNorth = (v / w) * (Math.sin(h1) - Math.sin(h0))
  const cosLat = Math.max(0.25, Math.cos((lat * Math.PI) / 180))
  return { lat: lat + dNorth, lon: lon + dEast / cosLat }
}

/** Equirectangular separation in degrees (latitude-sized). */
function separationDeg(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dLat = lat2 - lat1
  const dLon = (lon2 - lon1) * Math.cos((lat1 * Math.PI) / 180)
  return Math.hypot(dLat, dLon)
}

function trackHeading(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dLat = lat2 - lat1
  const dLon = (lon2 - lon1) * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180)
  return ((Math.atan2(dLon, dLat) * 180) / Math.PI + 360) % 360
}

function shortestDelta(from: number, to: number) {
  return ((to - from + 540) % 360) - 180
}

/** Shortest-arc interpolation between headings in degrees. */
export function lerpAngle(a: number, b: number, u: number) {
  const d = shortestDelta(a, b)
  return (a + d * u + 360) % 360
}
