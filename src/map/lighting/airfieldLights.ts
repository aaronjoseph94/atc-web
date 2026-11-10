/**
 * The airfield's lights, as GeoJSON points for the night map.
 *
 * Runway lighting is generated once per airport from the runway geometry the
 * painted diagram uses (`runwayEnds`), laid out after FAA AC 150/5340-30 (and
 * ICAO Annex 14 for the approach lights outside the US), simplified to what
 * reads from above:
 *   - edge lights, white every 60 m along both edges, yellow on the last 600 m;
 *   - threshold lights, a green row across each threshold, and runway end
 *     lights, a red row just inside each pavement end;
 *   - centreline lights on the long, wide runways that have them, white,
 *     then alternating red and white over the last 900 m and red over the last 300 m;
 *   - approach lights (white bars every 30 m, plus crossbars) beyond each
 *     threshold of a runway long and wide enough to have an ILS. The data has
 *     no ILS flag, so this is an approximation.
 * Taxiway lights (blue edges, green centrelines) and apron floodlight glows
 * come from the map tiles' taxiway, apron and gate geometry, like the hold bars.
 *
 * Every light carries its glow colour (`c`), a whiter core colour (`k`) and
 * a size factor (`s`); apron glows carry a radius in pixels at zoom 0 (`r`).
 */
import type { Feature, Point } from 'geojson'
import { icaoCode } from '../../api/airportData'
import { markingSpec, runwayEnds, type RunwayEndGeometry } from '../airportDiagram'
import { metersPerPixel, offset, toLocal, type LngLat } from '../geo'
import { formatColor, mixColor, parseColor } from './color'

export type LightFeature = Feature<Point, { c: string; k: string; s: number }>
export type GlowFeature = Feature<Point, { r: number }>

/** Light colours, sampled to read as the real fixtures do in night photos. */
export const LIGHT = {
  white: '#FFE6B0',
  yellow: '#FFC02E',
  green: '#2EE58C',
  red: '#FF3B2F',
  approach: '#F4F6FF',
  taxiBlue: '#4A74FF',
  taxiGreen: '#2FD877',
} as const

/** A light point with its whiter core colour worked out. */
function light(p: LngLat, color: string, size = 1): LightFeature {
  const c = parseColor(color)!
  const core = formatColor(mixColor(c, [255, 255, 255, 1], 0.55))
  return { type: 'Feature', properties: { c: color, k: core, s: size }, geometry: { type: 'Point', coordinates: p } }
}

/** Edge-light spacing (FAA: 200 ft at most). */
export const EDGE_SPACING_M = 60
/** Length of the yellow caution zone at the end of an instrument runway (2,000 ft). */
export const CAUTION_M = 600
/** Centreline lights are 50 ft apart in reality; every other one keeps the look and halves the count. */
export const CENTRE_SPACING_M = 30
/** Runways at least this long and wide get centreline and approach lights. */
const CENTRELINE_MIN = { lengthM: 2400, widthM: 44 }
const ILS_MIN = { lengthM: 1800, widthM: 44 }
/** Most runway lights generated for one airport. */
export const MAX_RUNWAY_LIGHTS = 8000

/** A runway as a local frame from its low end: `s` metres along it, `t` metres to the right. */
export type RunwayFrame = {
  le: RunwayEndGeometry
  he: RunwayEndGeometry
  lengthM: number
  widthM: number
  /** Threshold displacement at each end, metres. */
  dispLe: number
  dispHe: number
  at: (s: number, t: number) => LngLat
}

/**
 * Runways from the diagram's end records, which come in pairs (low end, high
 * end). Each end's pavement corner is where the other end's runway length,
 * measured from its threshold, runs out.
 */
