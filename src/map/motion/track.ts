/**
 * One aircraft's drawn motion.
 *
 * Reports ("fixes") arrive every several seconds and are drawn several
 * seconds late on purpose, so that there is normally a known position on
 * either side of the moment being drawn. The track keeps:
 *
 *  - a path through the fixes (`Path`), a smooth curve in the air and along
 *    the taxiway centrelines on the ground;
 *  - a timetable (`Timing`) saying how far along that path it was at each fix;
 *  - the drawn state: distance along the path, speed and nose heading.
 *
 * Every frame the drawn point chases the timetable with limited acceleration
 * and can only move forwards along the path. The path behind it never
 * changes; a new fix only adds road ahead. So no report, however late or
 * noisy, can make the aircraft back up, jump or swing round on the spot.
 */
import type { Aircraft } from '../../api/types'
import { shapeFor } from '../../aircraft/classify'
import { hermitePoints, Path, roundCorners, Timing, type PathPoint } from './curve'
import type { Pavement, Snap } from './pavement'
import { angleDelta, clamp, dirOf, dist, headingOf, MPS_PER_KT, type Frame, type XY } from './plane'

export type MotionClass = 'air' | 'ground' | 'vehicle' | 'heli'

/** What the track needs from the buffer it belongs to. */
export type TrackEnv = {
  frame: Frame
  /** The pavement to keep this class on, when it has loaded. */
  pavement(cls: MotionClass): Pavement | null
}

type Fix = {
  /** When the position was measured, ms on the buffer's clock. */
  t: number
  ac: Aircraft
  x: number
  y: number
  /** Ground speed, m/s (reported, else worked out from the distance covered). */
  v: number
  hdg: number
  hdgKnown: boolean
  onGround: boolean
}

/**
 * How briskly each class may change speed (m/s²) and swing its nose (°/s),
 * the tightest circle it can turn (m), how quickly the nose settles (s), and
 * how hard it corners on the ground (sideways m/s²: it slows for a bend).
 * Generous enough for a takeoff roll or a tight taxi turn, small enough that
 * nothing on screen lurches.
 */
const LIMITS: Record<MotionClass, { accel: number; decel: number; turn: number; radius: number; settle: number; side: number }> = {
  air: { accel: 4, decel: 5, turn: 14, radius: 0, settle: 0.45, side: 0 },
  ground: { accel: 2.2, decel: 3.2, turn: 30, radius: 11, settle: 0.5, side: 1.6 },
  vehicle: { accel: 2.5, decel: 4, turn: 75, radius: 3.5, settle: 0.35, side: 3 },
  heli: { accel: 3, decel: 3.5, turn: 40, radius: 0, settle: 0.5, side: 0 },
}

/** Above this ground speed (m/s) an aircraft on the ground is on a runway and uses the air limits. */
const ROLL_MPS = 20
/** Standing still: reported below this, knots. */
const STOPPED_KT = 3
/** Ground traffic slower than this is not matched to the taxiways (it is parked, docking or being towed about the apron). */
const MATCH_MIN_KT = 3
/** A pushback is slower than this, knots. */
const PUSHBACK_MAX_KT = 9
/** In the air below this (a hovering helicopter) the reported track is noise. */
const HOVER_KT = 15
/** Takeoff and landing rolls lock to the runway centreline above this, knots. */
const RUNWAY_LOCK_KT = 30
/** How quickly the drawn point closes on where the timetable says it should be, seconds. A new report is blended in over about twice this. */
const CHASE_S = 2.5
/** When the drawn point is ahead of the timetable it slows to this share of the real speed, never further, and never reverses. */
const AHEAD_SHARE = 0.3
/** How fast each class may go to catch up with its timetable: this multiple of the real speed, plus this many m/s. */
const CATCH_UP: Record<MotionClass, [number, number]> = { air: [1.3, 10], ground: [1.35, 3], vehicle: [1.4, 3], heli: [1.3, 6] }
/** A gap that would take longer than this to close at that pace is not chased: the aircraft skips ahead along its path under a fade. */
const SKIP_CATCH_UP_S = 25
/** A gap between fixes longer than this starts the track afresh (with a fade) rather than drawing a long slide. */
const GAP_RESTART_MS = 60_000
/** With no new fix an aircraft in the air flies on at full speed for the first of these (seconds), has eased to `AIR_COAST_SHARE` of it by the second, and is held by the third. */
const AIR_COAST_S = [6, 20, 30]
const AIR_COAST_SHARE = 0.6
/** On the ground the roll-on after the last fix is over by this many seconds. */
const GROUND_COAST_S = 9
/** A jump further than this is never a slide, whatever the speeds say. */
const TELEPORT_M = 6000
/** A relocation (bad fix, long gap) fades out for this long before the aircraft reappears. */
export const JUMP_FADE_MS = 320
/** The simulation never takes bigger steps than this, ms. */
const MAX_STEP_MS = 50
/** After a pause this long (a hidden tab) the drawn point goes straight to where it should be. */
const CATCH_UP_MS = 3000
/** Trail points: at least this far apart, metres, and dropped every so many seconds or on a change of direction. */
const CRUMB_MIN_M = 25
const CRUMB_MS = 8000
const CRUMB_TURN_DEG = 6
export const HISTORY_POINTS = 120
/** Fixes of the same aircraft closer in time than this are the same fix. */
const SAME_FIX_MS = 150

