/**
 * The taxiway network as a graph, built from OpenStreetMap taxiway lines.
 *
 * Lines come out of vector tiles in pieces: cut at tile edges, sharing some
 * vertices with their neighbours and merely touching others. So vertices
 * within a couple of metres are merged into one node, lines that cross or
 * end on another line are split there, and duplicate edges are dropped.
 * Every edge keeps the taxiway name (`ref`) it came from, which is what the
 * router steers by.
 *
 * Coordinates are local metres (x east, y north) around an origin, so the
 * geometry is plain 2D maths; `toLngLat` converts back for drawing.
 */
import { offset, toLocal, type LngLat } from '../../map/geo'

export type TaxiLine = { ref: string | null; coords: LngLat[] }

export type XY = { x: number; y: number }

export type TaxiEdge = { a: number; b: number; ref: string | null; len: number }

export type TaxiGraph = {
  origin: LngLat
  nodes: XY[]
  edges: TaxiEdge[]
  /** Edge indices touching each node. */
  adj: number[][]
  /** Every taxiway name in the network. */
  refs: Set<string>
}

/** Vertices closer than this are one node. */
const SNAP_M = 2.5
/** A line ending this close to another line joins it there. */
const T_JOIN_M = 6
const CELL_M = 40

/** `K A`, `k-a` → `KA`; OpenStreetMap refs are written many ways. */
export function cleanRef(ref: unknown): string | null {
  if (typeof ref !== 'string') return null
  const r = ref.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return r && r.length <= 4 ? r : null
}

type Seg = { p: XY; q: XY; ref: string | null; cuts: number[] }

/** Closest point on segment pq to c, as a parameter 0..1 and the distance. */
export function project(p: XY, q: XY, c: XY): { t: number; d: number; x: number; y: number } {
  const dx = q.x - p.x
  const dy = q.y - p.y
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((c.x - p.x) * dx + (c.y - p.y) * dy) / l2)) : 0
  const x = p.x + t * dx
  const y = p.y + t * dy
  return { t, d: Math.hypot(c.x - x, c.y - y), x, y }
}

export function buildGraph(lines: TaxiLine[], origin: LngLat): TaxiGraph {
  const segs: Seg[] = []
  for (const line of lines) {
    const ref = cleanRef(line.ref)
    const pts = line.coords.map((c) => {
      const [x, y] = toLocal(origin, c)
      return { x, y }
    })
    for (let i = 1; i < pts.length; i++) {
      if (Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) < 0.05) continue
      segs.push({ p: pts[i - 1], q: pts[i], ref, cuts: [] })
    }
  }

  // Spatial index of segments by the grid cells their bounding boxes cover.
  const grid = new Map<string, number[]>()
  const cellsOf = (s: Seg, pad: number) => {
    const out: string[] = []
    const x0 = Math.floor((Math.min(s.p.x, s.q.x) - pad) / CELL_M)
    const x1 = Math.floor((Math.max(s.p.x, s.q.x) + pad) / CELL_M)
    const y0 = Math.floor((Math.min(s.p.y, s.q.y) - pad) / CELL_M)
    const y1 = Math.floor((Math.max(s.p.y, s.q.y) + pad) / CELL_M)
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(`${x},${y}`)
    return out
  }
  segs.forEach((s, i) => {
    for (const c of cellsOf(s, T_JOIN_M)) {
      const list = grid.get(c)
      if (list) list.push(i)
      else grid.set(c, [i])
    }
  })

  // Split where lines cross, and where a loose end stops on (or just short of) another line.
  const seen = new Set<string>()
  for (const list of grid.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const i = list[x]
        const j = list[y]
        const key = i < j ? `${i}:${j}` : `${j}:${i}`
        if (seen.has(key)) continue
        seen.add(key)
        const a = segs[i]
        const b = segs[j]
        const hit = crossing(a, b)
        if (hit) {
          a.cuts.push(hit[0])
          b.cuts.push(hit[1])
          continue
        }
        for (const [s, o] of [
          [a, b],
          [b, a],
        ] as const) {
          for (const end of [s.p, s.q]) {
            const pr = project(o.p, o.q, end)
            if (pr.d < T_JOIN_M && pr.t > 0.001 && pr.t < 0.999) o.cuts.push(pr.t)
          }
        }
      }
    }
  }

  // Nodes: merged vertices.
  const nodes: XY[] = []
  const nodeGrid = new Map<string, number[]>()
  const nodeAt = (p: XY): number => {
    const cx = Math.floor(p.x / SNAP_M)
    const cy = Math.floor(p.y / SNAP_M)
    let best = -1
    let bestD = SNAP_M
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const n of nodeGrid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const d = Math.hypot(nodes[n].x - p.x, nodes[n].y - p.y)
          if (d < bestD) {
            bestD = d
            best = n
          }
        }
    if (best >= 0) return best
    nodes.push({ x: p.x, y: p.y })
    const k = `${cx},${cy}`
    const list = nodeGrid.get(k)
    if (list) list.push(nodes.length - 1)
    else nodeGrid.set(k, [nodes.length - 1])
    return nodes.length - 1
  }

  const edges: TaxiEdge[] = []
  const edgeKeys = new Set<string>()
  const refs = new Set<string>()
  for (const s of segs) {
    const ts = [0, ...s.cuts.sort((x, y) => x - y), 1]
    let prev = nodeAt(s.p)
    for (let k = 1; k < ts.length; k++) {
      const t = ts[k]
      const n = nodeAt(t === 1 ? s.q : { x: s.p.x + (s.q.x - s.p.x) * t, y: s.p.y + (s.q.y - s.p.y) * t })
      if (n !== prev) {
        const key = prev < n ? `${prev}:${n}:${s.ref}` : `${n}:${prev}:${s.ref}`
        if (!edgeKeys.has(key)) {
          edgeKeys.add(key)
          edges.push({ a: prev, b: n, ref: s.ref, len: Math.hypot(nodes[n].x - nodes[prev].x, nodes[n].y - nodes[prev].y) })
          if (s.ref) refs.add(s.ref)
        }
      }
      prev = n
    }
  }
  const adj: number[][] = nodes.map(() => [])
  edges.forEach((e, i) => {
    adj[e.a].push(i)
    adj[e.b].push(i)
  })
  return { origin, nodes, edges, adj, refs }
}

/** Parameters where two segments properly cross, or null. */
function crossing(a: Seg, b: Seg): [number, number] | null {
  const rx = a.q.x - a.p.x
  const ry = a.q.y - a.p.y
  const sx = b.q.x - b.p.x
  const sy = b.q.y - b.p.y
  const den = rx * sy - ry * sx
  if (Math.abs(den) < 1e-9) return null
  const qx = b.p.x - a.p.x
  const qy = b.p.y - a.p.y
  const t = (qx * sy - qy * sx) / den
  const u = (qx * ry - qy * rx) / den
  if (t <= 0.001 || t >= 0.999 || u <= 0.001 || u >= 0.999) return null
  return [t, u]
}

export function toLngLat(g: Pick<TaxiGraph, 'origin'>, p: XY): LngLat {
  return offset(g.origin, p.x, p.y)
}

export function toXY(g: Pick<TaxiGraph, 'origin'>, p: LngLat): XY {
  const [x, y] = toLocal(g.origin, p)
  return { x, y }
}
