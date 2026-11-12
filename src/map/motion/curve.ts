/**
 * The two halves of an aircraft's drawn motion, kept apart on purpose:
 *
 *  - `Path` is *where* it goes: one continuous curve through its reported
 *    positions, measured by distance along it. It only ever grows at the far
 *    end, so the part already drawn never changes.
 *  - `Timing` is *when*: how far along the path the aircraft had got at each
 *    report, joined by a curve that never decreases, so the aircraft can
 *    slow down or stop but cannot go backwards.
 *
 * Splitting them means a noisy or late report can bend the road ahead or
 * change the pace, but can never pull the drawn aircraft back.
 */
import { clamp, type XY } from './plane'

export type PathPoint = XY & {
  /** Unit direction of travel here, when the builder knows it (curves do; polylines leave it to be worked out). */
  tx?: number
  ty?: number
}

export type PathPose = {
  x: number
  y: number
  /** Unit direction of travel. */
  tx: number
  ty: number
  /** Moving tail-first here (a pushback): the nose points against the direction of travel. */
  rev: boolean
}

/** Two directions further apart than this meet in a corner the aircraft cannot sweep through: it stops and sets off the other way. */
const CUSP_COS = Math.cos((115 * Math.PI) / 180)
const MIN_STEP_M = 0.05

/**
 * A curve built from points, travelled by distance. Between points the
 * position follows a cubic through them that leaves each along its direction
 * of travel, so the drawn track has no kinks even where it was built from a
 * polyline.
 */
export class Path {
  private x: number[] = []
  private y: number[] = []
  private s: number[] = []
  private tx: number[] = []
  private ty: number[] = []
  private rev: boolean[] = []
  private cur = 0

  /** Distance along the path of its far end. */
  get length(): number {
    return this.s.length ? this.s[this.s.length - 1] : 0
  }
  /** Distance along the path of its oldest remembered point. */
  get start(): number {
    return this.s.length ? this.s[0] : 0
  }
  get empty(): boolean {
    return this.s.length === 0
  }
  get size(): number {
    return this.s.length
  }

  /** Begin (or begin again) at `p`, heading along the unit vector `(tx, ty)`, counting distance from `s0`. */
  reset(p: XY, tx: number, ty: number, s0 = 0) {
    this.x = [p.x]
    this.y = [p.y]
    this.s = [s0]
    this.tx = [tx]
    this.ty = [ty]
    this.rev = [false]
    this.cur = 0
  }

  end(): PathPose {
    const i = this.s.length - 1
    return { x: this.x[i], y: this.y[i], tx: this.tx[i], ty: this.ty[i], rev: this.rev[i] }
  }

  /**
   * Add points beyond the end (points closer than a few centimetres to the
   * one before are skipped). `rev` marks the stretch as travelled tail-first.
   * `startDir` says the new stretch leaves the end in that direction whatever
   * way the path arrived (the aircraft was standing still there); without it a
   * reversal becomes a stop-and-go corner, never an instant swing.
   *
   * The end as it stands is never altered, direction included: the aircraft
   * may be drawn on the stretch leading up to it, and that must not move.
   */
  append(pts: PathPoint[], rev = false, startDir: XY | null = null) {
    const i0 = this.s.length - 1
    const kept: PathPoint[] = []
    let px = this.x[i0]
    let py = this.y[i0]
    for (const q of pts) {
      if (Math.hypot(q.x - px, q.y - py) < MIN_STEP_M) continue
      kept.push(q)
      px = q.x
      py = q.y
    }
    if (!kept.length) return
    const l0 = Math.hypot(kept[0].x - this.x[i0], kept[0].y - this.y[i0])
    const ux = (kept[0].x - this.x[i0]) / l0
    const uy = (kept[0].y - this.y[i0]) / l0
    if (startDir) {
      // The way it arrived stays as drawn; a twin of the end vertex faces the way it leaves.
      if (this.tx[i0] * startDir.x + this.ty[i0] * startDir.y < 0.985) this.twin(i0, startDir.x, startDir.y)
    } else if (this.tx[i0] * ux + this.ty[i0] * uy < CUSP_COS) this.twin(i0, ux, uy)
    for (let k = 0; k < kept.length; k++) {
      const q = kept[k]
      const j = this.s.length - 1
      const dx = q.x - this.x[j]
      const dy = q.y - this.y[j]
      const len = Math.hypot(dx, dy)
      let tx = dx / len
      let ty = dy / len
      if (q.tx != null && q.ty != null) {
        tx = q.tx
        ty = q.ty
      } else if (k < kept.length - 1) {
        // Inside a polyline: head between the way in and the way out.
        const n = kept[k + 1]
        const ol = Math.hypot(n.x - q.x, n.y - q.y)
        const bx = tx + (n.x - q.x) / ol
        const by = ty + (n.y - q.y) / ol
        const bl = Math.hypot(bx, by)
        if (bl > 0.2) {
          tx = bx / bl
          ty = by / bl
        }
      }
      this.x.push(q.x)
      this.y.push(q.y)
      this.s.push(this.s[j] + len)
      this.tx.push(tx)
      this.ty.push(ty)
      this.rev.push(rev)
    }
  }

