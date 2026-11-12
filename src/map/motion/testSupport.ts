/**
 * Test helpers for the motion model: a made-up airfield, aircraft that follow
 * known paths, and a driver that feeds a buffer the way the app does (a poll
 * every few seconds, a frame every 16 ms) while recording what was drawn.
 */
import type { Aircraft } from '../../api/types'
import { offset, toLocal, type LngLat } from '../geo'
import { LivePositionBuffer, type LiveAircraft } from '../livePositions'
import type { PavementData } from './pavement'
import { headingOf, MPS_PER_KT, type XY } from './plane'

export const ORIGIN: LngLat = [-87.9, 41.97]

/** Local metres to lng/lat around `ORIGIN` (the frame the tests' buffers use). */
export const ll = (x: number, y: number): LngLat => offset(ORIGIN, x, y)
export const xy = (lon: number, lat: number): XY => {
  const [x, y] = toLocal(ORIGIN, [lon, lat])
  return { x, y }
}

export function aircraft(id: string, x: number, y: number, heading: number, speedKt: number | null, onGround: boolean, extra: Partial<Aircraft> = {}): Aircraft {
  const [lon, lat] = ll(x, y)
  return { icao24: id, callsign: id.toUpperCase(), lat, lon, heading, altitudeFt: onGround ? null : 3000, speedKt, onGround, ...extra }
}

/** Position and direction `d` metres along a polyline (clamped to its ends). */
export function alongLine(pts: XY[], d: number): XY & { heading: number } {
  let left = Math.max(0, d)
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (left <= len || i === pts.length - 1) {
      const u = Math.min(1, left / len)
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * u, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * u, heading: headingOf(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) }
    }
    left -= len
  }
  return { ...pts[0], heading: 0 }
}

/** Shortest distance from `p` to a polyline. */
export function distanceToLine(p: XY, pts: XY[]): number {
  let best = Infinity
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const l2 = dx * dx + dy * dy
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)))
  }
  return best
}

/**
 * A small airfield:
 *
 *   - taxiway A runs east along y = 0 from x = -600 to x = 600;
 *   - taxiway B runs north from (200, 0) to (200, 500), where it meets
 *   - the runway, along y = 500 from x = -1500 to x = 1500, 45 m wide;
 *   - taxiway C is parallel to A, 90 m south of it;
 *   - an apron fills the rectangle south of C.
 */
export const TAXI_A: XY[] = [
  { x: -600, y: 0 },
  { x: 600, y: 0 },
]
export const TAXI_B: XY[] = [
  { x: 200, y: 0 },
  { x: 200, y: 500 },
]
export const TAXI_C: XY[] = [
  { x: -600, y: -90 },
  { x: 600, y: -90 },
]
export const RUNWAY: XY[] = [
  { x: -1500, y: 500 },
  { x: 1500, y: 500 },
]
export const APRON: XY[] = [
  { x: -600, y: -400 },
  { x: 600, y: -400 },
  { x: 600, y: -120 },
  { x: -600, y: -120 },
  { x: -600, y: -400 },
]

/** Split a line into pieces, as map data has it (many short segments). */
const dense = (pts: XY[], step = 40): LngLat[] => {
  const out: LngLat[] = []
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    const n = Math.max(1, Math.round(len / step))
    for (let k = i === 1 ? 0 : 1; k <= n; k++) out.push(ll(pts[i - 1].x + ((pts[i].x - pts[i - 1].x) * k) / n, pts[i - 1].y + ((pts[i].y - pts[i - 1].y) * k) / n))
  }
  return out
}

export function airfield(): PavementData {
  return {
    taxiways: [
      { ref: 'A', coords: dense(TAXI_A) },
      { ref: 'B', coords: dense(TAXI_B) },
      { ref: 'C', coords: dense(TAXI_C) },
    ],
    runways: [{ ref: '09/27', kind: 'runway', coords: dense(RUNWAY, 300) }],
    aprons: [[APRON.map((p) => ll(p.x, p.y))]],
    strips: [{ a: ll(RUNWAY[0].x, RUNWAY[0].y), b: ll(RUNWAY[1].x, RUNWAY[1].y), widthM: 45 }],
  }
}

