/**
 * Which drawing to use for an aircraft: from its ICAO type designator when
 * the feed has one, else from the ADS-B emitter category.
 */
import type { ShapeId } from './shapes'

/** Exact designators, for the common types and the ones a prefix rule would get wrong. */
const EXACT: Record<string, ShapeId> = {}
function put(shape: ShapeId, codes: string) {
  for (const c of codes.split(/\s+/)) if (c) EXACT[c] = shape
}

put('ac-jet', 'A318 A319 A320 A321 A19N A20N A21N B731 B732 B733 B734 B735 B736 B737 B738 B739 B37M B38M B39M B3XM B752 B753 C919 T204')
put('ac-heavy', 'A306 A30B A310 A332 A333 A337 A338 A339 A359 A35K B762 B763 B764 B772 B773 B77L B77W B778 B779 B788 B789 B78X MD11 DC10 L101 IL96 KC10 K35R K35E C135 E3TF E6 E767 KC46')
put('ac-quad', 'A342 A343 A345 A346 A388 B741 B742 B743 B744 B748 B74S B74R BLCF A124 A225 IL76 IL86 C17 C5M B52 VC10 DC8 B703 E3CF')
// Rear-engined jets, regional and older airliners alike, share the T-tail drawing.
put('ac-regional', 'CRJ1 CRJ2 CRJ7 CRJ9 CRJX E135 E145 E45X F28 F70 F100 B712 DC91 DC93 DC94 DC95 MD81 MD82 MD83 MD87 MD88 MD90 TU54')
put('ac-ejet', 'E170 E175 E75L E75S E190 E195 E290 E295 E275 BCS1 BCS3 RJ70 RJ85 RJ1H B461 B462 B463 SU95 A148 AJ27')
put('ac-turboprop', 'DH8A DH8B DH8C DH8D AT42 AT43 AT44 AT45 AT46 AT72 AT73 AT75 AT76 SF34 SB20 JS31 JS32 JS41 D328 E120 B190 BE20 B350 BE30 BE9L BE9T BE99 BE10 F50 F27 AN24 AN26 AN30 AN32 L410 DHC6 DHC7 SH36 SW4 C212 CN35 C295 C130 C30J P3 E110 PAY1 PAY2 PAY3 PAY4 MU2 P180')
put('ac-bizjet', 'C25A C25B C25C C25M C500 C501 C510 C525 C550 C551 C55B C560 C56X C650 C680 C68A C700 C750 CL30 CL35 CL60 GLF2 GLF3 GLF4 GLF5 GLF6 GLEX GL5T GL6T GL7T GL8T G150 G280 GA5C GA6C GA7C GA8C GALX ASTR LJ23 LJ24 LJ25 LJ28 LJ31 LJ35 LJ40 LJ45 LJ55 LJ60 LJ70 LJ75 FA10 FA20 FA50 FA5X FA6X FA7X FA8X F2TH F900 E50P E55P E545 E550 PC24 HA4T BE40 PRM1 H25A H25B H25C HDJT SF50 EA50 WW24 J328 E35L')
put('ac-light', 'C150 C152 C162 C170 C172 C175 C177 C77R C180 C182 C185 C188 C195 C205 C206 C207 C208 C210 T210 P210 C82R P28A P28B P28R P28T P28U PA18 PA20 PA22 PA24 PA28 PA32 P32R P32T PA46 P46T PA38 SR20 SR22 S22T DA20 DV20 DA40 M20P M20T M20J BE33 BE35 BE36 A36 BE23 BE24 BE19 AA1 AA5 RV4 RV6 RV7 RV8 RV9 RV10 RV12 RV14 C42 CH60 TB10 TB20 TB21 DR40 PC12 PC6T TBM7 TBM8 TBM9 KODI M600 G115 GLID ULAC SIRA EVOT')
put('ac-twin-piston', 'BE55 BE58 BE60 BE76 BE95 PA23 PA27 PA30 PA31 PA34 PA44 P68 C303 C310 C320 C335 C340 C402 C404 C414 C421 C425 C441 DA42 DA62 AC6L AEST')
put('ac-heli', 'R22 R44 R66 EC20 EC25 EC30 EC35 EC45 EC55 EC75 EC120 EC130 EC135 EC145 H120 H125 H130 H135 H145 H155 H160 H175 H215 H225 AS32 AS35 AS50 AS55 AS65 AS3B AS5N B06 B06T B105 B204 B205 B206 B212 B222 B230 B407 B412 B427 B429 B430 B505 B525 BK17 S61 S64 S70 S76 S92 H47 H53 H60 H64 UH1 UH1Y AH1 A109 A119 A129 A139 A149 A169 A189 AW09 EXPL MD52 MD60 NH90 CH47 MI8 MI17 KMAX')

