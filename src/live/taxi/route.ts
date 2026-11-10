/**
 * Finds the route a taxi clearance describes on the taxiway graph.
 *
 * The search runs over (node, stage) pairs: stage k means the aircraft has
 * reached the k-th taxiway of the clearance. Moving along the taxiway named
 * next advances the stage; moving along the current one keeps it; anything
 * else (an unnamed fillet, a taxiway not in the clearance) is allowed but
 * costs extra, so the cheapest route is the one that follows the names in
 * order and only cuts across where the map has a gap. A route only counts
 * once every named taxiway has been used and it reaches the goal: the
 * runway's holding point, the hold-short taxiway, or the end of the last
 * taxiway named. If the names can't be followed in order (a taxiway missing
 * from the map, a misheard letter), a looser search simply prefers the
 * named taxiways over others.
 */
import { normalizeRunway, type TaxiClearance } from './parse'
import { project, type TaxiGraph, type XY } from './graph'

export type RunwayXY = {
  ident: string
  /** Landing threshold. */
  threshold: XY
  /** Direction of travel, degrees. */
  bearing: number
  lengthM: number
  widthM: number
  /** Distance of the holding position from the centreline. */
  holdM: number
}

export type HoldMark = { at: XY; bearing: number; label: string }

export type RoutePlan = {
  points: XY[]
  holds: HoldMark[]
  /** Runway the route ends at, as painted. */
  runway: string | null
  /** Taxiways from the clearance that the map has, in order. */
  used: string[]
  /** Taxiways from the clearance the map doesn't know. */
  missing: string[]
  /** True when the route follows the named taxiways in order. */
  exact: boolean
  lengthM: number
  /** Named taxiways the route uses, in order (connectors included). */
  steps: string[]
}

export type RouteRequest = {
  clearance: TaxiClearance
  start: XY
  /** Track in degrees, when the aircraft is moving. */
  heading?: number | null
  moving?: boolean
  runways: RunwayXY[]
}

/** Farthest an aircraft may be from any taxiway line and still get a route. */
const MAX_START_M = 700
/** Cost of a U-turn at the start, when the aircraft is already rolling. */
const TURNAROUND_M = 300
/** Search no further than this (metres of cost). */
const MAX_COST = 14_000

/** Along and across the runway, metres, in the landing direction of `r`. */
export function runwayFrame(r: RunwayXY, p: XY): { along: number; cross: number } {
  const b = (r.bearing * Math.PI) / 180
  const e = p.x - r.threshold.x
  const n = p.y - r.threshold.y
  return { along: e * Math.sin(b) + n * Math.cos(b), cross: e * Math.cos(b) - n * Math.sin(b) }
}

/** Is `p` within `margin` of the runway centreline, between its ends? */
function onRunwayBand(r: RunwayXY, p: XY, margin: number): boolean {
  const { along, cross } = runwayFrame(r, p)
  return Math.abs(cross) < margin && along > -60 && along < r.lengthM + 60
}

/** The runway end a spoken designator means; without a side, the closest of its kind. */
export function findRunway(ident: string, runways: RunwayXY[], near?: XY): RunwayXY | null {
  const want = normalizeRunway(ident)
  const exact = runways.find((r) => normalizeRunway(r.ident) === want)
  if (exact) return exact
  if (/[LRC]$/.test(want)) return null
  const same = runways.filter((r) => normalizeRunway(r.ident).replace(/[LRC]$/, '') === want)
  if (!same.length) return null
  if (!near) return same[0]
  return same.reduce((a, b) => (Math.hypot(a.threshold.x - near.x, a.threshold.y - near.y) <= Math.hypot(b.threshold.x - near.x, b.threshold.y - near.y) ? a : b))
}

/**
 * The clearance's taxiways as the map names them: letters said back to back
 * become one double-letter taxiway where the airport has one ("Kilo Alpha"
 * at JFK is KA), unknown names are set aside, repeats collapse.
 */
export function resolveVia(c: TaxiClearance, refs: Set<string>): { used: string[]; missing: string[] } {
  const used: string[] = []
  const missing: string[] = []
  const pairs = new Set(c.pairs)
  for (let i = 0; i < c.via.length; i++) {
    let ref = c.via[i]
    if (pairs.has(i) && refs.has(ref + c.via[i + 1])) {
      ref += c.via[i + 1]
      i++
    }
    if (!refs.has(ref)) {
      missing.push(ref)
      continue
    }
    if (used[used.length - 1] !== ref) used.push(ref)
  }
  // "follow the Delta" with no route given: Delta may well be the taxiway.
  if (!used.length && c.follow) {
    const letter = c.follow[0]?.toUpperCase()
    if (letter && refs.has(letter) && /^[A-Z][a-z]+$/.test(c.follow)) used.push(letter)
  }
  return { used, missing }
}