/** A buffer whose local frame is the test airfield's. */
export function bufferAt(pavement: PavementData | null = null): LivePositionBuffer {
  const b = new LivePositionBuffer()
  // The first aircraft ever pushed sets the frame; park one at the origin and let it leave.
  b.push([aircraft('frame', 0, 0, 0, 0, true)], -100_000, 0)
  b.push([], -99_000, 0)
  b.push([], -98_000, 0)
  b.sample(-90_000)
  if (pavement) b.setPavement(pavement)
  return b
}

export type Frame = { t: number; x: number; y: number; heading: number; opacity: number; s: number; v: number; a: LiveAircraft }

export type Feed = (t: number) => Aircraft[] | null

/**
 * Run a buffer for `durMs`: every `pollMs` the feed is asked where things
 * were `ageMs` ago (reports are old on arrival) and that is pushed; every
 * 16 ms a frame is sampled. Returns what was drawn for `id`. A feed returning
 * null is a poll that failed.
 */
export function drive(b: LivePositionBuffer, feed: Feed, id: string, o: { durMs: number; pollMs?: number; ageMs?: number; frameMs?: number; startMs?: number; stamp?: boolean }): Frame[] {
  const pollMs = o.pollMs ?? 8000
  const ageMs = o.ageMs ?? 1500
  const frameMs = o.frameMs ?? 16
  const start = o.startMs ?? 0
  const out: Frame[] = []
  let nextPoll = start
  const WALL = 1_700_000_000_000
  for (let t = start; t <= start + o.durMs; t += frameMs) {
    if (t >= nextPoll) {
      nextPoll += pollMs
      const list = feed(t - ageMs)
      if (list) {
        // Date the reports as the feed would, unless the feed already did (or the test wants them undated).
        if (o.stamp !== false) for (const a of list) a.positionTime ??= WALL + t - ageMs
        b.push(list, t, WALL + t)
      }
    }
    const a = b.sample(t).find((x) => x.icao24 === id)
    if (!a) continue
    const m = b.motion(id, t)!
    const p = xy(a.lon, a.lat)
    out.push({ t, x: p.x, y: p.y, heading: a.heading, opacity: a.opacity, s: m.s, v: m.v, a })
  }
  return out
}

/** The worst step against the direction the aircraft is pointing, metres (0 when it never moved backwards). */
export function worstBackStep(frames: Frame[]): number {
  let worst = 0
  for (let i = 1; i < frames.length; i++) {
    const h = (frames[i].heading * Math.PI) / 180
    const along = (frames[i].x - frames[i - 1].x) * Math.sin(h) + (frames[i].y - frames[i - 1].y) * Math.cos(h)
    worst = Math.min(worst, along)
  }
  return worst
}

/**
 * Largest change of drawn speed between frames (m/s²), jump of position
 * beyond what the speed explains (m), and turn of the nose (°/s). Frames in
 * which the aircraft is invisible (the middle of a fade across) don't count.
 */
export function roughness(frames: Frame[]): { accel: number; jump: number; turn: number } {
  let accel = 0
  let jump = 0
  let turn = 0
  for (let i = 1; i < frames.length; i++) {
    const dt = (frames[i].t - frames[i - 1].t) / 1000
    if (dt <= 0 || frames[i].opacity < 0.05 || frames[i - 1].opacity < 0.05) continue
    const step = Math.hypot(frames[i].x - frames[i - 1].x, frames[i].y - frames[i - 1].y)
    accel = Math.max(accel, Math.abs(frames[i].v - frames[i - 1].v) / dt)
    // The curve between path points is a touch longer than the distance counted along it; allow for that.
    jump = Math.max(jump, step - Math.max(frames[i].v, frames[i - 1].v) * dt * 1.1)
    const dh = Math.abs(((frames[i].heading - frames[i - 1].heading + 540) % 360) - 180)
    turn = Math.max(turn, dh / dt)
  }
  return { accel, jump, turn }
}

/** A seeded random number generator (mulberry32), so "random" tests fail the same way twice. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const kt = (mps: number) => mps / MPS_PER_KT