export type DrawnAircraft = {
  lon: number
  lat: number
  heading: number
  headingKnown: boolean
  altitudeFt: number | null
  speedKt: number | null
  verticalRateFpm: number | null | undefined
  onGround: boolean
}

export class Track {
  readonly id: string
  private env: TrackEnv
  /** The newest record from the feed (identity, squawk and the like always come from here). */
  latest: Aircraft
  cls: MotionClass
  private path = new Path()
  private timing = new Timing()
  private fixes: Fix[] = []
  private fixCur = 0
  /** Distance along the path up to which it is settled; beyond is a forecast that the next fix replaces. */
  private settledS = 0
  /** Knots in the timetable that are settled (the rest are forecasts). */
  private settledKnots = 0
  /** Where on the pavement graph the settled path ends, when it ends on a centreline. */
  private endSnap: Snap | null = null

  // ---- drawn state --------------------------------------------------------
  /** Distance along the path, metres. Only ever increases. */
  s = 0
  /** Speed along the path, m/s. Never negative. */
  v = 0
  heading = 0
  headingKnown = true
  private simT: number
  /** How far behind real time this aircraft is drawn, ms; eases toward `delayTarget`. */
  delay: number
  delayTarget: number
  private px = 0
  private py = 0

  // ---- bookkeeping --------------------------------------------------------
  /** A fix that doesn't fit the track, held until the next one says whether it was a blip or a real relocation. */
  private pending: { fix: Fix; n: number } | null = null
  /** Fixes the track starts over from once the drawn time reaches the first of them. */
  private restart: Fix[] | null = null
  /** Reports that put a stopped aircraft somewhere other than where it is drawn stopped. */
  private offStops = 0
  /** Fixes in a row that asked for a manoeuvre the aircraft could not have made. */
  private misfits = 0
  /** Time between this aircraft's recent fixes, ms. */
  intervals: number[] = []
  /** Time from the fix before to the newest, ms (null when the newest offer wasn't a new fix, or the gap says nothing). */
  lastInterval: number | null = null
  /** How stale the previous fix had become when the newest arrived, ms (see the buffer's delay). */
  lastGapMs: number | null = null
  misses = 0
  bornAt: number
  goneAt: number | null = null
  /** When the track last jumped (it fades back in from here). */
  private jumpAt = -Infinity
  /** A heading the aircraft is swinging round to before it rolls off (see `extend`); null normally. */
  private pivot: number | null = null
  /** When a skip ahead along the path is due (it fades out until then). */
  private skipAt: number | null = null
  private crumbs: [number, number][] = []
  private crumb = { x: 0, y: 0, t: 0, hdg: 0 }

  constructor(env: TrackEnv, ac: Aircraft, fixT: number, now: number, delayMs: number) {
    this.env = env
    this.id = ac.icao24
    this.latest = ac
    this.cls = classOf(ac)
    this.delay = delayMs
    this.delayTarget = delayMs
    this.simT = now
    this.bornAt = now
    this.begin(this.fixOf(ac, fixT, null), now - delayMs, true)
  }

  private fixOf(ac: Aircraft, t: number, prev: Fix | null): Fix {
    const p = this.env.frame.toXY(ac.lon, ac.lat)
    let v = ac.speedKt != null && ac.speedKt >= 0 ? ac.speedKt * MPS_PER_KT : -1
    if (v < 0) {
      // No speed in the report: a ground target that has plainly moved is given the speed it must have had.
      const d = prev ? Math.hypot(p.x - prev.x, p.y - prev.y) : 0
      const dt = prev ? (t - prev.t) / 1000 : 0
      v = prev && dt > 0.4 && d > 15 ? Math.min(d / dt, 320) : 0
    }
    let hdg = ac.heading
    let hdgKnown = ac.headingKnown !== false
    if (!hdgKnown && prev) {
      const d = Math.hypot(p.x - prev.x, p.y - prev.y)
      // Less than ~15 m of movement says nothing reliable about direction.
      if (d > 15) {
        hdg = headingOf(p.x - prev.x, p.y - prev.y)
        hdgKnown = true
      } else {
        hdg = prev.hdg
        hdgKnown = prev.hdgKnown
      }
    }
    // A vehicle is on the ground whatever its transponder says about altitude.
    return { t, ac, x: p.x, y: p.y, v, hdg, hdgKnown, onGround: ac.onGround || this.cls === 'vehicle' }
  }

  /** The class this fix moves as: anything on the ground that isn't a vehicle taxies; helicopters and vehicles keep their class. */
  private classAt(f: Fix): MotionClass {
    if (this.cls === 'vehicle' || this.cls === 'heli') return this.cls
    return f.onGround ? 'ground' : 'air'
  }

  // -------------------------------------------------------------------------
  // Starting (and starting over)
  // -------------------------------------------------------------------------