type Goal = { kind: 'runway'; runway: RunwayXY } | { kind: 'taxiway'; ref: string } | { kind: 'end' }

/** Min-heap of [cost, state]. */
class Heap {
  private a: number[] = []
  private s: number[] = []
  get size() {
    return this.a.length
  }
  push(cost: number, state: number) {
    const a = this.a
    const s = this.s
    a.push(cost)
    s.push(state)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p] <= a[i]) break
      ;[a[p], a[i]] = [a[i], a[p]]
      ;[s[p], s[i]] = [s[i], s[p]]
      i = p
    }
  }
  pop(): [number, number] {
    const a = this.a
    const s = this.s
    const top: [number, number] = [a[0], s[0]]
    const lastA = a.pop()!
    const lastS = s.pop()!
    if (a.length) {
      a[0] = lastA
      s[0] = lastS
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l] < a[m]) m = l
        if (r < a.length && a[r] < a[m]) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        ;[s[m], s[i]] = [s[i], s[m]]
        i = m
      }
    }
    return top
  }
}

type Search = { cost: Float64Array; prev: Int32Array; stages: number }

/** Dijkstra over (node, stage). `loose` ignores order and just prefers the named taxiways. */
function search(g: TaxiGraph, via: string[], seeds: { node: number; cost: number; stage: number }[], loose: boolean): Search {
  const stages = loose ? 1 : via.length + 1
  const n = g.nodes.length * stages
  const cost = new Float64Array(n).fill(Infinity)
  const prev = new Int32Array(n).fill(-1)
  const heap = new Heap()
  for (const s of seeds) {
    const st = s.node * stages + (loose ? 0 : s.stage)
    if (s.cost < cost[st]) {
      cost[st] = s.cost
      heap.push(s.cost, st)
    }
  }
  const named = new Set(via)
  while (heap.size) {
    const [c, st] = heap.pop()
    if (c > cost[st] || c > MAX_COST) continue
    const u = Math.floor(st / stages)
    const s = st % stages
    for (const ei of g.adj[u]) {
      const e = g.edges[ei]
      const v = e.a === u ? e.b : e.a
      let ns = s
      let step: number
      if (loose) {
        step = e.ref && named.has(e.ref) ? e.len : e.ref ? e.len * 2.2 : e.len * 1.4
      } else if (s < via.length && e.ref === via[s]) {
        ns = s + 1
        step = e.len
      } else if (s >= 1 && e.ref === via[s - 1]) {
        step = e.len
      } else if (s + 1 < via.length && e.ref === via[s + 1]) {
        // A named taxiway skipped (too short to have its own line on the map, or misheard).
        ns = s + 2
        step = e.len + 400
      } else if (s === 0) {
        // Getting from the stand or ramp to the first named taxiway.
        step = e.len * 1.3
      } else {
        step = e.ref ? e.len * 3 + 15 : e.len * 1.5 + 5
      }
      const nst = v * stages + ns
      const nc = c + step
      if (nc < cost[nst]) {
        cost[nst] = nc
        prev[nst] = st
        heap.push(nc, nst)
      }
    }
  }
  return { cost, prev, stages }
}

/** The goal state with the lowest total cost, or -1. */
function pickGoal(g: TaxiGraph, s: Search, goal: Goal, via: string[], loose: boolean): number {
  const stage = loose ? 0 : s.stages - 1
  let best = -1
  let bestScore = Infinity
  const lastRef = via[via.length - 1]
  for (let v = 0; v < g.nodes.length; v++) {
    const st = v * s.stages + stage
    const c = s.cost[st]
    if (!Number.isFinite(c)) continue
    const p = g.nodes[v]
    let score = Infinity
    if (goal.kind === 'runway') {
      const r = goal.runway
      const { along, cross } = runwayFrame(r, p)
      // "Runway 4L" means its full length: the entry nearest the threshold, even if
      // that is a longer taxi; an entry part-way down only when nothing nearer is reachable.
      if (Math.abs(cross) < r.widthM / 2 + 20 && along > -120 && along < r.lengthM * 0.5) score = c + Math.max(0, along) * 2.5
    } else if (goal.kind === 'taxiway') {
      if (g.adj[v].some((ei) => g.edges[ei].ref === goal.ref)) score = c
    } else if (lastRef) {
      // The end of the last named taxiway (a dead end of that name), nearest first.
      const own = g.adj[v].filter((ei) => g.edges[ei].ref === lastRef).length
      if (own === 1 && c > 40) score = c
    }
    if (score < bestScore) {
      bestScore = score
      best = st
    }
  }
  if (best < 0 && goal.kind === 'end' && lastRef) {
    // A loop with no dead end (a ring road round the terminal): go a fair way along it.
    let far = -1
    let farCost = -1
    for (let v = 0; v < g.nodes.length; v++) {
      const st = v * s.stages + stage
      const c = s.cost[st]
      if (Number.isFinite(c) && c > farCost && c < 1500 && g.adj[v].some((ei) => g.edges[ei].ref === lastRef)) {
        farCost = c
        far = st
      }
    }
    return far
  }
  return best
}