/** Families for designators that are not in the table. Order matters: first match wins. */
const PREFIX: [RegExp, ShapeId][] = [
  [/^(B74|A38|A34|IL7|IL8)/, 'ac-quad'],
  [/^(B76|B77|B78|A33|A35|A30)/, 'ac-heavy'],
  [/^(B73|B3.M|A2[01]N|A31[89]|A32)/, 'ac-jet'],
  [/^(CRJ|E14|E13)/, 'ac-regional'],
  [/^(E17|E19|E29|E75|BCS)/, 'ac-ejet'],
  [/^(DH8|AT[4-7]|JS[34]|SF3)/, 'ac-turboprop'],
  [/^(C25|C5[0-9]|C6[0-9]|C7[0-9]|GL[0-9A-Z]|G[2-8]80|LJ|FA[0-9]|F[29]|E5[05])/, 'ac-bizjet'],
  [/^(EC|AS[3-6]|R[246][0-9]?$|B4[0-3]|S7|S9|H[1-2][0-9]{2}$|A1[0-8][0-9]$)/, 'ac-heli'],
  [/^(C1[0-9]{2}$|C2[0-1][0-9]$|P28|PA[1-4]|SR2|DA[24]0|M20|BE3[3-6]|RV)/, 'ac-light'],
]

/** Shape for an ICAO type designator, or null when it is unknown. */
export function shapeForType(type: string | null | undefined): ShapeId | null {
  const t = (type ?? '').trim().toUpperCase()
  if (!t) return null
  const hit = EXACT[t]
  if (hit) return hit
  for (const [re, id] of PREFIX) if (re.test(t)) return id
  return null
}

/** Shape from the ADS-B emitter category (DO-260B set A/B/C), for when the type is unknown. */
export function shapeForCategory(category: string | null | undefined): ShapeId | null {
  switch ((category ?? '').toUpperCase()) {
    case 'A1': // light, under 15,500 lb
    case 'B1': // glider
    case 'B4': // ultralight
    case 'B6': // drone
      return 'ac-light'
    case 'A2': // small, 15,500 to 75,000 lb: business and regional jets
      return 'ac-bizjet'
    case 'A3': // large
    case 'A4': // 757-class wake
      return 'ac-jet'
    case 'A5': // heavy
      return 'ac-heavy'
    case 'A7': // rotorcraft
      return 'ac-heli'
    case 'C1': // emergency surface vehicle
    case 'C2': // service vehicle
    case 'C3':
      return 'ac-vehicle'
    default:
      return null
  }
}

/**
 * The drawing for an aircraft on the map. Ground vehicles and parked aircraft
 * with no known heading get plain markers; otherwise the type decides, then
 * the category, then an airliner (by far the commonest thing at these airports).
 */
export function shapeFor(a: { type?: string | null; category?: string | null; headingKnown?: boolean; onGround?: boolean; speedKt?: number | null }): ShapeId {
  const cat = (a.category ?? '').toUpperCase()
  if (cat.startsWith('C')) return 'ac-vehicle'
  if (a.headingKnown === false && a.onGround && (a.speedKt ?? 0) < 4) return 'ac-dot'
  // A rotorcraft category beats a type code that might be stale or wrong.
  if (cat === 'A7') return 'ac-heli'
  return shapeForType(a.type) ?? shapeForCategory(cat) ?? 'ac-jet'
}