export function runwayFrames(airport: string): RunwayFrame[] {
  const ends = runwayEnds(airport)
  const out: RunwayFrame[] = []
  for (let i = 0; i + 1 < ends.length; i += 2) {
    const le = ends[i]
    const he = ends[i + 1]
    const b = (le.bearing * Math.PI) / 180
    const ux = Math.sin(b)
    const uy = Math.cos(b)
    const along = (from: LngLat, dist: number, dx: number, dy: number) => offset(from, dx * dist, dy * dist)
    // Low pavement end: from the high threshold, the high end's runway length further on.
    const start = along(he.threshold, he.lengthM, -ux, -uy)
    const [e, n] = toLocal(start, along(le.threshold, le.lengthM, ux, uy))
    const lengthM = Math.hypot(e, n)
    out.push({
      le,
      he,
      lengthM,
      widthM: le.widthM,
      dispLe: Math.max(0, lengthM - le.lengthM),
      dispHe: Math.max(0, lengthM - he.lengthM),
      at: (s, t) => offset(start, ux * s + uy * t, uy * s - ux * t),
    })
  }
  return out
}

/** Is a point on this runway's pavement, give or take `margin` metres? */
function onRunway(r: RunwayFrame, p: LngLat, margin: number): boolean {
  const o = r.at(0, 0)
  const [x, y] = toLocal(o, p)
  const [ex, ey] = toLocal(o, r.at(1, 0))
  const s = x * ex + y * ey
  const t = x * ey - y * ex
  return s > -margin && s < r.lengthM + margin && Math.abs(t) < r.widthM / 2 + margin
}

/** Evenly spaced positions from 0 to `length` inclusive, about `spacing` apart. */
function stations(length: number, spacing: number): number[] {
  const n = Math.max(1, Math.round(length / spacing))
  return Array.from({ length: n + 1 }, (_, i) => (i * length) / n)
}

/** Every runway light at an airport. */
export function runwayLights(airport: string): LightFeature[] {
  const frames = runwayFrames(airport)
  const faa = markingSpec(icaoCode(airport)).name === 'faa'
  const out: LightFeature[] = []
  frames.forEach((r, idx) => {
    const half = r.widthM / 2
    const L = r.lengthM
    const others = frames.filter((_, j) => j !== idx)
    // Where runways cross, lights in the other runway's pavement are inset fixtures; leave them out.
    const crossing = (p: LngLat, margin = 3) => others.some((o) => onRunway(o, p, margin))
    // Where centrelines cross, the longer runway keeps its lights.
    const longer = others.filter((o) => o.lengthM > L)

    // Edge lights: yellow over the last 600 m (or half the runway) as seen from either end.
    const caution = Math.min(CAUTION_M, L / 2)
    for (const s of stations(L, EDGE_SPACING_M)) {
      const color = s < caution || s > L - caution ? LIGHT.yellow : LIGHT.white
      for (const side of [-1, 1]) {
        const p = r.at(s, side * (half + 1.5))
        if (!crossing(p)) out.push(light(p, color))
      }
    }

    // Threshold (green) and runway-end (red) rows, 3 m apart across the runway.
    // At an undisplaced end both rows share the pavement end, green facing out and red facing in.
    for (const [disp, toS] of [
      [r.dispLe, (d: number) => d],
      [r.dispHe, (d: number) => L - d],
    ] as [number, (d: number) => number][]) {
      for (const t of stations(r.widthM + 3, 3).map((v) => v - half - 1.5)) {
        out.push(light(r.at(toS(disp - 1.2), t), LIGHT.green))
        out.push(light(r.at(toS(1.2), t), LIGHT.red))
      }
    }

    // Centreline: white, then red/white alternating over the last 900 m, red over the last 300 m.
    if (L >= CENTRELINE_MIN.lengthM && r.widthM >= CENTRELINE_MIN.widthM) {
      stations(L, CENTRE_SPACING_M).forEach((s, i) => {
        if (s < 15 || s > L - 15) return
        const p = r.at(s, 0)
        if (longer.some((o) => onRunway(o, p, 1))) return
        const d = Math.min(s, L - s)
        const color = d < 300 ? LIGHT.red : d < 900 ? (i % 2 ? LIGHT.red : LIGHT.white) : LIGHT.white
        out.push(light(p, color, 0.8))
      })
    }

    // Approach lights beyond each threshold.
    if (L >= ILS_MIN.lengthM && r.widthM >= ILS_MIN.widthM) {
      for (const [disp, dir] of [
        [r.dispLe, -1],
        [r.dispHe, 1],
      ] as [number, number][]) {
        const thr = dir < 0 ? disp : L - disp
        // FAA ALSF/MALSR run 2,400 ft with one crossbar at 1,000 ft; ICAO's Calvert system runs
        // 900 m with a crossbar every 150 m, each wider than the last.
        const reach = faa ? 720 : 900
        const crossbars: [number, number][] = faa ? [[300, 15]] : [150, 300, 450, 600, 750].map((d, i) => [d, 6 + i * 3])
        for (let d = 30; d <= reach + 1e-6; d += 30) {
          const s = thr + dir * d
          for (const t of [-3, -1.5, 0, 1.5, 3]) out.push(light(r.at(s, t), LIGHT.approach, 1.15))
          const bar = crossbars.find(([at]) => Math.abs(at - d) < 1)
          if (bar) for (let t = 4.5; t <= bar[1] + 1e-6; t += 1.5) for (const side of [-1, 1]) out.push(light(r.at(s, side * t), LIGHT.approach, 1.15))
        }
      }
    }
  })
  return out.slice(0, MAX_RUNWAY_LIGHTS)
}