/** Plan the route for a clearance, from where the aircraft is now. Null when it can't be placed on the map. */
export function planRoute(g: TaxiGraph, req: RouteRequest): RoutePlan | null {
  if (!g.edges.length) return null
  const { clearance: c, start } = req
  const { used, missing } = resolveVia(c, g.refs)

  // Where the route ends.
  const holdTaxiway = c.holdShort.find((h) => h.kind === 'taxiway' && g.refs.has(h.ref) && !used.includes(h.ref))
  const holdRunways = c.holdShort.filter((h) => h.kind === 'runway').map((h) => findRunway(h.ref, req.runways, start)).filter((r): r is RunwayXY => !!r)
  const target = c.runway ? findRunway(c.runway, req.runways, start) : null
  let goal: Goal
  if (holdTaxiway) goal = { kind: 'taxiway', ref: holdTaxiway.ref }
  else if (target) goal = { kind: 'runway', runway: target }
  else if (holdRunways.length) goal = { kind: 'runway', runway: holdRunways[holdRunways.length - 1] }
  else if (used.length) goal = { kind: 'end' }
  else return null

  // Seeds: the nearest taxiway lines to the aircraft.
  const near = g.edges
    .map((e, i) => ({ i, e, pr: project(g.nodes[e.a], g.nodes[e.b], start) }))
    .filter((x) => x.pr.d < MAX_START_M)
    .sort((a, b) => a.pr.d - b.pr.d)
  if (!near.length) return null
  const nearest = near[0].pr.d
  const seeds: { node: number; cost: number; stage: number; from: XY }[] = []
  const heading = req.moving && req.heading != null ? req.heading : null
  for (const { e, pr } of near.filter((x) => x.pr.d < nearest + 30).slice(0, 12)) {
    for (const [node, part] of [
      [e.a, pr.t],
      [e.b, 1 - pr.t],
    ] as const) {
      const to = g.nodes[node]
      let extra = 0
      if (heading != null) {
        const dir = (Math.atan2(to.x - pr.x, to.y - pr.y) * 180) / Math.PI
        const turn = Math.abs(((dir - heading + 540) % 360) - 180)
        // With no runway to aim for, the way it is already rolling is the only clue to which end is meant.
        if (turn > 100 && part * e.len > 3) extra = goal.kind === 'end' ? TURNAROUND_M * 6 : TURNAROUND_M
      }
      seeds.push({ node, cost: pr.d + part * e.len + extra, stage: used.length && e.ref === used[0] ? 1 : 0, from: { x: pr.x, y: pr.y } })
    }
  }

  let exact = true
  let s = search(g, used, seeds, false)
  let end = pickGoal(g, s, goal, used, false)
  if (end < 0) {
    exact = false
    s = search(g, used, seeds, true)
    end = pickGoal(g, s, goal, used, true)
  }
  if (end < 0) return null

  // Walk back to the seed.
  const nodePath: number[] = []
  for (let st = end; st >= 0; st = s.prev[st]) nodePath.push(Math.floor(st / s.stages))
  nodePath.reverse()
  // The taxiways actually used, in order, for the popup and for checking the result.
  const steps: string[] = []
  for (let i = 1; i < nodePath.length; i++) {
    const between = g.adj[nodePath[i - 1]].map((ei) => g.edges[ei]).filter((e) => e.a === nodePath[i] || e.b === nodePath[i])
    const ref = (between.find((e) => e.ref && used.includes(e.ref)) ?? between[0])?.ref
    if (ref && steps[steps.length - 1] !== ref) steps.push(ref)
  }
  // Every named taxiway, in order? (A skipped one is allowed by the search, at a price.)
  let k = 0
  for (const st of steps) if (st === used[k]) k++
  if (k < used.length) exact = false
  const first = nodePath[0]
  const seed = seeds.filter((x) => x.node === first).sort((a, b) => a.cost - b.cost)[0]
  const points: XY[] = [start]
  if (seed && Math.hypot(seed.from.x - start.x, seed.from.y - start.y) > 1) points.push(seed.from)
  for (const n of nodePath) {
    const p = g.nodes[n]
    const last = points[points.length - 1]
    if (Math.hypot(p.x - last.x, p.y - last.y) > 0.5) points.push(p)
  }

  // Holding points: stop short of the target runway, mark the others on the way.
  const holds: HoldMark[] = []
  let out = points
  const ends = new Set<RunwayXY>(holdRunways)
  for (const r of req.runways) if (r === target) ends.add(r)
  for (const r of ends) {
    const cut = firstEntry(out, (p) => onRunwayBand(r, p, r.holdM))
    const isEnd = r === target || (goal.kind === 'runway' && goal.runway === r)
    if (!cut) {
      // Entering at the very end of the runway, from behind the threshold: hold a little short of the entry.
      if (isEnd && goal.kind === 'runway' && out.length > 2) {
        const trimmed = trimEnd(out, 60)
        out = trimmed.points
        holds.push({ at: out[out.length - 1], bearing: trimmed.bearing, label: `Runway ${r.ident}` })
      }
      continue
    }
    const label = `${r === target && !holdRunways.includes(r) ? 'Runway' : 'Hold short'} ${r.ident}`
    holds.push({ at: cut.at, bearing: cut.bearing, label })
    if (isEnd) out = [...out.slice(0, cut.index), cut.at]
  }
  if (goal.kind === 'taxiway') {
    // Stop clear of the crossing taxiway's pavement.
    const trimmed = trimEnd(out, 28)
    out = trimmed.points
    holds.push({ at: out[out.length - 1], bearing: trimmed.bearing, label: `Hold short ${goal.ref}` })
  }
  // Keep the holds that are still on the (possibly shortened) route, in route order.
  const kept = holds.filter((h) => out.some((p, i) => i > 0 && project(out[i - 1], p, h.at).d < 1))
  return { points: out, holds: kept, steps, runway: target?.ident ?? (goal.kind === 'runway' ? goal.runway.ident : null), used, missing, exact, lengthM: pathLength(out) }
}

