import { describe, expect, it } from 'vitest'
import { offset, type LngLat } from '../../map/geo'
import { buildGraph, type TaxiLine, type XY } from './graph'
import { parseTaxi } from './parse'
import { planRoute, progressAlong, resolveVia, type RunwayXY } from './route'

const O: LngLat = [-73.78, 40.64]
/** Local metres → lng/lat, so the test network goes through the same projection as real tiles. */
const ll = (x: number, y: number) => offset(O, x, y)
const line = (ref: string | null, ...pts: [number, number][]): TaxiLine => ({ ref, coords: pts.map(([x, y]) => ll(x, y)) })

/*
 * Runway 9/27 along y = 0 from x = 0 to 3000. Runway 36 crosses it at x = 1000.
 *
 *   A1 ┐            A2 ┐                 A3 ┐
 *  ───A──────────────────────────────────────  y = -200
 *         │ (unnamed)                 B2 │
 *  ───────B──────────────────────────────────  y = -400
 */
const lines: TaxiLine[] = [
  // Taxiway A arrives in two tile pieces that overlap a little, as tiles do.
  line('A', [-100, -200], [1600, -200]),
  line('A', [1500, -200], [3100, -200]),
  line('A1', [0, -200], [0, 0]),
  line('A2', [1500, -200], [1500, 0]),
  line('A3', [3000, -200], [3000, 0]),
  line('B', [0, -400], [3000, -400]),
  line(null, [500, -400], [500, -200]),
  line('B2', [2500, -400], [2500, -200]),
  // A connector that stops a metre short of B: still joined.
  line('B9', [2000, -401.5], [2000, -600]),
]
const runways: RunwayXY[] = [
  { ident: '9', threshold: { x: 0, y: 0 }, bearing: 90, lengthM: 3000, widthM: 45, holdM: 85 },
  { ident: '27', threshold: { x: 3000, y: 0 }, bearing: 270, lengthM: 3000, widthM: 45, holdM: 85 },
  { ident: '36', threshold: { x: 1000, y: -1000 }, bearing: 0, lengthM: 2000, widthM: 45, holdM: 85 },
]
const g = buildGraph(lines, O)

const near = (p: XY, x: number, y: number, tol = 3) => Math.hypot(p.x - x, p.y - y) < tol

describe('buildGraph', () => {
  it('joins tile pieces, crossings and near-misses into one network', () => {
    expect(g.refs).toEqual(new Set(['A', 'A1', 'A2', 'A3', 'B', 'B2', 'B9']))
    // Every node is reachable from every other.
    const seen = new Set([0])
    const stack = [0]
    while (stack.length) {
      const n = stack.pop()!
      for (const ei of g.adj[n]) {
        const e = g.edges[ei]
        const v = e.a === n ? e.b : e.a
        if (!seen.has(v)) {
          seen.add(v)
          stack.push(v)
        }
      }
    }
    expect(seen.size).toBe(g.nodes.length)
    // The overlapping pieces of A don't leave a duplicate edge behind.
    const aLen = g.edges.filter((e) => e.ref === 'A').reduce((s, e) => s + e.len, 0)
    expect(aLen).toBeGreaterThan(3195)
    expect(aLen).toBeLessThan(3205)
  })

  it('splits lines that cross without a shared vertex', () => {
    const x = buildGraph([line('P', [0, 0], [100, 0]), line('Q', [50, -50], [50, 50])], O)
    expect(x.nodes.some((p) => near(p, 50, 0, 0.5))).toBe(true)
    expect(x.edges).toHaveLength(4)
  })
})

