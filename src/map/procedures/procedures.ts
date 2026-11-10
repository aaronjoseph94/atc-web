/**
 * Instrument procedures as the app draws them: the file format written by
 * `scripts/fetch-procedures.mjs` into `public/procedures/{code}.json`, and the
 * pure logic the map layer runs on it (overlap removal, labels, which
 * procedure an aircraft is flying, which finals are in use).
 */
import { angleDelta, bearingDeg, M_PER_NM, toLocal, type LngLat } from '../geo.ts'

/**
 * `final`: an approach from its first fix to the runway (ILS, RNAV, LOC…);
 * `trans`: an approach transition feeding it; `star` / `sid`: arrival and departure routes.
 */
export type ProcKind = 'final' | 'trans' | 'star' | 'sid'

export type ProcLineProps = {
  k: ProcKind
  /** Display name: `ILS 22L`, `CAMRN5 arrival`, `DEEZZ6 departure`. */
  n: string
  /** Other approaches that draw the same line (`LOC 22L · RNAV (GPS) Y 22L`). */
  also?: string
  /** Which branch: `PVD transition`, `Runway 4L`, `from CIMBL`. */
  t?: string
  /** Runways (as painted, space separated) the line serves. */
  rw?: string
  /** Fixes along the line, space separated. */
  fx?: string
}

export type ProcFixProps = {
  k: 'fix'
  n: string
  /** Altitude constraint as charted: `3000`, `≥5000`, `FL240`. */
  a?: string
  /** On an approach (shown from a lower zoom than the arrival and departure fixes). */
  f?: 1
  /** Final approach fix. */
  faf?: 1
}

export type ProcLine = { type: 'Feature'; geometry: { type: 'LineString'; coordinates: LngLat[] }; properties: ProcLineProps }
export type ProcFix = { type: 'Feature'; geometry: { type: 'Point'; coordinates: LngLat }; properties: ProcFixProps }

export type ProcedureFile = {
  type: 'FeatureCollection'
  /** ICAO code and AIRAC cycle of the CIFP the file was made from. */
  airport: string
  cycle: string
  features: (ProcLine | ProcFix)[]
}

export const isLine = (f: ProcLine | ProcFix): f is ProcLine => f.geometry.type === 'LineString'

/** What a tap on a procedure line says: `CAMRN5 arrival`, then `PVD transition`. */
export function procedureTitle(p: ProcLineProps): { title: string; detail: string | null } {
  const also = p.also ? `also ${p.also}` : null
  const detail = [p.t, also].filter(Boolean).join(', ')
  return { title: p.n, detail: detail ? detail[0].toUpperCase() + detail.slice(1) : null }
}

// ---------------------------------------------------------------------------
// Overlap removal
// ---------------------------------------------------------------------------

/**
 * Many procedures share segments (every transition of an arrival ends on
 * the same common route). Drawn as-is, the translucent lines would stack up
 * and the shared parts would glow. This keeps each segment once, joining
 * consecutive new segments back into lines so dashes run on.
 */
export function uniqueSegments(lines: ProcLine[]): LngLat[][] {
  const seen = new Set<string>()
  const key = (a: LngLat, b: LngLat) => {
    const ka = `${a[0].toFixed(4)},${a[1].toFixed(4)}`
    const kb = `${b[0].toFixed(4)},${b[1].toFixed(4)}`
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
  }
  const out: LngLat[][] = []
  for (const line of lines) {
    const c = line.geometry.coordinates
    let run: LngLat[] = []
    for (let i = 1; i < c.length; i++) {
      const k = key(c[i - 1], c[i])
      if (seen.has(k)) {
        if (run.length > 1) out.push(run)
        run = []
        continue
      }
      seen.add(k)
      if (!run.length) run.push(c[i - 1])
      run.push(c[i])
    }
    if (run.length > 1) out.push(run)
  }
  return out
}

// ---------------------------------------------------------------------------
// Matching aircraft to procedures
// ---------------------------------------------------------------------------

export type Traffic = {
  lon: number
  lat: number
  heading: number
  altitudeFt: number | null
  onGround: boolean
  verticalRateFpm?: number | null
}

/** Closest approach of `p` to a line, and the line's direction there. */
export function nearestOnLine(p: LngLat, coords: LngLat[]): { distNm: number; bearing: number; along: number } | null {
  let best: { distNm: number; bearing: number; along: number } | null = null
  let walked = 0
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]
    const [bx, by] = toLocal(a, coords[i])
    const [px, py] = toLocal(a, p)
    const len2 = bx * bx + by * by
    const len = Math.sqrt(len2)
    const u = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0
    const d = Math.hypot(px - bx * u, py - by * u) / M_PER_NM
    if (!best || d < best.distNm) best = { distNm: d, bearing: bearingDeg(a, coords[i]), along: (walked + len * u) / M_PER_NM }
    walked += len
  }
  return best
}

