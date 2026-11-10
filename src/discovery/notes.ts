/**
 * Words for a sighting without AI: the type's everyday name, one line on why
 * it is worth a look, and which way it is going. The AI task
 * `explainSighting` may replace the line; this is what shows when it can't.
 */
import { typeFacts } from '../aircraft/types'
import type { Aircraft } from '../api/types'
import { aircraftTypeName, flightPhase } from '../flight/describe'
import type { Rarity } from './rarity'

/** Names for rare types that the facts table doesn't carry (no drawing for them yet, or out of its sanity bounds). */
const NAMES: Record<string, string> = {
  A225: 'Antonov An-225 Mriya',
  A3ST: 'Airbus Beluga',
  B52: 'Boeing B-52 Stratofortress',
  B721: 'Boeing 727-100',
  B722: 'Boeing 727-200',
  DC3: 'Douglas DC-3',
  C47: 'Douglas C-47 Skytrain',
  P8: 'Boeing P-8 Poseidon',
  E3CF: 'Boeing E-3 Sentry',
  A342: 'Airbus A340-200',
  A345: 'Airbus A340-500',
  KC10: 'McDonnell Douglas KC-10 Extender',
  A400: 'Airbus A400M Atlas',
  V22: 'Bell Boeing V-22 Osprey',
  F15: 'Boeing F-15 Eagle',
  F16: 'General Dynamics F-16',
  F22: 'Lockheed Martin F-22 Raptor',
  F35: 'Lockheed Martin F-35',
  B1: 'Rockwell B-1 Lancer',
  B2: 'Northrop B-2 Spirit',
  H60: 'Sikorsky UH-60 Black Hawk',
}

/** Why each rare type is worth a look: plain, well-established facts only. */
const NOTES: Record<string, string> = {
  A124: 'One of the largest cargo aircraft flying; it carries loads too big for any regular freighter.',
  A225: 'The only An-225 ever finished was destroyed in 2022, so this is almost certainly a data error.',
  BLCF: 'One of four modified 747s that ferry 787 parts between Boeing factories.',
  A3ST: 'Airbus’s original Beluga, built to carry aircraft sections between its factories.',
  A337: 'Airbus’s BelugaXL, built to carry A350 wings between factories; it rarely leaves Europe.',
  A388: 'The world’s largest passenger airliner; production ended in 2021.',
  B748: 'The last and longest 747; production ended in 2023.',
  B744: 'A 747-400: few still carry passengers, most fly cargo now.',
  B742: 'A 1970s-era 747; only a handful are still flying.',
  B741: 'One of the very first 747 models; almost all are retired.',
  MD11: 'One of the last trijets flying, now almost only as a freighter.',
  DC10: 'A 1970s trijet; the last few fly as freighters or firefighting tankers.',
  B721: 'A 1960s trijet; almost all have been retired.',
  B722: 'A 1960s trijet; almost all have been retired.',
  A342: 'A four-engined A340; airlines have retired most of them.',
  A343: 'A four-engined A340; airlines have retired most of them.',
  A345: 'A four-engined A340; airlines have retired most of them.',
  A346: 'A four-engined A340; airlines have retired most of them.',
  A306: 'Mostly flown as a freighter today.',
  IL76: 'A Soviet-designed heavy freighter, rarely seen in North America.',
  C17: 'A strategic military airlifter that can land heavy loads on short runways.',
  C5M: 'The largest US military aircraft; it can carry two battle tanks.',
  C5: 'The largest US military aircraft; it can carry two battle tanks.',
  K35R: 'A 1950s-era air-refuelling tanker, still a mainstay of the US Air Force.',
  KC46: 'The US Air Force’s newest air-refuelling tanker, based on the 767.',
  KC10: 'A tanker version of the DC-10, retired by the US Air Force in 2024.',
  B52: 'A long-range bomber that first flew in 1952 and is still in service.',
  C130: 'A military turboprop transport, unusual at a big commercial airport.',
  C30J: 'A military turboprop transport, unusual at a big commercial airport.',
  E3TF: 'An airborne radar aircraft, known for the big rotating dome on its back.',
  E3CF: 'An airborne radar aircraft, known for the big rotating dome on its back.',
  P8: 'A Navy patrol aircraft based on the 737.',
  DC3: 'An airliner design from the 1930s; the survivors are flown by a few operators and enthusiasts.',
  C47: 'A Second World War transport; the survivors are flown by enthusiasts.',
}

/** "Antonov An-124 Ruslan", "Boeing 747-8", or the bare code. */
export function spotName(type: string | null | undefined): string {
  const t = (type ?? '').trim().toUpperCase()
  if (!t) return 'Unknown type'
  const f = typeFacts(t)
  if (f) return `${f.manufacturer} ${f.name}`
  return NAMES[t] ?? aircraftTypeName(t) ?? t
}

/** One deterministic line on why this sighting is notable. */
export function fallbackLine(type: string | null | undefined, rarity: Pick<Rarity, 'military' | 'reasons'>): string {
  const t = (type ?? '').trim().toUpperCase()
  if (NOTES[t]) return NOTES[t]
  const m = rarity.military
  if (m?.vip) return `A government VIP flight${m.operator ? ` (${m.operator})` : ''}.`
  if (m) return `A military flight${m.operator ? ` (${m.operator})` : ''}.`
  const f = typeFacts(t)
  if (f) return `${f.kind}${f.firstFlight ? ` first flown in ${f.firstFlight}` : ''}, ${(rarity.reasons.find((r) => r.kind === 'type' || r.kind === 'category')?.label ?? 'unusual here').toLowerCase()}.`
  const lead = rarity.reasons.find((r) => r.points > 0)
  return lead ? `${lead.label}.` : 'Unusual here.'
}

export type Direction = 'inbound' | 'departing' | 'ground' | 'nearby'

/** Which way it's going, roughly: from its vertical rate and height above the field. */
export function spotDirection(a: Pick<Aircraft, 'onGround' | 'speedKt' | 'altitudeFt' | 'verticalRateFpm'>, elevationFt: number): Direction {
  if (a.onGround) return 'ground'
  const phase = flightPhase({ ...a, altitudeFt: a.altitudeFt == null ? null : a.altitudeFt - elevationFt })
  if (phase === 'final' || phase === 'descending') return 'inbound'
  if (phase === 'takeoff' || phase === 'climbing') return 'departing'
  return 'nearby'
}

/** "inbound to ORD", "departing ORD", "on the ground at ORD", "near ORD". */
export function directionText(d: Direction, airport: string): string {
  return d === 'inbound' ? `inbound to ${airport}` : d === 'departing' ? `departing ${airport}` : d === 'ground' ? `on the ground at ${airport}` : `near ${airport}`
}