// ---------------------------------------------------------------------------
// Taxiways and aprons, from the map tiles
// ---------------------------------------------------------------------------

/** Taxiway centreline (green) and edge (blue) light spacing, metres. */
export const TAXI_CENTRE_SPACING_M = 30
export const TAXI_EDGE_SPACING_M = 60
/** Edge lights sit this far either side of the centreline: the edge of the 38 m pavement the map draws. */
export const TAXI_EDGE_OFFSET_M = 19

/**
 * Remembers where lights already are, so lights worked out again from a
 * different set of tiles (or the overlap at a tile edge) aren't doubled:
 * a new light is dropped if one of its kind is already within `radius` metres.
 */
export class LightSet<F extends Feature<Point>> {
  readonly features: F[] = []
  private cells = new Map<string, [number, number][]>()
  private readonly origin: LngLat
  private readonly cap: number
  constructor(origin: LngLat, cap: number) {
    this.origin = origin
    this.cap = cap
  }

  get full() {
    return this.features.length >= this.cap
  }

  /** Add `f` unless a light of the same `kind` is within `radius` metres. Returns whether it was added. */
  add(f: F, kind: string, radius: number): boolean {
    if (this.full) return false
    const [x, y] = toLocal(this.origin, f.geometry.coordinates as LngLat)
    const cx = Math.floor(x / radius)
    const cy = Math.floor(y / radius)
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const pts = this.cells.get(`${kind}:${cx + i}:${cy + j}`)
        if (pts?.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 < radius * radius)) return false
      }
    }
    const key = `${kind}:${cx}:${cy}`
    const list = this.cells.get(key)
    if (list) list.push([x, y])
    else this.cells.set(key, [[x, y]])
    this.features.push(f)
    return true
  }
}

type Seg = { path: number; ax: number; ay: number; bx: number; by: number }

function distToSeg(x: number, y: number, s: Seg): number {
  const dx = s.bx - s.ax
  const dy = s.by - s.ay
  const len2 = dx * dx + dy * dy
  const u = len2 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / len2)) : 0
  return Math.hypot(x - (s.ax + u * dx), y - (s.ay + u * dy))
}

/** Ray-casting point-in-polygon on local metre rings (outer ring first, holes after). */
function inPolygon(x: number, y: number, rings: [number, number][][]): boolean {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}