/** How far off a line, and how far off its direction, an aircraft may be and still count as flying it. */
const MATCH_NM = 1.5
const MATCH_DEG = 35

/**
 * The procedure an aircraft is most likely flying: the nearest line it is on
 * (within 1.5 nm) and heading along (within 35°), with a sanity check on what
 * it is doing vertically (finals are low, departures don't descend, arrivals
 * don't climb hard). Returns the line's index or -1.
 */
export function matchProcedure(ac: Traffic, lines: ProcLine[], elevationFt: number): number {
  if (ac.onGround) return -1
  const agl = ac.altitudeFt == null ? null : ac.altitudeFt - elevationFt
  const vs = ac.verticalRateFpm ?? 0
  let best = -1
  let bestScore = Infinity
  for (let i = 0; i < lines.length; i++) {
    const { k } = lines[i].properties
    if ((k === 'final' || k === 'trans') && agl != null && agl > (k === 'final' ? 6000 : 12000)) continue
    if (k === 'sid' && vs < -500) continue
    if (k !== 'sid' && vs > 1000) continue
    const near = nearestOnLine([ac.lon, ac.lat], lines[i].geometry.coordinates)
    if (!near || near.distNm > MATCH_NM) continue
    const off = Math.abs(angleDelta(near.bearing, ac.heading))
    if (off > MATCH_DEG) continue
    // Prefer the closest line, then the best-aligned; finals win ties near the field.
    const score = near.distNm + off / 60 - (k === 'final' ? 0.2 : 0)
    if (score < bestScore) {
      bestScore = score
      best = i
    }
  }
  return best
}

/** `04L` / `4L` → `4L`, so CIFP and painted designators compare equal. */
export const normRunway = (r: string) => r.replace(/^RW/, '').replace(/^0/, '')

/**
 * Runways announced on a D-ATIS: landing ("APPROACH IN USE ILS RY 31L",
 * "SIMUL APCHS IN USE RWYS 9L, 10C AND 10L") and departing ("DEPG RY 31L").
 * Sentences about closures are skipped.
 */
export function atisRunways(text: string): { landing: string[]; departing: string[] } {
  const landing = new Set<string>()
  const departing = new Set<string>()
  const runways = (part: string) =>
    /\b(RWYS?|RYS?|RUNWAYS?)\b/.test(part) ? [...part.matchAll(/\b(0?[1-9]|[12]\d|3[0-6])([LCR])?\b/g)].map((m) => normRunway(`${m[1]}${m[2] ?? ''}`)) : []
  // "RWY16R" is written without a space as often as with one.
  const tidy = text.toUpperCase().replace(/\b(RWYS?|RYS?)(?=\d)/g, '$1 ')
  for (const sentence of tidy.split(/\.\s+|\.$/)) {
    if (/\b(CLSD|CLOSED|OTS)\b/.test(sentence)) continue
    // "LDG RWY 4R, DEPG RWY 4L": what comes after the departure word is about departures.
    const [before, , after = ''] = sentence.split(/\b(DEPG|DEPS?|DEPARTING|DEPARTURES?)\b/)
    const lands = /\b(APCHS?|APPROACH(ES)?|LNDG|LDG|LANDING|ARRIVALS?|ARRIVING|ARR)\b/.test(before)
    const dep = runways(after)
    for (const r of dep) departing.add(r)
    if (!lands) continue
    // "LNDG AND DEPG RWYS 22L, 22R" names the runways once for both.
    const land = runways(before)
    for (const r of land.length ? land : /\bAND\s*$/.test(before) ? dep : []) landing.add(r)
  }
  return { landing: [...landing], departing: [...departing] }
}

/**
 * Which lines to draw. Branches tied to a runway (a STAR's or SID's runway
 * transition, an approach transition) are shown for the runways in use, when
 * that is known, so a big airport isn't drawn with every runway's spaghetti.
 * Common routes, enroute transitions and every final always show.
 */
export function visibleLines(lines: ProcLine[], landing: Set<string>, departing: Set<string>): ProcLine[] {
  return lines.filter(({ properties: p }) => {
    if (p.k === 'final' || !p.rw) return true
    const use = p.k === 'sid' ? departing : landing
    return !use.size || p.rw.split(' ').some((r) => use.has(normRunway(r)))
  })
}

/**
 * Runways whose finals are in use: the ones aircraft have landed on lately
 * (from the event log) plus the ones aircraft are established on right now.
 */
export function runwaysInUseNow(traffic: Traffic[], finals: ProcLine[], elevationFt: number, landed: string[]): Set<string> {
  const used = new Set(landed.map(normRunway))
  for (const ac of traffic) {
    if (ac.onGround || ac.altitudeFt == null || ac.altitudeFt - elevationFt > 5000) continue
    const i = matchProcedure(ac, finals, elevationFt)
    if (i < 0) continue
    for (const r of (finals[i].properties.rw ?? '').split(' ')) if (r) used.add(normRunway(r))
  }
  return used
}
