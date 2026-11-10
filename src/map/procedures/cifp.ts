/**
 * Reads the FAA's Coded Instrument Flight Procedures (CIFP, ARINC 424
 * fixed-width records) and turns the arrivals, departures and approaches of
 * one airport into map lines.
 *
 * Used by `scripts/fetch-procedures.mjs` only (it runs under Node with type
 * stripping, hence the `.ts` import extensions); the app reads the compact
 * GeoJSON the script writes, never this parser.
 *
 * ARINC 424 legs are instructions ("fly heading 044 until 520 ft", "turn
 * right on a 3.5 nm arc to MPASS"), not geometry. Straight legs to fixes are
 * drawn as they are, arcs are approximated with points, and legs that end on
 * an altitude or a controller's vectors become short stubs in the right
 * direction, which is what a pilot would actually fly before the next leg.
 */
import { bearingDeg, distanceM, M_PER_NM, offset, toLocal, type LngLat } from '../geo.ts'

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** One leg of a SID, STAR or approach (ARINC 424 primary record, continuation records skipped). */
export type Leg = {
  seq: number
  /** Fix the leg ends at (or starts from, for FA/FC/FD/FM), blank when none. */
  fix: string
  fixRegion: string
  /** Section + subsection of the fix record: `EA` enroute waypoint, `PC` terminal waypoint, `D ` VOR, `PG` runway… */
  fixSec: string
  /** Waypoint description code (4 characters): flyover, IAF/FAF/MAP flags, first missed approach leg. */
  desc: string
  turn: '' | 'L' | 'R'
  /** Path and terminator: TF, CF, DF, IF, RF, AF, VA, VM, CA… */
  pt: string
  navaid: string
  navaidRegion: string
  navaidSec: string
  /** Bearing from the recommended navaid, degrees magnetic. */
  thetaDeg: number | null
  /** Distance from the recommended navaid, nm. */
  rhoNm: number | null
  /** Outbound course or heading, degrees magnetic (or true when `courseTrue`). */
  courseDeg: number | null
  courseTrue: boolean
  /** Leg length in nm, or null when the field holds a time (`T010`) or nothing. */
  distNm: number | null
  /** `+` at or above, `-` at or below, `B` between, blank at… */
  altDesc: string
  alt1: string
  alt2: string
  /** Centre of an RF arc. */
  center: string
  centerRegion: string
  centerSec: string
}

export type ProcedureKind = 'sid' | 'star' | 'app'

export type RawProcedure = {
  airport: string
  kind: ProcedureKind
  /** `CAMRN5`, `DEEZZ6`, `I22L`, `R04LY`. */
  id: string
  /** ARINC route type: SID/STAR 1–9 (runway, common, enroute), approaches `A` transition or the approach type letter. */
  routeType: string
  /** `ALL`, `RW04B`, `PVD`, `CIMBL` or blank. */
  transition: string
  legs: Leg[]
}

export type AirportInfo = {
  icao: string
  ref: LngLat
  /** Magnetic variation, degrees, east positive. */
  magVar: number
  elevationFt: number
  /** Runway thresholds by ARINC ident (`RW04L`). */
  runways: Map<string, LngLat>
}

export type CifpData = {
  /** AIRAC cycle the file is for (`2611`). */
  cycle: string
  airports: Map<string, AirportInfo>
  procedures: RawProcedure[]
  /** Lookup a fix by how a leg references it. */
  fix: (sec: string, ident: string, region: string, airport: string) => LngLat | null
}

/** `N40382374` + `W073464329` (degrees, minutes, seconds with hundredths) to `[lon, lat]`. */
export function parseLatLon(lat: string, lon: string): LngLat | null {
  const m1 = /^([NS])(\d{2})(\d{2})(\d{4})$/.exec(lat.trim())
  const m2 = /^([EW])(\d{3})(\d{2})(\d{4})$/.exec(lon.trim())
  if (!m1 || !m2) return null
  const la = (+m1[2] + +m1[3] / 60 + +m1[4] / 100 / 3600) * (m1[1] === 'S' ? -1 : 1)
  const lo = (+m2[2] + +m2[3] / 60 + +m2[4] / 100 / 3600) * (m2[1] === 'W' ? -1 : 1)
  return [lo, la]
}