  /**
   * Start the track at `f`. The drawn time is `drawT`, usually some seconds
   * before the fix, so a moving aircraft starts that far back along the way
   * it came (straight back in the air, back along the taxiway on the ground)
   * and arrives at the fix on time: it is moving from its first frame.
   */
  private begin(f: Fix, drawT: number, backfill: boolean) {
    const cls = this.classAt(f)
    const pav = f.onGround && (cls === 'ground' || cls === 'vehicle') ? this.env.pavement(cls) : null
    const d = dirOf(f.hdg)
    const moving = f.v > STOPPED_KT * MPS_PER_KT && f.hdgKnown
    let at: XY = { x: f.x, y: f.y }
    let snap: Snap | null = null
    let dir = d
    if (pav && moving) {
      const lock = f.v >= RUNWAY_LOCK_KT * MPS_PER_KT ? pav.runwayLock(at, f.hdg) : null
      snap = lock ? lock.snap : this.snapTo(pav, at, f.hdg, f.v, cls, -1)
      if (lock) {
        at = { x: lock.x, y: lock.y }
        dir = { x: lock.ux, y: lock.uy }
      } else if (snap) {
        at = { x: snap.x, y: snap.y }
        dir = along(snap, d)
      }
    }
    this.timing.reset()
    this.fixes = [f]
    this.fixCur = 0
    this.endSnap = snap
    this.pending = null
    this.restart = null
    this.offStops = 0
    this.misfits = 0
    this.headingKnown = f.hdgKnown
    this.heading = f.hdg
    const lead = (f.t - drawT) / 1000
    if (backfill && moving && lead > 0.2) {
      const back = f.v * Math.min(lead, 20)
      let pts: XY[] | null = null
      if (pav && snap) {
        const walked = pav.walkBack(snap, f.hdg, back)
        if (walked.length >= 2) pts = roundCorners(walked, LIMITS[cls].radius * 2)
      }
      // On the ground with no centreline to follow back, start from the fix itself rather than guess a way across the apron.
      if (!pts && !f.onGround) pts = [{ x: at.x - dir.x * back, y: at.y - dir.y * back }, at]
      if (pts) {
        const d0 = unit(pts[1].x - pts[0].x, pts[1].y - pts[0].y) ?? dir
        this.path.reset(pts[0], d0.x, d0.y)
        this.path.append(pts.slice(1))
        this.timing.add(drawT, 0, f.v)
        this.timing.add(f.t, this.path.length, f.v)
        this.s = 0
        this.v = this.timing.at(drawT + 1).v
        const start = this.path.at(0)
        this.heading = headingOf(start.tx, start.ty)
        this.settle()
        this.place()
        this.crumbs = [[this.env.frame.lon(this.px), this.env.frame.lat(this.py)]]
        this.crumb = { x: this.px, y: this.py, t: this.simT, hdg: this.heading }
        return
      }
    }
    this.path.reset(at, dir.x, dir.y)
    this.timing.add(f.t, 0, moving ? f.v : 0)
    this.s = 0
    this.v = 0
    this.settle()
    this.place()
    this.crumbs = [[this.env.frame.lon(this.px), this.env.frame.lat(this.py)]]
    this.crumb = { x: this.px, y: this.py, t: this.simT, hdg: this.heading }
  }

  private settle() {
    this.settledS = this.path.length
    this.settledKnots = this.timing.count
  }

  private place() {
    const p = this.path.at(this.s)
    this.px = p.x
    this.py = p.y
  }

  // -------------------------------------------------------------------------
  // New fixes
  // -------------------------------------------------------------------------

  /** Time of the newest fix held (including ones waiting to be confirmed), ms. */
  get newestT(): number {
    if (this.restart) return this.restart[this.restart.length - 1].t
    return Math.max(this.fixes[this.fixes.length - 1].t, this.pending?.fix.t ?? -Infinity)
  }

  /**
   * Offer a report measured at `t`. Returns false when it is not a new fix
   * (a repeat of one already held, or one that is older). After a new fix,
   * `lastInterval` and `lastGapMs` say how the feed is running.
   */
  offer(ac: Aircraft, t: number, now: number): boolean {
    this.latest = ac
    this.lastInterval = null
    const newest = this.newestT
    if (t <= newest + SAME_FIX_MS) return false
    const last = this.restart ? this.restart[this.restart.length - 1] : (this.pending?.fix ?? this.fixes[this.fixes.length - 1])
    // A feed with no timestamps repeats the last position until it has a new one; a moving aircraft does not stand still mid-taxi.
    if (ac.positionTime == null && ac.lat === last.ac.lat && ac.lon === last.ac.lon && (ac.speedKt ?? 0) >= 5) return false
    const gap = t - newest
    if (gap >= 1000 && gap <= 45_000) {
      this.intervals.push(gap)
      if (this.intervals.length > 5) this.intervals.shift()
      this.lastInterval = gap
      this.lastGapMs = now - newest
    }
    // The type can arrive after the first report.
    this.cls = classOf(ac)
    const f = this.fixOf(ac, t, last)
    if (this.restart) {
      this.restart.push(f)
      return true
    }
    const prev = this.fixes[this.fixes.length - 1]

    // A long silence: don't slide across whatever happened meanwhile.
    if (t - prev.t > GAP_RESTART_MS) {
      this.restart = [f]
      this.pending = null
      return true
    }
    // Does it fit the track? If not it is held back: the next fix shows whether it was a blip (dropped) or a real relocation (start over there).
    if (!plausible(prev, f)) {
      if (this.pending && plausible(this.pending.fix, f)) {
        this.restart = [this.pending.fix, f]
        this.pending = null
        return true
      }
      const n = (this.pending?.n ?? 0) + 1
      // Three misfits in a row: the track itself must be what is wrong.
      if (n >= 3) {
        this.restart = [f]
        this.pending = null
      } else this.pending = { fix: f, n }
      return true
    }
    this.pending = null
    this.extend(f, now)
    return true
  }

