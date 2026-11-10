/**
 * Turns one airport's parsed CIFP procedures into the compact GeoJSON the map
 * loads (`public/procedures/{code}.json`). Run by `scripts/fetch-procedures.mjs`.
 *
 * Keeps files small: lines are cut 70 nm from the field (the map never shows
 * more), simplified to about 15 m, rounded to 5 decimals (~1 m), and
 * procedures that draw the same line are merged into one feature.
 */
import { distanceM, M_PER_NM, toLocal, type LngLat } from '../geo.ts'
import { approachInfo, buildPath, clipToRadius, departureEnd, finalLegs, paintedRunway, round5, runwaysFor, simplify, type CifpData, type PathFix, type RawProcedure } from './cifp.ts'
import type { ProcedureFile, ProcFix, ProcKind, ProcLine, ProcLineProps } from './procedures.ts'

export const CLIP_NM = 70
const SIMPLIFY_M = 15

type Draft = { props: ProcLineProps; coords: LngLat[]; fixes: PathFix[]; rank: number }

const join = (a: string | undefined, b: string | undefined, sep: string) => {
  const parts = [...(a ? a.split(sep) : []), ...(b ? b.split(sep) : [])]
  return [...new Set(parts)].join(sep) || undefined
}

/** Fraction of `a` (sampled every ~200 m) lying within `tolM` of line `b`. */
export function coverage(a: LngLat[], b: LngLat[], tolM = 400): number {
  const samples: LngLat[] = []
  for (let i = 1; i < a.length; i++) {
    const n = Math.max(1, Math.ceil(distanceM(a[i - 1], a[i]) / 200))
    for (let k = 0; k < n; k++) samples.push([a[i - 1][0] + ((a[i][0] - a[i - 1][0]) * k) / n, a[i - 1][1] + ((a[i][1] - a[i - 1][1]) * k) / n])
  }
  samples.push(a[a.length - 1])
  let hit = 0
  for (const p of samples) {
    let best = Infinity
    for (let i = 1; i < b.length && best > tolM; i++) {
      const [bx, by] = toLocal(b[i - 1], b[i])
      const [px, py] = toLocal(b[i - 1], p)
      const len2 = bx * bx + by * by
      const u = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0
      best = Math.min(best, Math.hypot(px - bx * u, py - by * u))
    }
    if (best <= tolM) hit++
  }
  return hit / samples.length
}

const pathLength = (c: LngLat[]) => c.reduce((s, p, i) => (i ? s + distanceM(c[i - 1], p) : s), 0)

/** Every drawable branch of one procedure (a SID runway transition `RW31B` becomes one per runway). */
function drafts(proc: RawProcedure, data: CifpData): Draft[] {
  const info = data.airports.get(proc.airport)
  if (!info) return []
  const ctx = { airport: info, fix: data.fix }
  const runwayIds = [...info.runways.keys()]
  const out: Draft[] = []
  const add = (kind: ProcKind, legs: RawProcedure['legs'], props: Omit<ProcLineProps, 'k'>, start?: LngLat | null, rank = 0) => {
    const path = buildPath(legs, { ...ctx, start })
    if (path.coords.length < 2) return
    out.push({ props: { k: kind, ...props }, coords: path.coords, fixes: path.fixes, rank })
  }

  if (proc.kind === 'app') {
    const app = approachInfo(proc.id)
    if (!app) return []
    const rw = paintedRunway(app.runway)
    if (proc.routeType === 'A') add('trans', proc.legs, { n: app.name, t: `from ${proc.transition}`, rw }, null, app.rank)
    else add('final', finalLegs(proc.legs), { n: app.name, rw }, null, app.rank)
    return out
  }

  const rws = runwaysFor(proc.transition, runwayIds)
  const what = proc.kind === 'sid' ? 'departure' : 'arrival'
  const name = `${proc.id} ${what}`
  if (rws.length) {
    if (proc.kind === 'sid') {
      // Each runway's departure starts from its own far end.
      for (const r of rws) add('sid', proc.legs, { n: name, t: `Runway ${paintedRunway(r)}`, rw: paintedRunway(r) }, departureEnd(r, info.runways))
    } else {
      const painted = rws.map(paintedRunway)
      add('star', proc.legs, { n: name, t: `Runway ${painted.join(', ')}`, rw: painted.join(' ') })
    }
  } else {
    const common = !proc.transition || proc.transition === 'ALL'
    add(proc.kind, proc.legs, { n: name, t: common ? undefined : `${proc.transition} transition` })
  }
  return out
}

const FIX_PRIORITY: Record<ProcKind, number> = { final: 4, trans: 3, star: 2, sid: 1 }