/** `W0130` → −13, `E0045` → 4.5. */
export function parseMagVar(s: string): number {
  const m = /^([EW])(\d{4})$/.exec(s)
  if (!m) return 0
  return (+m[2] / 10) * (m[1] === 'W' ? -1 : 1)
}

const num = (s: string, scale = 1): number | null => (/^\d+$/.test(s.trim()) ? +s.trim() / scale : null)

/** Parse one SID/STAR/approach primary record. Continuation records return null. */
export function parseLeg(line: string): Leg | null {
  // Column 39 is the continuation number: 0 or 1 is the primary record.
  if (!'01'.includes(line[38])) return null
  const course = line.slice(70, 74)
  const dist = line.slice(74, 78)
  const turn = line[43]
  return {
    seq: +line.slice(26, 29),
    fix: line.slice(29, 34).trim(),
    fixRegion: line.slice(34, 36),
    fixSec: line.slice(36, 38),
    desc: line.slice(39, 43),
    turn: turn === 'L' || turn === 'R' ? turn : '',
    pt: line.slice(47, 49),
    navaid: line.slice(50, 54).trim(),
    navaidRegion: line.slice(54, 56),
    navaidSec: line.slice(78, 80),
    thetaDeg: num(line.slice(62, 66), 10),
    rhoNm: num(line.slice(66, 70), 10),
    courseDeg: course[3] === 'T' ? num(course.slice(0, 3)) : num(course, 10),
    courseTrue: course[3] === 'T',
    distNm: dist.startsWith('T') ? null : num(dist, 10),
    altDesc: line[82] ?? ' ',
    alt1: line.slice(84, 89).trim(),
    alt2: line.slice(89, 94).trim(),
    center: line.slice(106, 111).trim(),
    centerRegion: line.slice(112, 114),
    centerSec: line.slice(114, 116),
  }
}

/**
 * Index the whole CIFP file: every waypoint, navaid and runway (fixes are
 * shared across airports), and the procedures of the airports asked for.
 */
