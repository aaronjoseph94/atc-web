/**
 * Where ground traffic can be: the airport's taxiway and runway centrelines
 * as a graph (the same one the taxi-route feature builds, plus runways and,
 * for vehicles, service roads), the aprons as areas, and the runways as
 * strips.
 *
 * The motion model uses it to keep taxiing aircraft on the pavement: each
 * report is snapped to the nearest centreline that runs the way the aircraft
 * is pointing, and consecutive reports are joined along the graph, so a turn
 * follows the taxiway instead of cutting across the grass. On aprons, where
 * everything is pavement and aircraft leave the lines to reach their stands,
 * snapping is light and movement is otherwise free.
 */
import { buildGraph, project, type LineKind, type TaxiGraph, type TaxiLine } from '../../live/taxi/graph'
import type { LngLatPolygon } from '../../live/taxi/mvt'
import type { LngLat } from '../geo'
import { angleDelta, dirOf, headingOf, type Frame, type XY } from './plane'

/** A runway as published: its centreline from end to end, and its width. */
export type RunwayStrip = { a: LngLat; b: LngLat; widthM: number }

/** Everything about an airport's pavement, in longitude/latitude (so it can be built into any local frame). */
export type PavementData = {
  taxiways: TaxiLine[]
  /** Runway centrelines as mapped (they meet the taxiways exactly). */
  runways: TaxiLine[]
  aprons: LngLatPolygon[]
  /** Runways as published, for locking the takeoff and landing roll to the centreline. */
  strips: RunwayStrip[]
  /** Airside service roads, fetched only once a vehicle shows up. */
  roads?: () => Promise<TaxiLine[]>
}

/** A point on the graph. */
export type Snap = {
  edge: number
  /** 0 at the edge's `a` node, 1 at `b`. */
  t: number
  x: number
  y: number
  /** Distance from the point that was snapped, metres. */
  d: number
  /** Unit direction of the edge, `a` to `b`. */
  ux: number
  uy: number
  kind: LineKind | 'taxiway'
}

type Ring = { pts: XY[]; minX: number; minY: number; maxX: number; maxY: number }
type Strip = { ax: number; ay: number; ux: number; uy: number; len: number; half: number; heading: number }

const CELL_M = 80
/** A route may turn back on itself only at this cost, metres: aircraft don't make hairpin turns on a taxiway. */
const HAIRPIN_M = 220
/** Setting off against the way the aircraft points costs this much: possible (a pushback), but never the first choice. */
const REVERSE_START_M = 160

export class Pavement {
  readonly graph: TaxiGraph
  private readonly grid = new Map<number, number[]>()
  private readonly aprons: Ring[][]
  private readonly strips: Strip[]
  /** Unit direction of each edge. */
  private readonly eux: Float64Array
  private readonly euy: Float64Array

