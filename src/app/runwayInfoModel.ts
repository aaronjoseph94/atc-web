/**
 * Which runway is under a tap, and the plain facts about it for the runway
 * popover: designators, length, width, headings and surface.
 */
import { getRunways, icaoCode, paintedDesignator, type Runway } from '../api/airportData'
import type { ActiveRunways, RunwayRole } from '../live/runwayUse'
import { bearingDeg, toLocal, type LngLat } from '../map/geo'

export type RunwayEndFacts = {
  /** As painted: `4L`, `05`. */
  ident: string
  /** Direction of travel landing or taking off on this end, degrees true. */
  headingDeg: number
  /** Landing threshold moved in from the pavement end, feet (0 when none). */
  displacedFt: number
}

export type RunwayFacts = {
  /** `4L/22R`. */
  name: string
  lengthFt: number | null
  widthFt: number | null
  surface: string | null
  ends: [RunwayEndFacts, RunwayEndFacts]
  /** Middle of the runway, for anchoring the popover. */
  centre: LngLat
}

const SURFACES: [RegExp, string][] = [
  [/^(asp|asph)[-/](con|conc)$/i, 'Asphalt and concrete'],
  [/^(con|conc|pem)/i, 'Concrete'],
  [/^(asp|asph|bit)/i, 'Asphalt'],
  [/^(grs|turf|grass)/i, 'Grass'],
  [/^(gvl|grv|gravel)/i, 'Gravel'],
]

/** Surface code from the data (`ASPH`, `CONC`…) in words. */
export function surfaceName(code: string | null | undefined): string | null {
  if (!code) return null
  for (const [re, name] of SURFACES) if (re.test(code)) return name
  return code
}

/** Facts for one runway record. */
export function runwayFacts(r: Runway, iata: string): RunwayFacts {
  const icao = icaoCode(iata)
  const a: LngLat = [r.le.lon, r.le.lat]
  const b: LngLat = [r.he.lon, r.he.lat]
  const le = paintedDesignator(r.le.ident, icao)
  const he = paintedDesignator(r.he.ident, icao)
  const leHdg = r.le.hdg ?? bearingDeg(a, b)
  const heHdg = r.he.hdg ?? bearingDeg(b, a)
  return {
    name: `${le}/${he}`,
    lengthFt: r.lengthFt,
    widthFt: r.widthFt,
    surface: surfaceName(r.surface),
    ends: [
      { ident: le, headingDeg: Math.round(leHdg) % 360, displacedFt: r.le.displacedFt ?? 0 },
      { ident: he, headingDeg: Math.round(heHdg) % 360, displacedFt: r.he.displacedFt ?? 0 },
    ],
    centre: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
  }
}

/**
 * The runway whose pavement contains `p`, allowing `slopM` metres all round
 * (so a tap on the thin line of a zoomed-out runway, or its end label, still
 * counts). Where two runways cross, the one whose centreline is closer wins.
 */
export function runwayAt(iata: string, p: LngLat, slopM: number): RunwayFacts | null {
  let best: { r: Runway; off: number } | null = null
  for (const r of getRunways(iata)) {
    const a: LngLat = [r.le.lon, r.le.lat]
    const [e, n] = toLocal(a, [r.he.lon, r.he.lat])
    const length = Math.hypot(e, n)
    if (!(length > 50)) continue
    const ux = e / length
    const uy = n / length
    const [x, y] = toLocal(a, p)
    const along = x * ux + y * uy
    const cross = Math.abs(x * uy - y * ux)
    const half = ((r.widthFt ?? 150) * 0.3048) / 2
    // The end labels sit just past each end, so the ends get extra reach.
    if (along < -slopM * 2 || along > length + slopM * 2 || cross > half + slopM) continue
    if (!best || cross < best.off) best = { r, off: cross }
  }
  return best ? runwayFacts(best.r, iata) : null
}

/** `12,079 × 200 ft` (or metres). */
export function formatRunwaySize(f: Pick<RunwayFacts, 'lengthFt' | 'widthFt'>, metric: boolean): string | null {
  if (f.lengthFt == null) return null
  const len = metric ? Math.round(f.lengthFt * 0.3048) : f.lengthFt
  const wid = f.widthFt == null ? null : metric ? Math.round(f.widthFt * 0.3048) : f.widthFt
  return `${len.toLocaleString('en-US')}${wid != null ? ` × ${wid.toLocaleString('en-US')}` : ''} ${metric ? 'm' : 'ft'}`
}

export type LiveRunwayStatus = {
  /** `active`: seen in use now; `idle`: other runways are, this one isn't; `guess`: no traffic yet, the wind's pick. */
  tone: 'active' | 'idle' | 'guess'
  /** Per active end: its designator and what it is used for. */
  ends: { ident: string; role: RunwayRole }[]
  text: string
}

const ROLE_TEXT: Record<RunwayRole, string> = { arrivals: 'landings', departures: 'departures', both: 'landings and departures' }

/** What the live traffic says about this runway, for the runway card. Null when there is nothing to say. */
export function liveRunwayStatus(facts: Pick<RunwayFacts, 'ends'>, active: ActiveRunways | null | undefined): LiveRunwayStatus | null {
  if (!active || active.basis === 'none') return null
  const mine = new Set(facts.ends.map((e) => e.ident))
  if (active.basis === 'wind') {
    const favoured = active.favoured.filter((r) => mine.has(r))
    return favoured.length ? { tone: 'guess', ends: [], text: `No traffic seen yet; the wind favours ${favoured.join(' and ')}` } : null
  }
  const ends = active.runways.filter((r) => mine.has(r.ident) && r.role).map((r) => ({ ident: r.ident, role: r.role! }))
  if (!ends.length) return { tone: 'idle', ends: [], text: active.basis === 'atis' ? 'Not in use, per the ATIS' : 'Not in use right now' }
  if (active.basis === 'atis') return { tone: 'active', ends, text: `The ATIS has it in use for ${ends.map((e) => `${ROLE_TEXT[e.role]} on ${e.ident}`).join('; ')}` }
  const counts = active.runways.filter((r) => mine.has(r.ident)).reduce((n, r) => ({ arr: n.arr + r.arrivalCount, dep: n.dep + r.departureCount }), { arr: 0, dep: 0 })
  const plural = (n: number, word: string) => (n ? `${n} ${word}${n === 1 ? '' : 's'}` : '')
  const tally = [plural(counts.arr, 'arrival'), plural(counts.dep, 'departure')].filter(Boolean).join(', ')
  const what = ends.map((e) => `${ROLE_TEXT[e.role]} on ${e.ident}`).join('; ')
  return { tone: 'active', ends, text: `In use for ${what}${tally ? ` (${tally} in the last 20 min)` : ''}` }
}