export function parseCifp(text: string, wanted: Set<string>): CifpData {
  const points = new Map<string, LngLat>()
  const terminalAnywhere = new Map<string, LngLat>()
  const airports = new Map<string, AirportInfo>()
  const procedures: RawProcedure[] = []
  let cycle = ''
  const groups = new Map<string, RawProcedure>()

  for (const line of text.split('\n')) {
    if (line.startsWith('HDR01')) {
      cycle = /\d{4}(?=\s+\d{2}-[A-Z]{3}-\d{4})/.exec(line)?.[0] ?? cycle
      continue
    }
    if (line[0] !== 'S') continue
    const sec = line[4]
    if (sec === 'E' && line[5] === 'A') {
      const p = parseLatLon(line.slice(32, 41), line.slice(41, 51))
      if (p) points.set(`EA|${line.slice(13, 18).trim()}|${line.slice(19, 21)}`, p)
    } else if (sec === 'D') {
      // VOR position, or the DME's when the station has no VOR.
      const p = parseLatLon(line.slice(32, 41), line.slice(41, 51)) ?? parseLatLon(line.slice(55, 64), line.slice(64, 74))
      if (p) points.set(`D${line[5]}|${line.slice(13, 17).trim()}|${line.slice(19, 21)}`, p)
    } else if (sec === 'P' && line[5] === 'N') {
      const p = parseLatLon(line.slice(32, 41), line.slice(41, 51))
      if (p) points.set(`PN|${line.slice(6, 10).trim()}|${line.slice(13, 17).trim()}`, p)
    } else if (sec === 'P' && line[5] === ' ') {
      const airport = line.slice(6, 10).trim()
      const sub = line[12]
      if (sub === 'C') {
        const p = parseLatLon(line.slice(32, 41), line.slice(41, 51))
        const ident = line.slice(13, 18).trim()
        if (p) {
          points.set(`PC|${airport}|${ident}`, p)
          terminalAnywhere.set(`${ident}|${line.slice(19, 21)}`, p)
        }
      }
      if (!wanted.has(airport)) continue
      if (sub === 'A') {
        const ref = parseLatLon(line.slice(32, 41), line.slice(41, 51))
        if (ref) {
          const info = airports.get(airport) ?? { icao: airport, ref, magVar: 0, elevationFt: 0, runways: new Map() }
          info.ref = ref
          info.magVar = parseMagVar(line.slice(51, 56))
          info.elevationFt = num(line.slice(56, 61)) ?? 0
          airports.set(airport, info)
          points.set(`PA|${airport}|${airport}`, ref)
        }
      } else if (sub === 'G') {
        const p = parseLatLon(line.slice(32, 41), line.slice(41, 51))
        const ident = line.slice(13, 18).trim()
        if (p) {
          points.set(`PG|${airport}|${ident}`, p)
          const info = airports.get(airport) ?? { icao: airport, ref: p, magVar: 0, elevationFt: 0, runways: new Map() }
          info.runways.set(ident, p)
          airports.set(airport, info)
        }
      } else if (sub === 'D' || sub === 'E' || sub === 'F') {
        const leg = parseLeg(line)
        if (!leg) continue
        const id = line.slice(13, 19).trim()
        const routeType = line[19]
        const transition = line.slice(20, 25).trim()
        const key = `${airport}|${sub}|${id}|${routeType}|${transition}`
        let proc = groups.get(key)
        if (!proc) {
          proc = { airport, kind: sub === 'D' ? 'sid' : sub === 'E' ? 'star' : 'app', id, routeType, transition, legs: [] }
          groups.set(key, proc)
          procedures.push(proc)
        }
        proc.legs.push(leg)
      }
    }
  }
  for (const p of procedures) p.legs.sort((a, b) => a.seq - b.seq)

  const fix = (sec: string, ident: string, region: string, airport: string): LngLat | null => {
    if (!ident) return null
    if (sec[0] === 'P') {
      if (sec === 'PC') return points.get(`PC|${airport}|${ident}`) ?? terminalAnywhere.get(`${ident}|${region}`) ?? null
      return points.get(`${sec}|${airport}|${ident}`) ?? null
    }
    if (sec === 'EA') return points.get(`EA|${ident}|${region}`) ?? terminalAnywhere.get(`${ident}|${region}`) ?? null
    if (sec[0] === 'D') return points.get(`D${sec[1] ?? ' '}|${ident}|${region}`) ?? points.get(`D |${ident}|${region}`) ?? null
    return null
  }

  return { cycle, airports, procedures, fix }
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Point `nm` nautical miles from `p` along a true bearing. */
export function destination(p: LngLat, bearing: number, nm: number): LngLat {
  const r = (bearing * Math.PI) / 180
  return offset(p, Math.sin(r) * nm * M_PER_NM, Math.cos(r) * nm * M_PER_NM)
}

/**
 * Points along an arc around `center` from `from` to `to`, turning left
 * (anticlockwise) or right (clockwise). The radius blends from the start
 * distance to the end distance, so a slightly inconsistent pair still meets
 * both ends. `from` is not included; `to` is.
 */
export function arcPoints(center: LngLat, from: LngLat, to: LngLat, turn: 'L' | 'R', stepDeg = 5): LngLat[] {
  const a0 = bearingDeg(center, from)
  const a1 = bearingDeg(center, to)
  const r0 = distanceM(center, from)
  const r1 = distanceM(center, to)
  let sweep = turn === 'R' ? (a1 - a0 + 360) % 360 : -((a0 - a1 + 360) % 360)
  if (Math.abs(sweep) < 1e-6) sweep = 0
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / stepDeg))
  const out: LngLat[] = []
  for (let i = 1; i < n; i++) {
    const u = i / n
    const a = ((a0 + sweep * u) * Math.PI) / 180
    const r = r0 + (r1 - r0) * u
    out.push(offset(center, Math.sin(a) * r, Math.cos(a) * r))
  }
  out.push(to)
  return out
}

/**
 * Where a ray from `p` on bearing `hdg` meets the line through `q` on bearing
 * `course` (either direction along it), if that happens ahead and within `maxNm`.
 */