  constructor(data: PavementData, frame: Frame, roads: TaxiLine[] = []) {
    const lines: TaxiLine[] = [...data.taxiways, ...data.runways, ...roads]
    this.strips = data.strips.map((s) => {
      const a = frame.toXY(s.a[0], s.a[1])
      const b = frame.toXY(s.b[0], s.b[1])
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const ux = (b.x - a.x) / len
      const uy = (b.y - a.y) / len
      return { ax: a.x, ay: a.y, ux, uy, len, half: s.widthM / 2, heading: headingOf(ux, uy) }
    })
    this.graph = buildGraph(lines, frame.origin)
    // A published runway the map has no centreline for still gets one, so the graph reaches it.
    const missing = data.strips.filter((_, i) => !this.hasRunwayEdgeNear(this.strips[i]))
    if (missing.length) this.graph = buildGraph([...lines, ...missing.map((s) => ({ ref: null, kind: 'runway' as const, coords: [s.a, s.b] }))], frame.origin)
    const g = this.graph
    this.eux = new Float64Array(g.edges.length)
    this.euy = new Float64Array(g.edges.length)
    g.edges.forEach((e, i) => {
      const a = g.nodes[e.a]
      const b = g.nodes[e.b]
      this.eux[i] = (b.x - a.x) / (e.len || 1)
      this.euy[i] = (b.y - a.y) / (e.len || 1)
    })
    this.index()
    this.aprons = data.aprons.map((poly) =>
      poly.map((ring) => {
        const pts = ring.map(([lon, lat]) => frame.toXY(lon, lat))
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const p of pts) {
          if (p.x < minX) minX = p.x
          if (p.x > maxX) maxX = p.x
          if (p.y < minY) minY = p.y
          if (p.y > maxY) maxY = p.y
        }
        return { pts, minX, minY, maxX, maxY }
      }),
    )
  }

  private key(cx: number, cy: number): number {
    return (cx + 32768) * 65536 + (cy + 32768)
  }

  private index() {
    this.grid.clear()
    const g = this.graph
    g.edges.forEach((e, i) => {
      const a = g.nodes[e.a]
      const b = g.nodes[e.b]
      const steps = Math.max(1, Math.ceil(e.len / (CELL_M / 2)))
      let last = NaN
      for (let k = 0; k <= steps; k++) {
        const u = k / steps
        const key = this.key(Math.floor((a.x + (b.x - a.x) * u) / CELL_M), Math.floor((a.y + (b.y - a.y) * u) / CELL_M))
        if (key === last) continue
        last = key
        const list = this.grid.get(key)
        if (!list) this.grid.set(key, [i])
        else if (list[list.length - 1] !== i) list.push(i)
      }
    })
  }

  private hasRunwayEdgeNear(s: Strip): boolean {
    const mid = { x: s.ax + s.ux * s.len * 0.5, y: s.ay + s.uy * s.len * 0.5 }
    const g = this.graph
    for (const e of g.edges) {
      if (e.kind !== 'runway') continue
      if (project(g.nodes[e.a], g.nodes[e.b], mid).d < 40) return true
    }
    return false
  }

  /** Is the point on an apron (where aircraft may leave the painted lines)? */
  inApron(p: XY): boolean {
    for (const poly of this.aprons) {
      let inside = false
      for (const r of poly) {
        if (p.x < r.minX || p.x > r.maxX || p.y < r.minY || p.y > r.maxY) continue
        const pts = r.pts
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const a = pts[i]
          const b = pts[j]
          if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
        }
      }
      if (inside) return true
    }
    return false
  }

  /**
   * The nearest centreline within `tolM` of `p`. With a `heading`, lines
   * running across it (more than `maxAngle` degrees off, either way along)
   * don't count and lines running with it win ties; `prefer` is the edge
   * the aircraft was last on, which wins near-ties too (no hopping between
   * parallel lines). `kind` restricts the search to one kind of line.
   */
  snap(p: XY, heading: number | null, tolM: number, prefer = -1, maxAngle = 55, kind: Snap['kind'] | null = null): Snap | null {
    const g = this.graph
    const cx = Math.floor(p.x / CELL_M)
    const cy = Math.floor(p.y / CELL_M)
    const reach = Math.max(1, Math.ceil((tolM + CELL_M / 4) / CELL_M))
    let best: Snap | null = null
    let bestScore = Infinity
    const pa = prefer >= 0 ? g.edges[prefer] : null
    const seen = new Set<number>()
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        const list = this.grid.get(this.key(cx + dx, cy + dy))
        if (!list) continue
        for (const i of list) {
          if (seen.has(i)) continue
          seen.add(i)
          const e = g.edges[i]
          const k = e.kind ?? 'taxiway'
          if (kind && k !== kind) continue
          const pr = project(g.nodes[e.a], g.nodes[e.b], p)
          if (pr.d > tolM) continue
          let score = pr.d
          if (heading != null) {
            let off = Math.abs(angleDelta(heading, headingOf(this.eux[i], this.euy[i])))
            if (off > 90) off = 180 - off
            if (off > maxAngle) continue
            score += (off / 90) * tolM * 0.9
          }
          if (pa) {
            if (i === prefer) score -= 5
            else if (e.a === pa.a || e.a === pa.b || e.b === pa.a || e.b === pa.b) score -= 2.5
          }
          if (score < bestScore) {
            bestScore = score
            best = { edge: i, t: pr.t, x: pr.x, y: pr.y, d: pr.d, ux: this.eux[i], uy: this.euy[i], kind: k }
          }
        }
      }
    }
    return best
  }

  /**
   * An aircraft at `p` pointing along `heading` on a runway: the point on
   * that runway's centreline abeam it, and the runway's direction the way the
   * aircraft is going. Null when it isn't on a runway or isn't lined up.
   */
  runwayLock(p: XY, heading: number): { x: number; y: number; ux: number; uy: number; snap: Snap | null } | null {
    for (const s of this.strips) {
      let off = Math.abs(angleDelta(heading, s.heading))
      const flip = off > 90
      if (flip) off = 180 - off
      if (off > 18) continue
      const along = (p.x - s.ax) * s.ux + (p.y - s.ay) * s.uy
      const cross = (p.x - s.ax) * s.uy - (p.y - s.ay) * s.ux
      if (along < -90 || along > s.len + 90 || Math.abs(cross) > s.half + 14) continue
      const sign = flip ? -1 : 1
      // The mapped centreline, when there is one, is the line the taxiways join; the published one is its stand-in.
      const snap = this.snap(p, heading, s.half + 18, -1, 20, 'runway')
      if (snap) return { x: snap.x, y: snap.y, ux: s.ux * sign, uy: s.uy * sign, snap }
      return { x: s.ax + s.ux * along, y: s.ay + s.uy * along, ux: s.ux * sign, uy: s.uy * sign, snap: null }
    }
    return null
  }

  /**
   * The way along the centrelines from `a` to `b`, as points (both ends
   * included), or null when there is none shorter than `maxLen` metres.
   * `heading` is the way the aircraft points at `a`.
   */
  route(a: Snap, b: Snap, maxLen: number, heading: number | null): { pts: XY[]; len: number } | null {
    const g = this.graph
    const ea = g.edges[a.edge]
    const eb = g.edges[b.edge]
    const hx = heading == null ? 0 : dirOf(heading).x
    const hy = heading == null ? 0 : dirOf(heading).y
    // Leaving `a` toward its edge's `b` node goes along (ux, uy); toward `a`, against it.
    const against = (sign: number) => (heading != null && (a.ux * hx + a.uy * hy) * sign < -0.35 ? REVERSE_START_M : 0)

    let best: { pts: XY[]; cost: number; len: number } | null = null
    if (a.edge === b.edge) {
      const len = Math.abs(b.t - a.t) * ea.len
      const cost = len + (len > 0.5 ? against(b.t > a.t ? 1 : -1) : 0)
      best = { pts: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }], cost, len }
    }

    // Dijkstra over nodes, remembering the edge each was reached by so hairpins can be priced.
    const cost = new Map<number, number>()
    const dist = new Map<number, number>()
    const via = new Map<number, { from: number; edge: number }>()
    const open: number[] = []
    const reach = (n: number, c: number, d: number, from: number, edge: number) => {
      const had = cost.get(n)
      if (had != null && had <= c) return
      cost.set(n, c)
      dist.set(n, d)
      via.set(n, { from, edge })
      open.push(n)
    }
    reach(ea.a, a.t * ea.len + against(-1), a.t * ea.len, -1, a.edge)
    reach(ea.b, (1 - a.t) * ea.len + against(1), (1 - a.t) * ea.len, -1, a.edge)
    const done = new Set<number>()
    const limit = best ? Math.min(maxLen, best.cost) : maxLen
    let endNode = -1
    let endCost = limit
    while (open.length) {
      let bi = 0
      for (let i = 1; i < open.length; i++) if (cost.get(open[i])! < cost.get(open[bi])!) bi = i
      const n = open[bi]
      open[bi] = open[open.length - 1]
      open.pop()
      if (done.has(n)) continue
      done.add(n)
      const c = cost.get(n)!
      if (c > endCost) break
      const d = dist.get(n)!
      const came = via.get(n)!
      // Arriving here, can we finish along b's edge?
      if (n === eb.a || n === eb.b) {
        const tail = (n === eb.a ? b.t : 1 - b.t) * eb.len
        const turn = this.hairpin(came.edge, n, b.edge) ? HAIRPIN_M : 0
        if (c + tail + turn < endCost) {
          endCost = c + tail + turn
          endNode = n
        }
      }
      for (const ei of g.adj[n]) {
        const e = g.edges[ei]
        const m = e.a === n ? e.b : e.a
        if (done.has(m)) continue
        const turn = this.hairpin(came.edge, n, ei) ? HAIRPIN_M : 0
        if (c + e.len + turn > limit) continue
        reach(m, c + e.len + turn, d + e.len, n, ei)
      }
    }
    if (endNode >= 0 && (!best || endCost < best.cost)) {
      const nodes: number[] = []
      for (let n = endNode; n >= 0; n = via.get(n)!.from) nodes.push(n)
      nodes.reverse()
      const pts: XY[] = [{ x: a.x, y: a.y }]
      for (const n of nodes) pts.push({ x: g.nodes[n].x, y: g.nodes[n].y })
      pts.push({ x: b.x, y: b.y })
      const len = dist.get(endNode)! + (endNode === eb.a ? b.t : 1 - b.t) * eb.len
      best = { pts, cost: endCost, len }
    }
    if (!best || best.cost > maxLen) return null
    return { pts: best.pts, len: best.len }
  }

  /** Would going from `edgeIn` through `node` onto `edgeOut` be a turn back on itself? */
  private hairpin(edgeIn: number, node: number, edgeOut: number): boolean {
    if (edgeIn === edgeOut) return true
    const g = this.graph
    const ein = g.edges[edgeIn]
    const eout = g.edges[edgeOut]
    // Direction of travel into the node, and out of it.
    const si = ein.b === node ? 1 : -1
    const so = eout.a === node ? 1 : -1
    return this.eux[edgeIn] * si * this.eux[edgeOut] * so + this.euy[edgeIn] * si * this.euy[edgeOut] * so < -0.5
  }

  /**
   * The centreline behind an aircraft at `a` pointing along `heading`, for
   * `distM` metres, taking the straightest way at each junction: where it has
   * most likely just come from. Points run from the far end up to `a`.
   */
  walkBack(a: Snap, heading: number, distM: number): XY[] {
    const g = this.graph
    const h = dirOf(heading)
    // Forward is whichever way along the edge agrees with the heading; back is the other.
    const forward = a.ux * h.x + a.uy * h.y >= 0 ? 1 : -1
    let edge = a.edge
    let node = forward > 0 ? g.edges[edge].a : g.edges[edge].b
    let left = distM
    const pts: XY[] = [{ x: a.x, y: a.y }]
    let px = a.x
    let py = a.y
    for (let hop = 0; hop < 64 && left > 0; hop++) {
      const n = g.nodes[node]
      const seg = Math.hypot(n.x - px, n.y - py)
      if (seg >= left) {
        pts.push({ x: px + ((n.x - px) / seg) * left, y: py + ((n.y - py) / seg) * left })
        break
      }
      if (seg > 0.05) pts.push({ x: n.x, y: n.y })
      left -= seg
      // Direction we are walking (backwards along the route).
      const e = g.edges[edge]
      const s = e.b === node ? 1 : -1
      const wx = this.eux[edge] * s
      const wy = this.euy[edge] * s
      let next = -1
      let bestDot = 0.64 // no more than ~50° off straight
      for (const ei of g.adj[node]) {
        if (ei === edge) continue
        const o = g.edges[ei]
        const so = o.a === node ? 1 : -1
        const dot = wx * this.eux[ei] * so + wy * this.euy[ei] * so
        if (dot > bestDot) {
          bestDot = dot
          next = ei
        }
      }
      if (next < 0) break
      px = n.x
      py = n.y
      edge = next
      node = g.edges[next].a === node ? g.edges[next].b : g.edges[next].a
    }
    return pts.reverse()
  }
}
