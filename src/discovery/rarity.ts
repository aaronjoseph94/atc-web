/**
 * How unusual an aircraft is at this airport, as a number and the reasons
 * behind it. Deterministic: built-in tables of how often each type turns up
 * at a kind of airport, plus what this session has already seen.
 *
 * Score bands: under 40 is ordinary, 40+ is "notable" (listed under Spotted),
 * 60+ is "rare" (a star on the tag and, at most now and then, a toast).
 *
 * Private aircraft are judged by their type only. Nothing here looks up or
 * guesses who owns or flies one, and business jets are never singled out.
 */
import type { Aircraft } from '../api/types'
import { shapeForType } from '../aircraft/classify'
import { typeFacts } from '../aircraft/types'
import { parseCallsign } from '../airline/airlines'
import { militaryInfo, type MilitaryInfo } from './military'

export const NOTABLE_SCORE = 40
export const RARE_SCORE = 60

/**
 * The kind of airport, for how often a type turns up there.
 * `gateway`: long-haul hub with wide-bodies all day. `hub`: mostly
 * narrow-body, a few long-haul flights. `slot`: short-haul only (LaGuardia's
 * perimeter rule keeps wide-bodies away).
 */
export type AirportClass = 'gateway' | 'hub' | 'slot'

const GATEWAYS = new Set('JFK LAX SFO ORD MIA IAH DFW ATL EWR SEA YYZ YVR YUL DEN'.split(' '))
const SLOT = new Set(['LGA'])

export function airportClass(code: string): AirportClass {
  const c = code.toUpperCase()
  return GATEWAYS.has(c) ? 'gateway' : SLOT.has(c) ? 'slot' : 'hub'
}

export type Tier = 'common' | 'regular' | 'occasional' | 'uncommon' | 'rare' | 'very-rare'

export const TIER_SCORE: Record<Tier, number> = { common: 0, regular: 10, occasional: 25, uncommon: 35, rare: 60, 'very-rare': 85 }

const TIER_LABEL: Record<Tier, string> = {
  common: 'Common here',
  regular: 'Seen most days here',
  occasional: 'Occasional here',
  uncommon: 'Uncommon here',
  rare: 'Rare here',
  'very-rare': 'Very rare anywhere',
}

/** [gateway, hub, slot] tiers for the types that stand out somewhere. */
const TYPE_TIERS: Record<string, [Tier, Tier, Tier]> = {}
function tiers(codes: string, t: [Tier, Tier, Tier]) {
  for (const c of codes.split(/\s+/)) if (c) TYPE_TIERS[c] = t
}
// Outsize freighters: a handful exist.
tiers('A225 BLCF A3ST A337 AN22 C5 C5M', ['very-rare', 'very-rare', 'very-rare'])
tiers('A124', ['rare', 'very-rare', 'very-rare'])
// The big passenger and cargo four-engined jets.
tiers('A388', ['uncommon', 'rare', 'very-rare'])
tiers('B748 B744', ['uncommon', 'rare', 'very-rare'])
tiers('B741 B742 B743 B74S B74R IL96 IL86', ['rare', 'very-rare', 'very-rare'])
tiers('A342 A343 A345 A346', ['uncommon', 'rare', 'very-rare'])
tiers('IL76 AN12 AN26 AN72', ['rare', 'very-rare', 'very-rare'])
// Trijets and other classics still flying, mostly as freighters.
tiers('MD11', ['occasional', 'uncommon', 'very-rare'])
tiers('DC10 L101 B721 B722 B731 B732 DC8 DC87 B703 VC10 TU54', ['rare', 'rare', 'very-rare'])
tiers('A306 A30B A310 B762', ['occasional', 'uncommon', 'rare'])
// Historic aircraft and warbirds.
tiers('DC3 C47 DC6 DC4 B17 B25 B29 P51 SPIT T6 CONI CONC', ['rare', 'rare', 'rare'])
// Military types at a civil airport.
tiers('C17 K35R K35E KC10 KC46 KC30 A400 C130 C30J E3TF E3CF E6 E737 P8 P3 C2 E2 V22 R135 RC35', ['rare', 'rare', 'rare'])
tiers('B52 B1 B2 U2 F15 F16 F18H F18S F22 F35 A10 T38', ['very-rare', 'very-rare', 'very-rare'])

/** Wide-bodies not listed above (777s, 787s, A330s, A350s): everyday at a gateway, less so elsewhere. */
const WIDEBODY_TIERS: [Tier, Tier, Tier] = ['regular', 'occasional', 'rare']