  /** A second vertex at the same place as vertex `i` (the last), facing `(ux, uy)`. */
  private twin(i: number, ux: number, uy: number) {
    this.x.push(this.x[i])
    this.y.push(this.y[i])
    this.s.push(this.s[i])
    this.tx.push(ux)
    this.ty.push(uy)
    this.rev.push(this.rev[i])
  }

  /** Index of the segment holding distance `at` (its start vertex). */
  private seg(at: number): number {
    const s = this.s
    const n = s.length
    let i = Math.min(this.cur, n - 2)
    if (i < 0) return 0
    if (s[i] > at) {
      // Rare (a caller looking back): bisect.
      let lo = 0
      let hi = i
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (s[mid] <= at) lo = mid
        else hi = mid - 1
      }
      i = lo
    } else while (i < n - 2 && s[i + 1] <= at) i++
    // Skip the zero-length twins left by reversals.
    while (i < n - 2 && s[i + 1] - s[i] < 1e-9) i++
    this.cur = i
    return i
  }

  /** Position and direction `at` metres along the path. Past the end it carries straight on; before the start it stays at the start. */
  at(at: number): PathPose {
    const n = this.s.length
    if (n === 1 || at >= this.s[n - 1]) {
      const i = n - 1
      const over = Math.max(0, at - this.s[i])
      return { x: this.x[i] + this.tx[i] * over, y: this.y[i] + this.ty[i] * over, tx: this.tx[i], ty: this.ty[i], rev: this.rev[i] }
    }
    if (at <= this.s[0]) return { x: this.x[0], y: this.y[0], tx: this.tx[0], ty: this.ty[0], rev: this.rev[Math.min(1, n - 1)] }
    const i = this.seg(at)
    const L = this.s[i + 1] - this.s[i]
    if (L < 1e-9) return { x: this.x[i + 1], y: this.y[i + 1], tx: this.tx[i + 1], ty: this.ty[i + 1], rev: this.rev[i + 1] }
    const u = (at - this.s[i]) / L
    const u2 = u * u
    const u3 = u2 * u
    const h00 = 2 * u3 - 3 * u2 + 1
    const h10 = u3 - 2 * u2 + u
    const h01 = -2 * u3 + 3 * u2
    const h11 = u3 - u2
    const x = h00 * this.x[i] + h10 * L * this.tx[i] + h01 * this.x[i + 1] + h11 * L * this.tx[i + 1]
    const y = h00 * this.y[i] + h10 * L * this.ty[i] + h01 * this.y[i + 1] + h11 * L * this.ty[i + 1]
    const d00 = 6 * u2 - 6 * u
    const d10 = 3 * u2 - 4 * u + 1
    const d01 = -d00
    const d11 = 3 * u2 - 2 * u
    let dx = d00 * this.x[i] + d10 * L * this.tx[i] + d01 * this.x[i + 1] + d11 * L * this.tx[i + 1]
    let dy = d00 * this.y[i] + d10 * L * this.ty[i] + d01 * this.y[i + 1] + d11 * L * this.ty[i + 1]
    const l = Math.hypot(dx, dy)
    if (l > 1e-9) {
      dx /= l
      dy /= l
    } else {
      dx = this.tx[i + 1]
      dy = this.ty[i + 1]
    }
    return { x, y, tx: dx, ty: dy, rev: this.rev[i + 1] }
  }

  /** How much the path turns over the `ahead` metres after `at`, radians (0 beyond its end). */
  bend(at: number, ahead: number): number {
    const end = this.s[this.s.length - 1]
    if (at >= end) return 0
    const a = this.at(at)
    const mid = this.at(Math.min(end, at + ahead / 2))
    const b = this.at(Math.min(end, at + ahead))
    // Via the midpoint, so a full turn-back counts as one and not as nothing.
    const t1 = Math.acos(clamp(a.tx * mid.tx + a.ty * mid.ty, -1, 1))
    const t2 = Math.acos(clamp(mid.tx * b.tx + mid.ty * b.ty, -1, 1))
    // The cursor goes back to where the aircraft is.
    this.seg(at)
    return t1 + t2
  }

  /** Cut the path off `at` metres along (or, past the end, extend it straight to there), so a new stretch can start from exactly that point. */
  cut(at: number) {
    const n = this.s.length
    const p = this.at(at)
    if (at >= this.s[n - 1]) {
      if (at - this.s[n - 1] < MIN_STEP_M) return
      this.x.push(p.x)
      this.y.push(p.y)
      this.s.push(at)
      this.tx.push(p.tx)
      this.ty.push(p.ty)
      this.rev.push(p.rev)
      return
    }
    if (at <= this.s[0]) {
      this.reset({ x: this.x[0], y: this.y[0] }, this.tx[0], this.ty[0], this.s[0])
      return
    }
    const i = this.seg(at)
    const keep = i + 1
    this.x.length = keep
    this.y.length = keep
    this.s.length = keep
    this.tx.length = keep
    this.ty.length = keep
    this.rev.length = keep
    if (at - this.s[i] < MIN_STEP_M) {
      this.cur = Math.max(0, i - 1)
      return
    }
    this.x.push(p.x)
    this.y.push(p.y)
    this.s.push(at)
    this.tx.push(p.tx)
    this.ty.push(p.ty)
    this.rev.push(p.rev)
    this.cur = Math.max(0, i - 1)
  }

  /** Forget everything more than a point behind `before` metres along. */
  prune(before: number) {
    let k = 0
    while (k < this.s.length - 2 && this.s[k + 1] < before) k++
    if (k < 48) return
    this.x = this.x.slice(k)
    this.y = this.y.slice(k)
    this.s = this.s.slice(k)
    this.tx = this.tx.slice(k)
    this.ty = this.ty.slice(k)
    this.rev = this.rev.slice(k)
    this.cur = Math.max(0, this.cur - k)
  }
}