export function intercept(p: LngLat, hdg: number, q: LngLat, course: number, maxNm = 30): LngLat | null {
  const [px, py] = toLocal(q, p)
  const ur = (hdg * Math.PI) / 180
  const vr = (course * Math.PI) / 180
  const ux = Math.sin(ur), uy = Math.cos(ur)
  const vx = Math.sin(vr), vy = Math.cos(vr)
  // p + t·u = s·v  →  solve with the 2×2 cross product.
  const den = ux * vy - uy * vx
  if (Math.abs(den) < 1e-6) return null
  const t = (vx * py - vy * px) / den
  if (t <= 0 || t > maxNm * M_PER_NM) return null
  return offset(q, px + ux * t, py + uy * t)
}

/** First distance along a ray from `p` at which it is `d` nm from `c`. */
function rayToDistance(p: LngLat, hdg: number, c: LngLat, nm: number): number | null {
  const [px, py] = toLocal(c, p)
  const r = (hdg * Math.PI) / 180
  const ux = Math.sin(r), uy = Math.cos(r)
  const d = nm * M_PER_NM
  const b = px * ux + py * uy
  const disc = b * b - (px * px + py * py - d * d)
  if (disc < 0) return null
  const ts = [-b - Math.sqrt(disc), -b + Math.sqrt(disc)].filter((t) => t > 0)
  return ts.length ? Math.min(...ts) / M_PER_NM : null
}

/** A fix along a path, with the altitude constraint that applies there. */
export type PathFix = { ident: string; at: LngLat; alt: string | null; role: '' | 'IAF' | 'IF' | 'FAF' }

export type BuiltPath = {
  coords: LngLat[]
  fixes: PathFix[]
  /** Ends in "expect vectors": the line stops but the aircraft carries on under radar control. */
  open: boolean
}

/** Chart-style altitude text: `5000`, `≥3000`, `≤11000`, `8000–10000`, `FL240`. */
export function formatAltitude(desc: string, alt1: string, alt2: string): string | null {
  const fmt = (s: string) => (/^FL\d{3}$/.test(s) ? s : /^\d{5}$/.test(s) ? String(+s) : null)
  const a = fmt(alt1)
  if (!a || a === '0') return null
  if (desc === 'B') {
    const b = fmt(alt2)
    return b ? `${b}–${a}` : `≤${a}`
  }
  if ('+HJV'.includes(desc)) return `≥${a}`
  if ('-Y'.includes(desc)) return `≤${a}`
  return a
}

/** Stub length for a leg that ends at an altitude: about 300 ft per nm climbing, kept between 1 and 5 nm. */
function altitudeStubNm(alt1: string, elevationFt: number): number {
  const ft = /^\d{5}$/.test(alt1) ? +alt1 : /^FL(\d{3})$/.test(alt1) ? +alt1.slice(2) * 100 : null
  if (ft == null) return 2
  return Math.min(5, Math.max(1, (ft - elevationFt) / 300))
}

/** How long a "fly this heading, expect vectors" stub is drawn. */
const VECTOR_STUB_NM = 3

export type PathContext = {
  airport: AirportInfo
  fix: CifpData['fix']
  /** Where the path starts when its first leg has no fix of its own (a runway end for SIDs). */
  start?: LngLat | null
}