  /** Add a believed fix: more path, and a knot in the timetable. */
  private extend(f: Fix, now: number) {
    const prev = this.fixes[this.fixes.length - 1]
    const cls = this.classAt(f)
    // Anything forecast beyond the settled path goes; if the drawn point is already out on the forecast, the new stretch starts from it.
    const coasting = this.s > this.settledS + 0.05
    const cutS = Math.max(this.s, this.settledS)
    this.path.cut(cutS)
    this.timing.truncate(this.settledKnots)
    if (coasting) this.endSnap = null
    const drawT = now - this.delay
    const E = this.path.end()
    const B: XY = { x: f.x, y: f.y }
    const gap = Math.hypot(B.x - E.x, B.y - E.y)
    const stopped = f.onGround && f.v < STOPPED_KT * MPS_PER_KT
    // Standing at the end of the path (so the next stretch may leave in any direction)?
    const atRest = coasting ? this.v < 0.5 : prev.v < STOPPED_KT * MPS_PER_KT || (this.v < 0.3 && this.s > this.settledS - 0.5)

    // ---- standing still, or jitter: hold ------------------------------------
    if (gap < Math.max(0.1, holdRadius(f, cls, atRest))) {
      this.fixes.push(f)
      if (coasting) this.timing.add(Math.max(drawT, this.timing.lastT + 1), this.path.length, 0)
      this.timing.add(Math.max(f.t, this.timing.lastT + 1), this.path.length, 0)
      this.offStops = 0
      this.settle()
      return
    }

    // ---- drawn ahead of where it really is: don't go back -------------------
    if (coasting && (E.tx * (B.x - E.x) + E.ty * (B.y - E.y)) / gap < -0.15) {
      const d1 = dirOf(f.hdg)
      const slow = f.v < (f.onGround ? STOPPED_KT : HOVER_KT) * MPS_PER_KT
      const sameWay = f.hdgKnown && d1.x * E.tx + d1.y * E.ty > 0.2
      this.fixes.push(f)
      if (slow || !sameWay) {
        // It stopped (or turned off) short of where it is drawn. Stay put; if it stays there, move over with a fade rather than reverse.
        this.timing.add(Math.max(drawT, this.timing.lastT + 1), this.path.length, 0)
        this.timing.add(Math.max(f.t, this.timing.lastT + 1), this.path.length, 0)
        this.settle()
        if (gap > 12 && ++this.offStops >= 2) this.restart = [f]
        return
      }
      // Still coming the same way: creep on at a fraction of its speed, along its course, until it has caught up.
      const behind = -(E.tx * (B.x - E.x) + E.ty * (B.y - E.y))
      const td = Math.max(drawT, this.timing.lastT + 1) / 1000
      const tf = f.t / 1000
      // It is `behind` metres back at `tf` doing `v`; we do a share of `v` from `td`. They meet at `tm`.
      const tm = clamp((behind + f.v * tf - AHEAD_SHARE * f.v * td) / ((1 - AHEAD_SHARE) * f.v), Math.max(td, tf) + 0.5, td + 25)
      const run = f.v * (tm - tf)
      const M = { x: B.x + d1.x * run, y: B.y + d1.y * run }
      this.timing.add(td * 1000, this.path.length, AHEAD_SHARE * f.v)
      this.settle()
      this.path.append(hermitePoints(E, { x: E.tx, y: E.ty }, M, d1))
      this.timing.add(tm * 1000, this.path.length, f.v)
      return
    }
    this.offStops = 0

    // ---- the road from the end of the path to this fix ----------------------
    const pav = f.onGround && (cls === 'ground' || cls === 'vehicle') ? this.env.pavement(cls) : null
    const chord = unit(B.x - E.x, B.y - E.y)!
    const chordHdg = headingOf(chord.x, chord.y)
    const off = Math.abs(angleDelta(f.hdg, chordHdg))
    // Moving against its own nose (a pushback): it sets off from a standstill, slowly, with its heading pointing back the way it came.
    const reverse = f.onGround && cls !== 'vehicle' && f.hdgKnown && f.v < PUSHBACK_MAX_KT * MPS_PER_KT && off > 115 && (atRest || E.rev)
    // Otherwise, on the ground an aircraft goes where it points, so a reported heading well off the way it actually went is
    // not its heading: some transponders keep sending their last airborne track all the way to the gate.
    const stale = f.onGround && !reverse && gap > 20 && (off > 60 || (off > 25 && f.hdg === prev.hdg))
    // The nose direction is believed when the report has one and the aircraft is moving enough for it to mean something.
    const hdgGood = f.hdgKnown && !stale && f.v >= (f.onGround ? MATCH_MIN_KT : HOVER_KT) * MPS_PER_KT
    const travel = reverse ? { x: -dirOf(f.hdg).x, y: -dirOf(f.hdg).y } : hdgGood ? dirOf(f.hdg) : chord
    const travelHdg = headingOf(travel.x, travel.y)

    let target = B
    let arrive = travel
    let snap: Snap | null = null
    if (pav && (f.v >= MATCH_MIN_KT * MPS_PER_KT || gap > 30)) {
      const lock = !reverse && f.v >= RUNWAY_LOCK_KT * MPS_PER_KT && hdgGood ? pav.runwayLock(B, f.hdg) : null
      if (lock) {
        target = { x: lock.x, y: lock.y }
        arrive = { x: lock.ux, y: lock.uy }
        snap = lock.snap
      } else {
        snap = this.snapTo(pav, B, travelHdg, f.v, cls, this.endSnap?.edge ?? -1)
        if (snap) {
          target = { x: snap.x, y: snap.y }
          arrive = along(snap, travel)
        }
      }
    }

    let pts: PathPoint[] | null = null
    let startDir: XY | null = null
    if (pav && this.endSnap && snap) {
      const straight = Math.hypot(target.x - E.x, target.y - E.y)
      const dt = Math.max(0.5, (f.t - prev.t) / 1000)
      const route = pav.route(this.endSnap, snap, 1.6 * straight + 90, atRest ? null : headingOf(E.tx, E.ty))
      // Believe the route only if it is about as long as the distance covered, and coverable in the time.
      if (route && route.len <= 1.45 * straight + 55 && route.len / dt <= 1.6 * Math.max(prev.v, f.v) + 9) {
        const line = roundCorners(route.pts, LIMITS[cls].radius * 2)
        const first = line.length > 1 ? unit(line[1].x - line[0].x, line[1].y - line[0].y) : null
        // It must set off the way the path was already going, unless it was standing still.
        if (first && (atRest || first.x * E.tx + first.y * E.ty > -0.3)) {
          pts = line.slice(1)
          if (atRest) startDir = first
        }
      }
    }
    if (!pts) {
      const leave = atRest ? (reverse ? travel : (unit(target.x - E.x, target.y - E.y) ?? chord)) : { x: E.tx, y: E.ty }
      const vmax = Math.max(prev.v, f.v)
      const radius = cls === 'heli' ? 0 : f.onGround ? LIMITS[cls].radius : Math.max(60, (vmax * vmax) / 8.5)
      pts = hermitePoints(E, leave, target, arrive)
      if (atRest) {
        startDir = leave
        // From a standstill it can leave any way it likes, but not arrive round an impossible curl: then it simply goes straight there.
        if (tightest(leave, pts) < 0.6 * radius) pts = hermitePoints(E, leave, target, leave)
      } else if (radius > 0) {
        // Moving, it can only go where it could steer: ahead, and round bends no tighter than its turning circle. A fix that
        // asks for more (noise, a stale position, a snap to the wrong line) counts only for the progress it shows along the
        // way the aircraft is already going.
        const dx = target.x - E.x
        const dy = target.y - E.y
        const fwd = dx * E.tx + dy * E.ty
        const side = Math.abs(dx * E.ty - dy * E.tx)
        const turnedBack = travel.x * E.tx + travel.y * E.ty < -0.2 && gap > 5 * radius
        if ((fwd <= 0 && !turnedBack) || (fwd > 0 && dx * dx + dy * dy < 2 * radius * side) || tightest({ x: E.tx, y: E.ty }, pts) < 0.6 * radius) {
          const ahead = fwd > 0.5
          this.fixes.push(f)
          if (ahead) this.path.append([{ x: E.x + E.tx * fwd, y: E.y + E.ty * fwd, tx: E.tx, ty: E.ty }], E.rev)
          this.timing.add(Math.max(f.t, this.timing.lastT + 1), this.path.length, ahead && !stopped ? f.v : 0)
          this.endSnap = null
          this.settle()
          // Fix after fix where it cannot have gone: the track is what is wrong. Move over with a fade.
          if (ahead) this.misfits = 0
          else if (++this.misfits >= 3) this.restart = [f]
          return
        }
      }
    }
    this.misfits = 0
    this.path.append(pts, reverse, startDir)
    this.fixes.push(f)
    this.timing.add(Math.max(f.t, this.timing.lastT + 1), this.path.length, stopped ? 0 : f.v)
    this.endSnap = snap
    this.settle()
    // Setting off from a standstill some other way than it is drawn pointing (the heading it was given was a guess, or stale):
    // it swings round as it starts to roll, rather than travelling sideways or tail-first while the nose catches up.
    if (startDir && this.s > cutS - 0.5) {
      const go = headingOf(startDir.x, startDir.y) + (reverse ? 180 : 0)
      this.pivot = Math.abs(angleDelta(this.heading, go)) > 25 ? (go + 360) % 360 : null
    }
  }