/** Apron polygons in local metres with their bounding boxes, for quick inside tests. */
function localPolygons(origin: LngLat, polygons: LngLat[][][]) {
  return polygons.map((rings) => {
    const local = rings.map((ring) => ring.map((p) => toLocal(origin, p)))
    const xs = local[0].map((p) => p[0])
    const ys = local[0].map((p) => p[1])
    return { rings: local, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
  })
}

type LocalPolygon = ReturnType<typeof localPolygons>[number]
const insideAny = (x: number, y: number, polys: LocalPolygon[]) => polys.some((p) => x >= p.minX && x <= p.maxX && y >= p.minY && y <= p.maxY && inPolygon(x, y, p.rings))

/**
 * Taxiway lights along tile taxiway paths, added to `set`: green centreline
 * lights every 30 m and blue edge lights every 60 m either side. Edge lights
 * are left out where they would stand on another taxiway, on a runway or on
 * an apron (taxilanes there are unlit at the edges); no taxiway light is put
 * on a runway.
 */
export function addTaxiwayLights(set: LightSet<LightFeature>, origin: LngLat, paths: LngLat[][], runways: RunwayFrame[], aprons: LngLat[][][]) {
  const local = paths.map((path) => path.map((p) => toLocal(origin, p)))
  // Every taxiway segment in a coarse grid, to find the ones near a point quickly.
  const CELL = 50
  const grid = new Map<string, Seg[]>()
  local.forEach((path, pi) => {
    for (let i = 1; i < path.length; i++) {
      const s: Seg = { path: pi, ax: path[i - 1][0], ay: path[i - 1][1], bx: path[i][0], by: path[i][1] }
      const pad = TAXI_EDGE_OFFSET_M
      for (let gx = Math.floor((Math.min(s.ax, s.bx) - pad) / CELL); gx <= Math.floor((Math.max(s.ax, s.bx) + pad) / CELL); gx++) {
        for (let gy = Math.floor((Math.min(s.ay, s.by) - pad) / CELL); gy <= Math.floor((Math.max(s.ay, s.by) + pad) / CELL); gy++) {
          const key = `${gx}:${gy}`
          const list = grid.get(key)
          if (list) list.push(s)
          else grid.set(key, [s])
        }
      }
    }
  })
  const nearOtherTaxiway = (x: number, y: number, pi: number) => (grid.get(`${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`) ?? []).some((s) => s.path !== pi && distToSeg(x, y, s) < TAXI_EDGE_OFFSET_M - 2)
  const polys = localPolygons(origin, aprons)
  const toWorld = (x: number, y: number) => offset(origin, x, y)
  const onAnyRunway = (p: LngLat, margin: number) => runways.some((r) => onRunway(r, p, margin))

  local.forEach((path, pi) => {
    // Walk the path, dropping a light every TAXI_CENTRE_SPACING_M.
    let next = 0
    let walked = 0
    let n = 0
    for (let i = 1; i < path.length && !set.full; i++) {
      const [ax, ay] = path[i - 1]
      const [bx, by] = path[i]
      const len = Math.hypot(bx - ax, by - ay)
      if (!len) continue
      const dx = (bx - ax) / len
      const dy = (by - ay) / len
      while (next <= walked + len + 1e-6) {
        const u = next - walked
        const x = ax + dx * u
        const y = ay + dy * u
        const p = toWorld(x, y)
        if (!onAnyRunway(p, 4)) set.add(light(p, LIGHT.taxiGreen, 0.75), 'tc', TAXI_CENTRE_SPACING_M / 2)
        if (n % (TAXI_EDGE_SPACING_M / TAXI_CENTRE_SPACING_M) === 0) {
          for (const side of [-1, 1]) {
            const ex = x + dy * side * TAXI_EDGE_OFFSET_M
            const ey = y - dx * side * TAXI_EDGE_OFFSET_M
            if (nearOtherTaxiway(ex, ey, pi) || insideAny(ex, ey, polys)) continue
            const q = toWorld(ex, ey)
            if (onAnyRunway(q, 8)) continue
            set.add(light(q, LIGHT.taxiBlue, 0.8), 'te', TAXI_EDGE_SPACING_M / 2.5)
          }
        }
        n++
        next += TAXI_CENTRE_SPACING_M
      }
      walked += len
    }
  })
}

/** Real-world radius of one apron floodlight pool, and the least distance between two. */
export const GLOW_RADIUS_M = 70
export const GLOW_SPACING_M = 45

/**
 * Warm floodlight pools, one by each gate: gates line the terminal fronts,
 * which is where the masts stand. Neighbouring pools overlap into one warm
 * band along the terminal. (The rest of each apron gets a faint flat wash
 * from the style, which needs no points.)
 */
export function addApronGlows(set: LightSet<GlowFeature>, origin: LngLat, gates: LngLat[]) {
  const r = GLOW_RADIUS_M / metersPerPixel(origin[1], 0)
  for (const g of gates) set.add({ type: 'Feature', properties: { r }, geometry: { type: 'Point', coordinates: g } }, 'g', GLOW_SPACING_M)
}