/** Turn a list of legs into a line, following the ARINC path terminators as closely as a sketch needs. */
export function buildPath(legs: Leg[], ctx: PathContext): BuiltPath {
  const { airport } = ctx
  const coords: LngLat[] = []
  const fixes: PathFix[] = []
  let pos: LngLat | null = ctx.start ?? null
  let open = false
  if (pos) coords.push(pos)

  const toTrue = (leg: Leg) => (leg.courseDeg == null ? null : leg.courseTrue ? leg.courseDeg : (leg.courseDeg + airport.magVar + 360) % 360)
  const go = (p: LngLat) => {
    const last = coords[coords.length - 1]
    if (!last || Math.abs(last[0] - p[0]) > 1e-7 || Math.abs(last[1] - p[1]) > 1e-7) coords.push(p)
    pos = p
  }
  const lookup = (sec: string, ident: string, region: string) => ctx.fix(sec, ident, region, airport.icao)

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]
    const at = leg.fix ? lookup(leg.fixSec, leg.fix, leg.fixRegion) : null
    const course = toTrue(leg)
    open = false
    switch (leg.pt) {
      case 'IF':
      case 'TF':
      case 'CF':
      case 'DF':
      case 'HA':
      case 'HF':
      case 'HM':
        if (at) go(at)
        break
      case 'RF':
      case 'AF': {
        const c = leg.pt === 'RF' ? lookup(leg.centerSec, leg.center, leg.centerRegion) : lookup(leg.navaidSec, leg.navaid, leg.navaidRegion)
        if (at && pos && c && leg.turn) for (const p of arcPoints(c, pos, at, leg.turn)) go(p)
        else if (at) go(at)
        break
      }
      case 'PI':
        // A procedure turn is flown at the fix; the line just stays there.
        if (at && !pos) go(at)
        break
      case 'FC':
      case 'FA':
      case 'FD':
      case 'FM': {
        const from = at ?? pos
        if (!from || course == null) break
        go(from)
        const nm = leg.pt === 'FC' ? (leg.distNm ?? 2) : leg.pt === 'FA' ? altitudeStubNm(leg.alt1, airport.elevationFt) : leg.pt === 'FD' ? (leg.distNm ?? 2) : VECTOR_STUB_NM
        go(destination(from, course, Math.min(nm, 15)))
        open = leg.pt === 'FM'
        break
      }
      case 'CA':
      case 'VA':
        if (pos && course != null) go(destination(pos, course, altitudeStubNm(leg.alt1, airport.elevationFt)))
        break
      case 'CD':
      case 'VD': {
        if (!pos || course == null) break
        const c = lookup(leg.navaidSec, leg.navaid, leg.navaidRegion)
        const nm = c && leg.distNm != null ? rayToDistance(pos, course, c, leg.distNm) : null
        go(destination(pos, course, Math.min(nm ?? 2, 15)))
        break
      }
      case 'CR':
      case 'VR': {
        if (!pos || course == null) break
        const c = lookup(leg.navaidSec, leg.navaid, leg.navaidRegion)
        const radial = leg.thetaDeg != null ? (leg.thetaDeg + airport.magVar + 360) % 360 : null
        go((c && radial != null && intercept(pos, course, c, radial, 15)) || destination(pos, course, 2))
        break
      }
      case 'CI':
      case 'VI': {
        if (!pos || course == null) break
        // Intercept the next leg's course into its fix.
        const next = legs[i + 1]
        const nextAt = next?.fix ? lookup(next.fixSec, next.fix, next.fixRegion) : null
        const nextCourse = next ? toTrue(next) : null
        go((nextAt && nextCourse != null && intercept(pos, course, nextAt, nextCourse, 15)) || destination(pos, course, 2))
        break
      }
      case 'VM':
        if (pos && course != null) go(destination(pos, course, VECTOR_STUB_NM))
        open = true
        break
      default:
        if (at) go(at)
    }
    if (at && leg.fix && leg.fixSec !== 'PG' && leg.fixSec !== 'PA') {
      const r = leg.desc[3]
      const role = r === 'F' ? 'FAF' : r === 'I' || r === 'B' ? 'IF' : r === 'A' || r === 'C' || r === 'D' ? 'IAF' : ''
      fixes.push({ ident: leg.fix, at, alt: formatAltitude(leg.altDesc, leg.alt1, leg.alt2), role })
    }
  }
  return { coords, fixes, open }
}

/** Legs of an approach's final route up to the missed approach point (the missed approach itself is left out). */
export function finalLegs(legs: Leg[]): Leg[] {
  const out: Leg[] = []
  for (const leg of legs) {
    if (leg.desc[2] === 'M') break
    out.push(leg)
    if (leg.desc[3] === 'M') break
  }
  return out
}

// ---------------------------------------------------------------------------
// Line clean-up
// ---------------------------------------------------------------------------