/**
 * A smooth curve from `p0`, leaving along the unit vector `d0`, to `p1`,
 * arriving along `d1`: what an aircraft flies or taxies between two reports
 * when nothing else is known. Returned as points with their directions (not
 * including `p0`), close enough together to read as an arc.
 */
export function hermitePoints(p0: XY, d0: XY, p1: XY, d1: XY): PathPoint[] {
  const cx = p1.x - p0.x
  const cy = p1.y - p0.y
  const c = Math.hypot(cx, cy)
  if (c < MIN_STEP_M) return []
  const ux = cx / c
  const uy = cy / c
  const turn = Math.acos(clamp(d0.x * d1.x + d0.y * d1.y, -1, 1))
  // A circular arc's handles are a little longer than its chord; a handle pointing away from the far end is kept short, or the curve balloons out.
  const arc = turn < 1e-3 ? 1 : clamp(turn / 2 / Math.sin(turn / 2), 1, 1.45)
  const m0 = c * (d0.x * ux + d0.y * uy < -0.2 ? 0.55 : arc)
  const m1 = c * (d1.x * ux + d1.y * uy < -0.2 ? 0.55 : arc)
  const bend = (Math.acos(clamp(d0.x * ux + d0.y * uy, -1, 1)) + Math.acos(clamp(d1.x * ux + d1.y * uy, -1, 1))) * (180 / Math.PI)
  const n = clamp(Math.ceil(bend / 5) + Math.ceil(c / 400), 1, 36)
  const out: PathPoint[] = []
  for (let k = 1; k <= n; k++) {
    const u = k / n
    const u2 = u * u
    const u3 = u2 * u
    const h00 = 2 * u3 - 3 * u2 + 1
    const h10 = u3 - 2 * u2 + u
    const h01 = -2 * u3 + 3 * u2
    const h11 = u3 - u2
    const d00 = 6 * u2 - 6 * u
    const d10 = 3 * u2 - 4 * u + 1
    const d11 = 3 * u2 - 2 * u
    let dx = d00 * p0.x + d10 * m0 * d0.x - d00 * p1.x + d11 * m1 * d1.x
    let dy = d00 * p0.y + d10 * m0 * d0.y - d00 * p1.y + d11 * m1 * d1.y
    const l = Math.hypot(dx, dy)
    if (l > 1e-9) {
      dx /= l
      dy /= l
    } else {
      dx = ux
      dy = uy
    }
    out.push({
      x: h00 * p0.x + h10 * m0 * d0.x + h01 * p1.x + h11 * m1 * d1.x,
      y: h00 * p0.y + h10 * m0 * d0.y + h01 * p1.y + h11 * m1 * d1.y,
      tx: k === n ? d1.x : dx,
      ty: k === n ? d1.y : dy,
    })
  }
  return out
}