  /** Snap a moving ground target to a centreline: firmly off the aprons (anything else there is grass), lightly on them. */
  private snapTo(pav: Pavement, p: XY, heading: number | null, v: number, cls: MotionClass, prefer: number): Snap | null {
    const apron = pav.inApron(p)
    if (cls === 'vehicle') return pav.snap(p, heading, apron ? 5 : 14, prefer, apron ? 30 : 60)
    return pav.snap(p, heading, apron ? 9 : clamp(22 + 0.9 * v, 22, 40), prefer, apron ? 30 : 55)
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  /** Where the timetable puts the aircraft at drawn time `T`, and how fast. Past the last fix it coasts and then holds. */
  private reference(T: number): { s: number; v: number } {
    const tm = this.timing
    if (T <= tm.lastT) return tm.at(T)
    const tau = (T - tm.lastT) / 1000
    const v0 = tm.lastV
    if (v0 <= 0) return { s: tm.lastS, v: 0 }
    const last = this.fixes[this.fixes.length - 1]
    if (!last.onGround && v0 > 15) {
      // In the air it cannot stop: carry on at speed (a missed poll changes nothing), easing off only as the silence gets long.
      const [T1, T2, T3] = AIR_COAST_S
      if (tau <= T1) return { s: tm.lastS + v0 * tau, v: v0 }
      // Full speed to T1, down to AIR_COAST_SHARE of it by T2, to nothing by T3; distance is the area under that.
      const k = AIR_COAST_SHARE
      if (tau <= T2) {
        const u = tau - T1
        return { s: tm.lastS + v0 * (T1 + u - ((1 - k) * u * u) / (2 * (T2 - T1))), v: v0 * (1 - ((1 - k) * u) / (T2 - T1)) }
      }
      const at2 = T1 + (T2 - T1) * (1 + k) * 0.5
      if (tau <= T3) {
        const u = tau - T2
        return { s: tm.lastS + v0 * (at2 + k * (u - (u * u) / (2 * (T3 - T2)))), v: v0 * k * (1 - u / (T3 - T2)) }
      }
      return { s: tm.lastS + v0 * (at2 + (k * (T3 - T2)) / 2), v: 0 }
    }
    // On the ground (or hovering): roll on gently for a few seconds, then hold.
    const HOLD = 0.4
    const DECAY = 2.2
    if (tau <= HOLD) return { s: tm.lastS + v0 * tau, v: v0 }
    const e = Math.exp(-(Math.min(tau, GROUND_COAST_S) - HOLD) / DECAY)
    return { s: tm.lastS + v0 * (HOLD + DECAY * (1 - e)), v: tau >= GROUND_COAST_S ? 0 : v0 * e }
  }

  /** Advance the drawn state to `now`. */
  step(now: number) {
    let dtMs = now - this.simT
    if (dtMs <= 0) return
    if (this.restart && now - this.delay >= this.restart[0].t) this.startOver(now)
    if (dtMs > CATCH_UP_MS) {
      // Nobody was watching: go straight to where it should be (forwards only).
      this.simT = now
      this.delay = this.delayTarget
      const ref = this.reference(now - this.delay)
      this.s = Math.max(this.s, ref.s)
      this.v = ref.v
      const p = this.path.at(this.s)
      this.px = p.x
      this.py = p.y
      if (this.v > 0.5) this.heading = (headingOf(p.tx, p.ty) + (p.rev ? 180 : 0)) % 360
      this.dropCrumb(now)
      return
    }
    const n = Math.ceil(dtMs / MAX_STEP_MS)
    const hMs = dtMs / n
    const h = hMs / 1000
    for (let k = 0; k < n; k++) {
      this.simT += hMs
      // The delay eases toward its target, a few percent faster or slower than real time: never a visible lurch.
      this.delay += clamp(this.delayTarget - this.delay, -0.04 * hMs, 0.04 * hMs)
      const T = this.simT - this.delay
      const ref = this.reference(T)
      const fast = ref.v > ROLL_MPS || this.v > ROLL_MPS
      const cls = this.clsNow()
      const lim = cls === 'ground' && fast ? LIMITS.air : LIMITS[cls]
      // How far behind the timetable it would be after this step at its present speed.
      const err = ref.s - (this.s + this.v * h)
      // Hopelessly behind (a long silence has just ended): skip ahead along the path under a fade rather than spend ages catching up.
      const closing = (CATCH_UP[cls][0] - 1) * ref.v + CATCH_UP[cls][1]
      if (this.skipAt == null && err > 60 && err > SKIP_CATCH_UP_S * closing) this.skipAt = this.simT + JUMP_FADE_MS
      if (this.skipAt != null && this.simT >= this.skipAt) {
        this.skipAt = null
        this.s = Math.max(this.s, ref.s)
        this.v = ref.v
        const p = this.path.at(this.s)
        this.px = p.x
        this.py = p.y
        if (this.v > 0.5) this.heading = (headingOf(p.tx, p.ty) + (p.rev ? 180 : 0)) % 360
        this.jumpAt = this.simT
        this.crumbs = [[this.env.frame.lon(this.px), this.env.frame.lat(this.py)]]
        this.crumb = { x: this.px, y: this.py, t: this.simT, hdg: this.heading }
        continue
      }
      let want = ref.v + err / CHASE_S
      if (err < 0) want = Math.max(want, AHEAD_SHARE * ref.v)
      // Catching up is done a little faster than the real thing, never at a dash.
      want = clamp(want, 0, CATCH_UP[cls][0] * ref.v + CATCH_UP[cls][1])
      // Never faster than it can shed by the next fix: it arrives at a stop already slowed, and does not run past it.
      want = Math.min(want, this.timing.brakingLimit(T, this.s + this.v * h, 0.85 * lim.decel))
      if (this.pivot != null && (ref.v > 0.05 || err > 0.5)) {
        // Time to go: swing round on the spot first, then roll off.
        const d = angleDelta(this.heading, this.pivot)
        const rate = 2.5 * LIMITS[cls].turn
        this.heading = (this.heading + clamp(d, -rate * h, rate * h) + 360) % 360
        this.headingKnown = true
        if (Math.abs(d) < 20) this.pivot = null
        else want = Math.min(want, 0.6)
      }
      if (lim.side > 0 && this.v > 1.5) {
        // Slow for the bend ahead, as a taxiing aircraft does: no faster than its cornering allows.
        const look = Math.max(4, this.v * 1.2)
        const bend = this.path.bend(this.s, look)
        if (bend > 0.02) want = Math.min(want, Math.max(1.5, Math.sqrt((lim.side * look) / bend)))
      }
      // Close enough and nothing to chase: stand still (no creeping about a parking spot).
      if (ref.v < 0.05 && Math.abs(err) < 0.3) want = 0
      this.v += clamp(want - this.v, -lim.decel * h, lim.accel * h)
      if (this.v < 0.002 && want === 0) this.v = 0
      if (this.v <= 0) continue
      const pivoting = this.pivot != null
      this.s += this.v * h
      const p = this.path.at(this.s)
      this.px = p.x
      this.py = p.y
      // The nose follows the path (or points back along it during a pushback), no faster than the aircraft could turn at this speed.
      if (!pivoting && (cls !== 'heli' || this.v > HOVER_KT * MPS_PER_KT)) {
        const aim = headingOf(p.tx, p.ty) + (p.rev ? 180 : 0)
        const d = angleDelta(this.heading, aim)
        const turn = cls === 'air' || cls === 'heli' ? Math.min(lim.turn, (8.2 / Math.max(this.v, 8)) * 57.3 + 2) : Math.min(lim.turn, (this.v / lim.radius) * 57.3 + 1.5)
        this.heading = (this.heading + clamp(d * (1 - Math.exp(-h / lim.settle)), -turn * h, turn * h) + 360) % 360
        this.headingKnown = true
      }
    }
    this.simT = now
    this.dropCrumb(now)
    if (this.path.size > 160) this.path.prune(this.s - 5)
    if (this.timing.count > 40) {
      const before = this.timing.count
      this.timing.prune(now - this.delay - 5000)
      this.settledKnots -= before - this.timing.count
    }
  }

  private clsNow(): MotionClass {
    if (this.cls === 'vehicle' || this.cls === 'heli') return this.cls
    return this.shown().onGround ? 'ground' : 'air'
  }

  /** The drawn time has reached a relocation: reappear at the new place. */
  private startOver(now: number) {
    const fixes = this.restart!
    this.restart = null
    this.begin(fixes[0], fixes[0].t, false)
    this.v = fixes[0].v > STOPPED_KT * MPS_PER_KT ? fixes[0].v : 0
    for (let i = 1; i < fixes.length; i++) {
      if (plausible(fixes[i - 1], fixes[i]) && fixes[i].t - fixes[i - 1].t <= GAP_RESTART_MS) this.extend(fixes[i], now)
      else {
        this.restart = fixes.slice(i)
        break
      }
    }
    this.jumpAt = now
    this.crumbs = [[this.env.frame.lon(this.px), this.env.frame.lat(this.py)]]
    this.crumb = { x: this.px, y: this.py, t: now, hdg: this.heading }
  }

  private dropCrumb(now: number) {
    const c = this.crumb
    const moved = Math.hypot(this.px - c.x, this.py - c.y)
    if (moved < CRUMB_MIN_M) return
    if (now - c.t < CRUMB_MS && Math.abs(angleDelta(c.hdg, this.heading)) < CRUMB_TURN_DEG) return
    this.crumbs.push([this.env.frame.lon(this.px), this.env.frame.lat(this.py)])
    if (this.crumbs.length > HISTORY_POINTS) this.crumbs.shift()
    this.crumb = { x: this.px, y: this.py, t: now, hdg: this.heading }
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /** The fix in force at the drawn time (the last one measured at or before it), and the next. */
  private shown(): Fix {
    return this.bracket().a
  }

  private bracket(): { a: Fix; b: Fix | null; u: number } {
    const T = this.simT - this.delay
    const fx = this.fixes
    let i = Math.min(this.fixCur, fx.length - 1)
    while (i > 0 && fx[i].t > T) i--
    while (i < fx.length - 1 && fx[i + 1].t <= T) i++
    this.fixCur = i
    if (fx.length > 12 && i > 6) {
      this.fixes = fx.slice(i - 2)
      this.fixCur = 2
      return this.bracket()
    }
    const a = fx[i]
    const b = i < fx.length - 1 && a.t <= T ? fx[i + 1] : null
    return { a, b, u: b ? clamp((T - a.t) / (b.t - a.t), 0, 1) : 0 }
  }

  /** The aircraft as drawn right now. Height, speed and the like are those of the moment being drawn, eased between fixes. */
  drawn(): DrawnAircraft {
    const { a, b, u } = this.bracket()
    const lerp = (x: number | null | undefined, y: number | null | undefined) => (x == null ? (y ?? null) : y == null ? x : x + (y - x) * u)
    const near = b && u >= 0.5 ? b : a
    return {
      lon: this.env.frame.lon(this.px),
      lat: this.env.frame.lat(this.py),
      heading: this.heading,
      headingKnown: this.headingKnown,
      altitudeFt: b ? lerp(a.ac.altitudeFt, b.ac.altitudeFt) : a.ac.altitudeFt,
      speedKt: b ? lerp(a.ac.speedKt, b.ac.speedKt) : a.ac.speedKt,
      verticalRateFpm: near.ac.verticalRateFpm,
      onGround: near.onGround,
    }
  }

  /** 1 normally; dips to 0 and back around a relocation or a skip ahead, so the aircraft fades across instead of sliding. */
  jumpFade(now: number): number {
    let out = 1
    if (this.restart) {
      const left = this.restart[0].t - (now - this.delay)
      if (left < JUMP_FADE_MS) out = clamp(left / JUMP_FADE_MS, 0, 1)
    }
    if (this.skipAt != null) out = Math.min(out, clamp((this.skipAt - now) / JUMP_FADE_MS, 0, 1))
    const since = now - this.jumpAt
    return since < 2 * JUMP_FADE_MS ? Math.min(out, clamp(since / (2 * JUMP_FADE_MS), 0, 1)) : out
  }

  /** Past drawn positions, oldest first, ending where it is drawn now. */
  trail(maxPoints: number): [number, number][] {
    const end: [number, number] = [this.env.frame.lon(this.px), this.env.frame.lat(this.py)]
    const past = maxPoints > 1 ? this.crumbs.slice(-(maxPoints - 1)) : []
    return [...past, end]
  }

  /** Median time between this aircraft's own recent fixes, ms (null until there are a few). */
  ownInterval(): number | null {
    if (this.intervals.length < 3) return null
    const s = [...this.intervals].sort((x, y) => x - y)
    return s[s.length >> 1]
  }

  /** For tests and the debug overlay: distance left between the drawn point and the end of the settled path. */
  get slack(): number {
    return this.settledS - this.s
  }
}

/** The tightest radius (metres) of a curve that starts along `d0` and runs through `pts` (which carry their directions). */
function tightest(d0: XY, pts: PathPoint[]): number {
  let r = Infinity
  let tx = d0.x
  let ty = d0.y
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    if (p.tx == null || p.ty == null) continue
    const ds = i === 0 ? 0 : Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y)
    const turn = Math.acos(clamp(tx * p.tx + ty * p.ty, -1, 1))
    if (i > 0 && turn > 0.02) r = Math.min(r, ds / turn)
    tx = p.tx
    ty = p.ty
  }
  return r
}