/** Where a path first enters a region, interpolated to the boundary. */
function firstEntry(points: XY[], inside: (p: XY) => boolean): { index: number; at: XY; bearing: number } | null {
  if (inside(points[0])) return null
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    // A long leg can pass right through a runway band with both ends outside it: step along it.
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4))
    let k0 = -1
    for (let k = 1; k <= steps; k++) {
      if (inside({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps })) {
        k0 = k
        break
      }
    }
    if (k0 < 0) continue
    // Bisect the step for the boundary.
    let lo = (k0 - 1) / steps
    let hi = k0 / steps
    for (let k = 0; k < 18; k++) {
      const mid = (lo + hi) / 2
      if (inside({ x: a.x + (b.x - a.x) * mid, y: a.y + (b.y - a.y) * mid })) hi = mid
      else lo = mid
    }
    const at = { x: a.x + (b.x - a.x) * lo, y: a.y + (b.y - a.y) * lo }
    return { index: i, at, bearing: bearingOf(a, b) }
  }
  return null
}

/** Shorten a path by `m` metres at its end. */
function trimEnd(points: XY[], m: number): { points: XY[]; bearing: number } {
  let left = m
  const out = points.slice()
  while (out.length > 2) {
    const b = out[out.length - 1]
    const a = out[out.length - 2]
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    if (d > left) {
      const k = (d - left) / d
      out[out.length - 1] = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
      return { points: out, bearing: bearingOf(a, b) }
    }
    left -= d
    out.pop()
  }
  return { points: out, bearing: out.length > 1 ? bearingOf(out[0], out[1]) : 0 }
}

export function bearingOf(a: XY, b: XY): number {
  return ((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI + 360) % 360
}

export function pathLength(points: XY[]): number {
  let d = 0
  for (let i = 1; i < points.length; i++) d += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  return d
}

/**
 * How far along the route the aircraft is, and the route ahead of it: the
 * aircraft's position projected onto the nearest leg (searching forward from
 * the last known leg, so a route that doubles back isn't confused).
 */
export function progressAlong(points: XY[], p: XY, fromLeg = 0): { leg: number; ahead: XY[]; offM: number; remainingM: number } {
  let best = { leg: fromLeg, d: Infinity, x: points[0].x, y: points[0].y }
  for (let i = Math.max(1, fromLeg); i < points.length; i++) {
    const pr = project(points[i - 1], points[i], p)
    if (pr.d < best.d - 0.01) best = { leg: i, d: pr.d, x: pr.x, y: pr.y }
  }
  const ahead = [{ x: best.x, y: best.y }, ...points.slice(best.leg)]
  return { leg: best.leg, ahead, offM: best.d, remainingM: pathLength(ahead) }
}
