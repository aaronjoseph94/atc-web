/**
 * Smooths live traffic between polls.
 *
 * A new ADS-B fix arrives only every several seconds, and by then any blend
 * between the previous two fixes is already over — so planes used to freeze,
 * then teleport. Instead each aircraft keeps a short forecast: it coasts on
 * its reported speed and heading, and when a new fix arrives the position
 * error decays over a couple of seconds instead of snapping.
 */
import type { Aircraft } from '../api/types'

type Track = {
  fix: Aircraft
  fixAt: number
  /** Knots used to coast. Zero for parked aircraft. */
  coastKt: number
  /** Degrees true, the heading the icon eases toward. */
  coastHdg: number
  /** Shown position minus the fix, at `fixAt`. Multiplied by a decay each frame. */
  errLat: number
  errLon: number
  /** Signed heading error in degrees (−180..180) at `fixAt`. */
  errHdg: number
  /** Polls missed since this aircraft was last seen. Dropped after two. */
  misses: number
}

/** e^-1 of the correction is gone after this long (~1.6s to settle onto a new fix). */
const EASE_MS = 1600
/** Stop inventing position this long after the last real fix. */
const MAX_COAST_MS = 20_000
/** Farther than this (~3 nm) is treated as a brand-new track and snapped. */
const SNAP_DEG = 0.05
/** Ground targets wander by tens of metres; smaller moves are held still. */
const PARKED_HOLD_DEG = 0.00045
const PARKED_KT = 6

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
          errLat: 0,
          errLon: 0,
          errHdg: 0,
          misses: 0,
        })
        continue
      }

      const shown = pose(prev, now)
      const jump = separationDeg(shown.lat, shown.lon, ac.lat, ac.lon)
      const parked = isParked(ac)
      const dt = Math.max(0, now - prev.fixAt)
      const derived = deriveMotion(prev.fix, ac, dt)

      // Pin noisy parked targets so they don't twitch at the gate.
      const pin = parked && jump < PARKED_HOLD_DEG
      const snap = !pin && jump > SNAP_DEG
      const fix = pin ? { ...ac, lat: prev.fix.lat, lon: prev.fix.lon, heading: prev.coastHdg } : ac
      const coastKt = pin ? 0 : (ac.speedKt != null && ac.speedKt >= 0 ? movingSpeed(ac, null) : (derived?.kt ?? prev.coastKt))
      const coastHdg = pin ? prev.coastHdg : ac.speedKt != null ? ac.heading : (derived?.hdg ?? ac.heading)

      prev.fix = fix
      prev.fixAt = now
      prev.coastKt = coastKt
      prev.coastHdg = coastHdg
      prev.errLat = snap ? 0 : shown.lat - fix.lat
      prev.errLon = snap ? 0 : shown.lon - fix.lon
      prev.errHdg = snap ? 0 : shortestDelta(coastHdg, shown.heading)
      prev.misses = 0
    }

    for (const [id, tr] of this.tracks) {
      if (seen.has(id)) continue
      tr.misses += 1
      if (tr.misses >= 2) this.tracks.delete(id)
    }
  }

  /** Drop everything (airport change). */
  clear() {
    this.tracks.clear()
  }

  /** Predicted positions for `now`. */
  sample(now = performance.now()): Aircraft[] {
    const out: Aircraft[] = []
    for (const tr of this.tracks.values()) out.push(toAircraft(tr, now))
    return out
  }
}

function toAircraft(tr: Track, now: number): Aircraft {
  const p = pose(tr, now)
  return { ...tr.fix, lat: p.lat, lon: p.lon, heading: p.heading }
}

/** Where this track should be drawn at `now`. Pure function of the last fix. */
function pose(tr: Track, now: number): { lat: number; lon: number; heading: number } {
  const dt = Math.max(0, now - tr.fixAt)
  const decay = Math.exp(-dt / EASE_MS)
  const coast = project(tr.fix.lat, tr.fix.lon, tr.coastHdg, tr.coastKt, Math.min(dt, MAX_COAST_MS))
  return {
    lat: coast.lat + tr.errLat * decay,
    lon: coast.lon + tr.errLon * decay,
    heading: (tr.coastHdg + tr.errHdg * decay + 360) % 360,
  }
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
  if (dtMs < 400 || isParked(b)) return null
  const deg = separationDeg(a.lat, a.lon, b.lat, b.lon)
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