/** The GeoJSON file for one airport (by ICAO code), or null when the CIFP has nothing for it. */
export function buildAirportFile(data: CifpData, icao: string): ProcedureFile | null {
  const info = data.airports.get(icao)
  if (!info) return null

  // 1. Geometry for every branch, cut to the area the map shows.
  const all: Draft[] = []
  for (const proc of data.procedures) {
    if (proc.airport !== icao) continue
    for (const d of drafts(proc, data)) {
      const runs = clipToRadius(d.coords, info.ref, CLIP_NM)
      for (const run of runs) {
        const coords = simplify(run, SIMPLIFY_M).map(round5)
        if (coords.length < 2 || pathLength(coords) < 0.2 * M_PER_NM) continue
        all.push({ ...d, coords, fixes: d.fixes.filter((f) => distanceM(info.ref, f.at) <= CLIP_NM * M_PER_NM) })
      }
    }
  }

  // 2. Merge branches that draw the same line.
  const kept: Draft[] = []
  const byGeometry = new Map<string, Draft>()
  // Finals best-ranked first, so ILS keeps the name and the others become "also".
  const finals = all.filter((d) => d.props.k === 'final').sort((a, b) => a.rank - b.rank)
  for (const d of finals) {
    const twin = kept.find((k) => k.props.rw === d.props.rw && (coverage(d.coords, k.coords) >= 0.9 || coverage(k.coords, d.coords) >= 0.9))
    if (!twin) {
      kept.push(d)
      continue
    }
    if (twin.props.n !== d.props.n) twin.props.also = join(twin.props.also, d.props.n, ' · ')
    // Keep the longer drawing: an RNAV final often starts further out than the ILS.
    if (pathLength(d.coords) > pathLength(twin.coords) + 500) twin.coords = d.coords
    twin.fixes.push(...d.fixes)
  }
  // Best-ranked approach first, so a shared transition is named after the ILS.
  for (const d of all.filter((x) => x.props.k !== 'final').sort((a, b) => a.rank - b.rank)) {
    const key = `${d.props.k}|${d.props.k === 'trans' ? '' : d.props.n}|${d.coords.map((c) => c.join(',')).join(';')}`
    const twin = byGeometry.get(key)
    if (!twin) {
      byGeometry.set(key, d)
      kept.push(d)
      continue
    }
    twin.props.rw = join(twin.props.rw, d.props.rw, ' ')
    if (d.props.k === 'trans') {
      if (d.props.n !== twin.props.n) twin.props.also = join(twin.props.also, d.props.n, ' · ')
    } else if (d.props.t !== twin.props.t) twin.props.t = mergeBranches(twin.props.t, d.props.t)
  }

  // 3. One point per fix, carrying the constraint that matters most there (approach over arrival over departure).
  const fixes = new Map<string, { f: PathFix; pri: number; approach: boolean; faf: boolean }>()
  for (const d of kept) {
    const pri = FIX_PRIORITY[d.props.k]
    for (const f of d.fixes) {
      const prev = fixes.get(f.ident)
      const approach = d.props.k === 'final' || d.props.k === 'trans'
      const faf = (prev?.faf ?? false) || (d.props.k === 'final' && f.role === 'FAF')
      if (!prev || pri > prev.pri || (pri === prev.pri && !prev.f.alt && f.alt)) fixes.set(f.ident, { f, pri, approach: approach || (prev?.approach ?? false), faf })
      else fixes.set(f.ident, { ...prev, approach: prev.approach || approach, faf })
    }
  }

  const ORDER: Record<ProcKind, number> = { sid: 0, star: 1, trans: 2, final: 3 }
  kept.sort((a, b) => ORDER[a.props.k] - ORDER[b.props.k] || a.props.n.localeCompare(b.props.n))
  const lines: ProcLine[] = kept.map((d) => {
    const fx = [...new Set(d.fixes.map((f) => f.ident))].join(' ')
    const props: ProcLineProps = { ...d.props, ...(fx ? { fx } : {}) }
    for (const k of Object.keys(props) as (keyof ProcLineProps)[]) if (props[k] === undefined) delete props[k]
    return { type: 'Feature', geometry: { type: 'LineString', coordinates: d.coords }, properties: props }
  })
  const points: ProcFix[] = [...fixes.values()]
    .sort((a, b) => a.f.ident.localeCompare(b.f.ident))
    .map(({ f, approach, faf }) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: round5(f.at) },
      properties: { k: 'fix', n: f.ident, ...(f.alt ? { a: f.alt } : {}), ...(approach ? { f: 1 as const } : {}), ...(faf ? { faf: 1 as const } : {}) },
    }))
  if (!lines.length) return null
  return { type: 'FeatureCollection', airport: icao, cycle: data.cycle, features: [...lines, ...points] }
}

/** `Runway 4L` + `Runway 13L` → `Runway 4L, 13L`; other branch names are listed. */
function mergeBranches(a: string | undefined, b: string | undefined): string | undefined {
  if (!a || !b) return a ?? b
  const ra = /^Runways? (.+)$/.exec(a)
  const rb = /^Runways? (.+)$/.exec(b)
  if (ra && rb) {
    const list = [...new Set([...ra[1].split(', '), ...rb[1].split(', ')])]
    return `Runway${list.length > 1 ? 's' : ''} ${list.join(', ')}`
  }
  const ta = /^(.+) transitions?$/.exec(a)
  const tb = /^(.+) transitions?$/.exec(b)
  if (ta && tb) {
    const list = [...new Set([...ta[1].split(', '), ...tb[1].split(', ')])]
    return `${list.join(', ')} transition${list.length > 1 ? 's' : ''}`
  }
  return join(a, b, ' · ')
}