describe('planRoute', () => {
  it('follows the named taxiways in order to the runway and stops at the holding point', () => {
    const c = parseTaxi('taxi to runway 9 via Bravo, Alpha')!
    const plan = planRoute(g, { clearance: c, start: { x: 2600, y: -420 }, heading: 270, moving: true, runways })!
    expect(plan.exact).toBe(true)
    expect(plan.runway).toBe('9')
    const pts = plan.points
    // West along B, up the unnamed link at x = 500, west along A, north on A1.
    expect(pts.some((p) => near(p, 500, -400))).toBe(true)
    expect(pts.some((p) => near(p, 500, -200))).toBe(true)
    expect(pts.some((p) => near(p, 0, -200))).toBe(true)
    // Ends at the hold line, 85 m south of the centreline.
    expect(near(pts[pts.length - 1], 0, -85, 1)).toBe(true)
    expect(plan.holds.map((h) => h.label)).toEqual(['Runway 9'])
  })

  it('marks a hold-short on the way and carries on to the runway', () => {
    const c = parseTaxi('runway 9, taxi via Bravo, Alpha, hold short of runway 36')!
    const plan = planRoute(g, { clearance: c, start: { x: 2600, y: -420 }, heading: 270, moving: true, runways })!
    expect(plan.holds.map((h) => h.label)).toEqual(['Hold short 36', 'Runway 9'])
    expect(near(plan.holds[0].at, 1085, -400, 1)).toBe(true)
  })

  it('stops short of a hold-short taxiway', () => {
    const c = parseTaxi('taxi via Bravo, hold short of Bravo 2')!
    const plan = planRoute(g, { clearance: c, start: { x: 400, y: -420 }, heading: 90, moving: true, runways })!
    const end = plan.points[plan.points.length - 1]
    expect(end.x).toBeGreaterThan(2450)
    expect(end.x).toBeLessThan(2500)
    expect(plan.holds[0].label).toBe('Hold short B2')
  })

  it('does not turn a rolling aircraft round without reason', () => {
    const c = parseTaxi('continue on Bravo')!
    const plan = planRoute(g, { clearance: c, start: { x: 1200, y: -400 }, heading: 90, moving: true, runways })!
    // Ends at the east end of B, the way it is already going.
    expect(near(plan.points[plan.points.length - 1], 3000, -400)).toBe(true)
  })

  it('falls back to a looser route when the order cannot be followed', () => {
    // B then A2 then B again can't be done in that order without doubling back over A.
    const c = parseTaxi('taxi to runway 27 via Alpha, Bravo 9')!
    const plan = planRoute(g, { clearance: c, start: { x: 100, y: -200 }, heading: 90, moving: true, runways })
    expect(plan).not.toBeNull()
    expect(plan!.runway).toBe('27')
  })

  it('sets aside taxiways the map does not have', () => {
    const c = parseTaxi('taxi to runway 9 via Bravo, Zulu, Alpha')!
    const plan = planRoute(g, { clearance: c, start: { x: 2600, y: -420 }, runways })!
    expect(plan.missing).toEqual(['Z'])
    expect(plan.used).toEqual(['B', 'A'])
  })

  it('returns null far from any taxiway', () => {
    const c = parseTaxi('taxi to runway 9 via Bravo')!
    expect(planRoute(g, { clearance: c, start: { x: 9000, y: 9000 }, runways })).toBeNull()
  })
})

describe('resolveVia', () => {
  it('merges letters said back to back into a double-letter taxiway the airport has', () => {
    const refs = new Set(['K', 'A', 'KA', 'B'])
    expect(resolveVia(parseTaxi('taxi via Kilo Alpha, Bravo')!, refs).used).toEqual(['KA', 'B'])
    expect(resolveVia(parseTaxi('taxi via Kilo, Alpha, Bravo')!, refs).used).toEqual(['K', 'A', 'B'])
  })

  it('reads "follow the Delta" as taxiway D when nothing else is given', () => {
    expect(resolveVia(parseTaxi('follow the Delta')!, new Set(['D'])).used).toEqual(['D'])
  })
})

describe('progressAlong', () => {
  it('trims the route behind the aircraft', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]
    const p = progressAlong(pts, { x: 100, y: 30 })
    expect(p.leg).toBe(2)
    expect(near(p.ahead[0], 100, 30, 0.01)).toBe(true)
    expect(p.remainingM).toBeCloseTo(70, 3)
  })
})