/**
 * Round the corners of a polyline (a route along taxiway centrelines): each
 * corner is replaced by a short curve that starts and ends up to `radiusM`-ish
 * back from it, the way the painted lead-in line does, so the path turns with
 * the taxiway rather than pivoting on the spot.
 */
export function roundCorners(pts: XY[], radiusM: number): XY[] {
  if (pts.length < 3) return pts.slice()
  const out: XY[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const c = pts[i + 1]
    const l1 = Math.hypot(b.x - a.x, b.y - a.y)
    const l2 = Math.hypot(c.x - b.x, c.y - b.y)
    if (l1 < 1e-6 || l2 < 1e-6) continue
    const cos = ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) / (l1 * l2)
    const turn = Math.acos(clamp(cos, -1, 1))
    if (turn < (8 * Math.PI) / 180) {
      out.push(b)
      continue
    }
    // Tangent length of a fillet of this radius, limited so neighbouring corners don't overlap.
    const d = Math.min(radiusM * Math.tan(Math.min(turn, 2.6) / 2), 0.45 * l1, 0.45 * l2)
    const p = { x: b.x - ((b.x - a.x) / l1) * d, y: b.y - ((b.y - a.y) / l1) * d }
    const q = { x: b.x + ((c.x - b.x) / l2) * d, y: b.y + ((c.y - b.y) / l2) * d }
    const steps = clamp(Math.ceil((turn * 180) / Math.PI / 12), 2, 10)
    for (let k = 0; k <= steps; k++) {
      const u = k / steps
      const w0 = (1 - u) * (1 - u)
      const w1 = 2 * u * (1 - u)
      const w2 = u * u
      out.push({ x: w0 * p.x + w1 * b.x + w2 * q.x, y: w0 * p.y + w1 * b.y + w2 * q.y })
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

/**
 * Distance along the path against time: one knot per report, joined by a
 * curve that is smooth in speed and never decreases.
 */
export class Timing {
  private t: number[] = []
  private s: number[] = []
  /** Speed wanted at each knot (m/s), before it is limited to keep the curve from dipping. */
  private want: number[] = []
  private m: number[] = []
  private cur = 0

  get count(): number {
    return this.t.length
  }
  get lastT(): number {
    return this.t[this.t.length - 1]
  }
  get lastS(): number {
    return this.s[this.s.length - 1]
  }
  get firstT(): number {
    return this.t[0]
  }
  /** Speed at the newest knot, m/s. */
  get lastV(): number {
    return this.m[this.m.length - 1] ?? 0
  }

  reset() {
    this.t = []
    this.s = []
    this.want = []
    this.m = []
    this.cur = 0
  }

  /** Add a knot: at time `t` (ms) the aircraft is `s` metres along, doing about `v` m/s (null: unknown, taken from the spacing). */
  add(t: number, s: number, v: number | null) {
    const n = this.t.length
    if (n && t <= this.t[n - 1]) t = this.t[n - 1] + 1
    if (n) s = Math.max(s, this.s[n - 1])
    this.t.push(t)
    this.s.push(s)
    this.want.push(v ?? -1)
    this.m.push(0)
    this.slope(n)
    if (n) this.slope(n - 1)
  }

  /** Speed at knot `i`: the reported speed blended with what the spacing implies, limited so the curve stays monotonic. */
  private slope(i: number) {
    const n = this.t.length
    const before = i > 0 ? ((this.s[i] - this.s[i - 1]) * 1000) / (this.t[i] - this.t[i - 1]) : null
    const after = i < n - 1 ? ((this.s[i + 1] - this.s[i]) * 1000) / (this.t[i + 1] - this.t[i]) : null
    const implied = before != null && after != null ? (before + after) / 2 : (before ?? after ?? 0)
    // A reported standstill is a standstill; otherwise the report and the spacing each get a say (either alone makes the speed pulse when they disagree).
    const v = this.want[i] === 0 ? 0 : this.want[i] > 0 ? 0.5 * this.want[i] + 0.5 * implied : implied
    // Fritsch–Carlson: an end slope of at most three times the average slope cannot make the cubic turn back.
    const cap = 3 * Math.min(before ?? Infinity, after ?? Infinity)
    this.m[i] = clamp(v, 0, Number.isFinite(cap) ? cap : Math.max(0, this.want[i]))
  }

  /** Where along the path the aircraft is at time `t`, and how fast (m/s). Outside the knots it holds the nearest one. */
  at(t: number): { s: number; v: number } {
    const n = this.t.length
    if (n === 0) return { s: 0, v: 0 }
    if (t <= this.t[0]) return { s: this.s[0], v: 0 }
    if (t >= this.t[n - 1]) return { s: this.s[n - 1], v: 0 }
    let i = Math.min(this.cur, n - 2)
    if (this.t[i] > t) i = 0
    while (i < n - 2 && this.t[i + 1] <= t) i++
    this.cur = i
    const h = (this.t[i + 1] - this.t[i]) / 1000
    const u = (t - this.t[i]) / (this.t[i + 1] - this.t[i])
    const u2 = u * u
    const u3 = u2 * u
    const s = (2 * u3 - 3 * u2 + 1) * this.s[i] + (u3 - 2 * u2 + u) * h * this.m[i] + (-2 * u3 + 3 * u2) * this.s[i + 1] + (u3 - u2) * h * this.m[i + 1]
    const v = ((6 * u2 - 6 * u) * (this.s[i] - this.s[i + 1])) / h + (3 * u2 - 4 * u + 1) * this.m[i] + (3 * u2 - 2 * u) * this.m[i + 1]
    return { s, v: Math.max(0, v) }
  }

  /**
   * The slowest speed (m/s) the aircraft may have at `s` metres along and
   * still be able to slow, at `decel` m/s², to the speed of each of the next
   * few knots after time `t` by the time it gets there. Infinity past the
   * last knot.
   */
  brakingLimit(t: number, s: number, decel: number): number {
    const n = this.t.length
    if (n === 0 || t >= this.t[n - 1]) return Infinity
    let i = Math.min(this.cur, n - 1)
    if (this.t[i] > t) i = 0
    while (i < n && this.t[i] <= t) i++
    let limit = Infinity
    for (let k = i; k < n && k < i + 3; k++) {
      const v = Math.sqrt(this.m[k] * this.m[k] + 2 * decel * Math.max(0, this.s[k] - s))
      if (v < limit) limit = v
    }
    return limit
  }

  /** Keep only the first `n` knots (the rest were forecasts that a new report replaces). */
  truncate(n: number) {
    if (n >= this.t.length) return
    this.t.length = n
    this.s.length = n
    this.want.length = n
    this.m.length = n
    if (n) this.slope(n - 1)
    this.cur = Math.max(0, Math.min(this.cur, n - 2))
  }

  /** Drop knots that ended more than one knot before time `t`. */
  prune(t: number) {
    let k = 0
    while (k < this.t.length - 2 && this.t[k + 1] < t) k++
    if (k < 16) return
    this.t = this.t.slice(k)
    this.s = this.s.slice(k)
    this.want = this.want.slice(k)
    this.m = this.m.slice(k)
    this.cur = Math.max(0, this.cur - k)
  }
}