/** Cargo airlines, whose wide-bodies stand out at a passenger-only field. */
const CARGO_OPERATORS = new Set('FDX UPS GTI ABX ATN CKS CLX PAC BOX CJT AJT GEC CAO CKK ABW SOO WGN NCR DHK BCS MPH ICV KZR'.split(' '))

/** ADS-B emitter categories that are unusual by nature. */
const CATEGORY_TIERS: Record<string, [Tier, string]> = {
  A6: ['uncommon', 'High-performance aircraft'],
  B1: ['rare', 'Glider'],
  B2: ['rare', 'Balloon or airship'],
  B4: ['rare', 'Ultralight'],
  B6: ['rare', 'Drone'],
  B7: ['very-rare', 'Space vehicle'],
}

export type ReasonKind = 'type' | 'category' | 'military' | 'vip' | 'freighter' | 'classic' | 'first-seen' | 'seen-often'

export type Reason = { kind: ReasonKind; label: string; points: number }

export type Rarity = {
  score: number
  tier: Tier
  reasons: Reason[]
  military: MilitaryInfo | null
  notable: boolean
  rare: boolean
}

export type RarityInput = Pick<Aircraft, 'icao24' | 'callsign' | 'type' | 'registration' | 'category'>

/** Type designator the tables understand (upper case, no placeholder). */
export function normType(type: string | null | undefined): string | null {
  const t = (type ?? '').trim().toUpperCase()
  return t && t !== 'ZZZZ' ? t : null
}

function classIndex(c: AirportClass): 0 | 1 | 2 {
  return c === 'gateway' ? 0 : c === 'hub' ? 1 : 2
}

/** The base tier for a type at a kind of airport, before any bonus. */
export function typeTier(type: string | null, cls: AirportClass): Tier {
  if (!type) return 'common'
  const row = TYPE_TIERS[type]
  if (row) return row[classIndex(cls)]
  const shape = shapeForType(type)
  if (shape === 'ac-heavy' || shape === 'ac-quad') return WIDEBODY_TIERS[classIndex(cls)]
  return 'common'
}

/**
 * Score one aircraft. `seenCount` is how many other airframes of the same
 * type this session has already met at this airport (0 = first one).
 */
export function scoreRarity(a: RarityInput, airport: string, seenCount: number): Rarity {
  const cls = airportClass(airport)
  const type = normType(a.type)
  const reasons: Reason[] = []
  const add = (kind: ReasonKind, label: string, points: number) => {
    if (points !== 0) reasons.push({ kind, label, points })
  }

  let tier = typeTier(type, cls)
  add('type', TIER_LABEL[tier], TIER_SCORE[tier])

  const cat = (a.category ?? '').toUpperCase()
  const catRow = CATEGORY_TIERS[cat]
  if (catRow && TIER_SCORE[catRow[0]] > TIER_SCORE[tier]) {
    // The category says more than the type (gliders and balloons often have none).
    reasons.length = 0
    tier = catRow[0]
    add('category', catRow[1], TIER_SCORE[tier])
  }

  const military = militaryInfo(a)
  if (military) {
    add('military', military.operator ? `Military: ${military.operator}` : 'Military aircraft', 25)
    if (military.vip) add('vip', 'Government VIP flight', 30)
  }

  const facts = typeFacts(type)
  const shape = type ? shapeForType(type) : null
  const big = shape === 'ac-heavy' || shape === 'ac-quad'
  if (facts?.firstFlight && facts.firstFlight <= 1975 && (facts.engines.type === 'turbofan' || (facts.spanM ?? 0) >= 25)) {
    add('classic', `Classic: first flew in ${facts.firstFlight}`, 15)
  }

  const op = parseCallsign(a.callsign)?.prefix
  if (big && op && CARGO_OPERATORS.has(op) && cls !== 'gateway') {
    add('freighter', cls === 'slot' ? 'Wide-body freighter at a passenger-only airport' : 'Wide-body freighter', cls === 'slot' ? 30 : 10)
  }

  // Only worth saying for a type that is at least a little unusual: every A320 is "new" once.
  if (TIER_SCORE[tier] >= TIER_SCORE.occasional || military) {
    if (seenCount === 0) add('first-seen', 'First this session', 8)
    else if (seenCount >= 3) add('seen-often', `${seenCount + 1} seen this session`, -Math.min(20, 5 * (seenCount - 2)))
  }

  const score = Math.max(0, Math.min(100, reasons.reduce((n, r) => n + r.points, 0)))
  return { score, tier, reasons, military, notable: score >= NOTABLE_SCORE, rare: score >= RARE_SCORE }
}
