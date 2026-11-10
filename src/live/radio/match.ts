/**
 * Pairs callsigns heard on the radio with aircraft on the live map.
 *
 * Exact matches first (DAL288 heard, DAL288 on ADS-B). Then forgiving ones,
 * because speech recognition slips: same airline with one digit wrong,
 * missing or extra, or a suffix letter dropped. The station's role breaks
 * ties: Ground and Clearance talk to aircraft on the ground, Approach and
 * Departure to aircraft in the air. Anything below `MIN_CONFIDENCE` is
 * ignored rather than highlighting the wrong aeroplane.
 */
import type { Aircraft, StationKind } from '../../api/types'
import type { CallsignMention } from './callsigns'

/** Weaker matches than this are dropped. */
export const MIN_CONFIDENCE = 0.55

export type RadioMatch = {
  icao24: string
  callsign: string
  confidence: number
  mention: CallsignMention
}

type Candidate = Pick<Aircraft, 'icao24' | 'callsign' | 'onGround' | 'altitudeFt'> & { registration?: string | null }

const clean = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/** `DAL288` → { prefix: 'DAL', digits: '288', suffix: '' }; null for registrations and odd callsigns. */
export function splitFlight(callsign: string): { prefix: string; digits: string; suffix: string } | null {
  const m = /^([A-Z]{3})0*(\d{1,4})([A-Z]{0,2})$/.exec(clean(callsign))
  return m ? { prefix: m[1], digits: m[2], suffix: m[3] } : null
}

/** True when `a` becomes `b` by changing, adding or removing exactly one character. */
export function oneEditApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false
  if (a.length === b.length) {
    let diff = 0
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diff > 1) return false
    return diff === 1
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a]
  for (let i = 0; i < l.length; i++) if (l.slice(0, i) + l.slice(i + 1) === s) return true
  return false
}

/** How well one mention fits one aircraft, 0 (not at all) to 1 (certain), before role and ambiguity. */
export function fit(mention: CallsignMention, a: Candidate): number {
  const cs = clean(a.callsign)
  const reg = clean(a.registration)
  if (mention.kind === 'airline') {
    const f = splitFlight(cs)
    if (!f || f.prefix !== mention.prefix || !mention.digits) return 0
    const heard = mention.digits
    const said = mention.suffix ?? ''
    if (f.digits === heard) return f.suffix === said ? 1 : said && !f.suffix ? 0.75 : 0.85
    // One slipped digit: only for numbers long enough that it still says something.
    if (heard.length >= 3 && f.digits.length >= 3 && oneEditApart(f.digits, heard)) return f.suffix === said ? 0.62 : 0.56
    return 0
  }
  if (mention.kind === 'tail') {
    const want = clean(mention.callsign)
    if (want === cs || want === reg) return 0.97
    // Recognisers drop or mishear one character of a registration more often than a flight number.
    if (want.length >= 4 && ((cs && oneEditApart(want, cs)) || (reg && oneEditApart(want, reg)))) return 0.6
    return 0
  }
  // Partial tail ("Cessna eight Charlie"): the end of an N-number or a Canadian registration.
  const tail = clean(mention.callsign)
  const ident = /^N\d/.test(cs) || /^C[FGI][A-Z]{3}$/.test(cs) ? cs : /^N\d/.test(reg) || /^C[FGI][A-Z]{3}$/.test(reg) ? reg : ''
  if (!ident || tail.length < 2 || !ident.endsWith(tail)) return 0
  return tail.length >= 3 ? 0.72 : 0.58
}

/** Nudge for whether this aircraft is the kind the station talks to. */
export function roleBonus(kind: StationKind | undefined, a: Candidate, elevationFt = 0): number {
  const agl = a.onGround || a.altitudeFt == null ? 0 : a.altitudeFt - elevationFt
  switch (kind) {
    case 'GND':
    case 'CLD':
      return a.onGround ? 0.06 : -0.2
    case 'APP':
    case 'DEP':
      return a.onGround ? -0.2 : 0.04
    case 'TWR':
      // Tower works the runways and the air close by, not traffic passing high overhead.
      return a.onGround || agl < 4000 ? 0.03 : agl > 9000 ? -0.12 : 0
    default:
      return 0
  }
}

/**
 * The best aircraft for each mention, strongest first, one aircraft per
 * mention and no aircraft twice. A near-tie between two aircraft costs
 * confidence: better to highlight nothing than the wrong one.
 */
export function matchMentions(mentions: CallsignMention[], aircraft: Candidate[], opts: { stationKind?: StationKind; elevationFt?: number } = {}): RadioMatch[] {
  const out: RadioMatch[] = []
  const used = new Set<string>()
  for (const mention of mentions) {
    const scored = aircraft
      .map((a) => {
        const base = fit(mention, a)
        return { a, score: base > 0 ? Math.min(1, base + roleBonus(opts.stationKind, a, opts.elevationFt)) - mention.doubt : 0 }
      })
      .filter((x) => x.score > 0 && !used.has(x.a.icao24))
      .sort((x, y) => y.score - x.score)
    const best = scored[0]
    if (!best) continue
    const runnerUp = scored[1]?.score ?? 0
    const confidence = best.score - (runnerUp > best.score - 0.08 ? 0.2 : 0)
    if (confidence < MIN_CONFIDENCE) continue
    used.add(best.a.icao24)
    out.push({ icao24: best.a.icao24, callsign: best.a.callsign, confidence: Math.round(confidence * 100) / 100, mention })
  }
  return out
}