/** Douglas–Peucker in a local metric frame. */
export function simplify(coords: LngLat[], toleranceM: number): LngLat[] {
  if (coords.length < 3) return coords
  const origin = coords[0]
  const xy = coords.map((c) => toLocal(origin, c))
  const keep = new Uint8Array(coords.length)
  keep[0] = keep[coords.length - 1] = 1
  const stack: [number, number][] = [[0, coords.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = xy[a], [bx, by] = xy[b]
    const dx = bx - ax, dy = by - ay
    const len = Math.hypot(dx, dy) || 1
    let worst = -1, at = -1
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((xy[i][0] - ax) * dy - (xy[i][1] - ay) * dx) / len
      if (d > worst) {
        worst = d
        at = i
      }
    }
    if (worst > toleranceM) {
      keep[at] = 1
      stack.push([a, at], [at, b])
    }
  }
  return coords.filter((_, i) => keep[i])
}

/** Keep the parts of a line within `radiusNm` of `centre`, cutting segments that cross the edge. */
export function clipToRadius(coords: LngLat[], centre: LngLat, radiusNm: number): LngLat[][] {
  const r = radiusNm * M_PER_NM
  const inside = (p: LngLat) => distanceM(centre, p) <= r
  const edge = (a: LngLat, b: LngLat): LngLat => {
    // Bisect for the crossing; a few metres is plenty.
    let lo = 0, hi = 1
    const aIn = inside(a)
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2
      const p: LngLat = [a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid]
      if (inside(p) === aIn) lo = mid
      else hi = mid
    }
    const u = (lo + hi) / 2
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]
  }
  const runs: LngLat[][] = []
  let run: LngLat[] = []
  for (let i = 0; i < coords.length; i++) {
    const p = coords[i]
    const pin = inside(p)
    if (i > 0) {
      const prev = coords[i - 1]
      const qin = inside(prev)
      if (qin && !pin) {
        run.push(edge(prev, p))
        runs.push(run)
        run = []
      } else if (!qin && pin) run.push(edge(prev, p))
    }
    if (pin) run.push(p)
  }
  if (run.length) runs.push(run)
  return runs.filter((x) => x.length >= 2)
}

export const round5 = (p: LngLat): LngLat => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const APPROACH_TYPES: Record<string, string> = {
  I: 'ILS',
  L: 'LOC',
  X: 'LDA',
  R: 'RNAV (GPS)',
  H: 'RNAV (RNP)',
  J: 'GLS',
}

/** Preference when two approaches draw the same line: the one controllers usually clear people for wins. */
const APPROACH_RANK = 'IXLRHJ'

/** `I22L` → ILS 22L; `R04LY` / `H05-Z` → RNAV (GPS) Y 04L. Null for approach types we don't draw (VOR, NDB, circling). */
export function approachInfo(id: string): { name: string; runway: string; type: string; rank: number } | null {
  const m = /^([A-Z])(\d{2}[LCR]?)-?([A-Z])?$/.exec(id)
  if (!m || !APPROACH_TYPES[m[1]]) return null
  const type = APPROACH_TYPES[m[1]]
  return { name: `${type}${m[3] ? ` ${m[3]}` : ''} ${m[2]}`, runway: m[2], type: m[1], rank: APPROACH_RANK.indexOf(m[1]) }
}

/** `RW04L` → `4L` (as painted at US airports). */
export const paintedRunway = (rw: string) => rw.replace(/^RW/, '').replace(/^0/, '')

/** Runways a transition name covers: `RW04B` means both 04L and 04R (or all three). */
export function runwaysFor(transition: string, runways: Iterable<string>): string[] {
  if (!/^RW\d{2}/.test(transition)) return []
  if (transition.length === 5 && transition[4] === 'B') return [...runways].filter((r) => r.length === 5 && r.startsWith(transition.slice(0, 4)) && 'LCR'.includes(r[4])).sort()
  return [transition]
}

/** The far end of the runway, where a departure leaves the ground (reciprocal threshold). */
export function departureEnd(rw: string, runways: Map<string, LngLat>): LngLat | null {
  const m = /^RW(\d{2})([LCR]?)$/.exec(rw)
  if (!m) return runways.get(rw) ?? null
  const n = ((+m[1] + 17) % 36) + 1
  const side = m[2] === 'L' ? 'R' : m[2] === 'R' ? 'L' : m[2]
  return runways.get(`RW${String(n).padStart(2, '0')}${side}`) ?? runways.get(rw) ?? null
}