function unit(dx: number, dy: number): XY | null {
  const l = Math.hypot(dx, dy)
  return l > 1e-6 ? { x: dx / l, y: dy / l } : null
}

/** The edge's direction, signed to run the way `travel` does. */
function along(s: Snap, travel: XY): XY {
  return s.ux * travel.x + s.uy * travel.y >= 0 ? { x: s.ux, y: s.uy } : { x: -s.ux, y: -s.uy }
}

export function classOf(ac: { type?: string | null; category?: string | null }): MotionClass {
  const shape = shapeFor({ type: ac.type, category: ac.category })
  if (shape === 'ac-vehicle') return 'vehicle'
  if (shape === 'ac-heli') return 'heli'
  return 'air'
}

/**
 * How far a fix may be from the end of the path and still count as "hasn't
 * moved". An aircraft that was already standing is held through a lot of
 * wander (parked transponders drift by tens of metres); one that is moving,
 * or just coming to a stop, only through a few metres of noise, so it stops
 * where it really stopped. Vehicles are filtered harder.
 */
function holdRadius(f: Fix, cls: MotionClass, wasStanding: boolean): number {
  const kt = f.v / MPS_PER_KT
  if (f.onGround) {
    if (!wasStanding) return cls === 'vehicle' ? 6 : 3
    if (kt < 2) return 40
    if (kt < 6) return cls === 'vehicle' ? 18 : 12
    return cls === 'vehicle' ? 8 : 4
  }
  // A hovering helicopter.
  return cls === 'heli' && kt < 5 ? 15 : 0
}

/**
 * Could the aircraft have got from fix `a` to fix `b` in the time between
 * them? The speed that would take is compared with the fastest it reports,
 * with a generous margin (reports lag an accelerating aircraft).
 */
export function plausible(a: Fix | { x: number; y: number; t: number; v: number; onGround: boolean }, b: typeof a): boolean {
  const d = dist(a, b)
  if (d > TELEPORT_M && b.t - a.t < 60_000) return false
  const dt = Math.max(0.5, (b.t - a.t) / 1000)
  const air = !a.onGround || !b.onGround
  return d / dt <= 2.2 * Math.max(a.v, b.v) + (air ? 60 : 12)
}
