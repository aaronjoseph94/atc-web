/**
 * Plain-English helpers for people who don't speak aviation.
 *
 * Everything here is pure and deterministic so it works offline and can be
 * unit-tested; it also serves as the fallback when no AI key is configured
 * for `/api/summarize`.
 */
import type { Aircraft } from '../api/types'

// ---------------------------------------------------------------------------
// Flight phase
// ---------------------------------------------------------------------------

export type Phase =
  | 'parked'
  | 'taxiing'
  | 'rolling'
  | 'takeoff'
  | 'climbing'
  | 'descending'
  | 'final'
  | 'cruising'
  | 'level'
  | 'unknown'

type PhaseInput = Pick<Aircraft, 'onGround' | 'speedKt' | 'altitudeFt' | 'verticalRateFpm'>

/** Classify what the aircraft is doing right now from its state vector. */
export function flightPhase(a: PhaseInput): Phase {
  const spd = a.speedKt ?? null
  const alt = a.altitudeFt ?? null
  const vr = a.verticalRateFpm ?? null

  if (a.onGround) {
    if (spd == null) return 'parked'
    if (spd < 5) return 'parked'
    if (spd < 50) return 'taxiing'
    return 'rolling'
  }
  if (alt == null && vr == null) return 'unknown'
  if (vr != null && vr > 300) return alt != null && alt < 3000 ? 'takeoff' : 'climbing'
  if (vr != null && vr < -300) return alt != null && alt < 3000 ? 'final' : 'descending'
  if (alt != null && alt >= 18000) return 'cruising'
  return 'level'
}

/** Short status for chips and labels. */
export const PHASE_LABEL: Record<Phase, string> = {
  parked: 'Parked',
  taxiing: 'Taxiing',
  rolling: 'On the runway',
  takeoff: 'Taking off',
  climbing: 'Climbing',
  descending: 'Descending',
  final: 'Landing soon',
  cruising: 'Cruising',
  level: 'Flying level',
  unknown: 'In the air',
}

/** One friendly sentence describing the phase. */
export const PHASE_SENTENCE: Record<Phase, string> = {
  parked: 'Sitting still on the ground, most likely at a gate or holding position.',
  taxiing: 'Moving slowly along the taxiways between the gate and the runway.',
  rolling: 'Speeding along the runway — taking off or just landed.',
  takeoff: 'Just left the runway and is climbing away from the airport.',
  climbing: 'Gaining altitude on its way out.',
  descending: 'Coming down toward the airport.',
  final: 'Lined up low and slow, about to touch down.',
  cruising: 'High up and flying level — passing through the area.',
  level: 'Flying at a steady altitude.',
  unknown: 'Airborne; no altitude data from this aircraft yet.',
}

// ---------------------------------------------------------------------------
// Direction, altitude, speed in everyday terms
// ---------------------------------------------------------------------------

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']

/** 0–360° → "northwest". */
export function compassDirection(heading: number): string {
  const i = Math.round((((heading % 360) + 360) % 360) / 45) % 8
  return COMPASS[i]
}

/** "4,200 ft (1.3 km)" — altitude with a metric hint. */
export function plainAltitude(ft: number | null | undefined): string {
  if (ft == null) return 'altitude unknown'
  if (ft < 50) return 'on the ground'
  const km = ft * 0.0003048
  return `${Math.round(ft).toLocaleString()} ft (${km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`})`
}

/** "177 kt (204 mph)" — knots with mph for the rest of us. */
export function plainSpeed(kt: number | null | undefined): string {
  if (kt == null) return 'speed unknown'
  return `${Math.round(kt)} kt (${Math.round(kt * 1.15078)} mph)`
}

/** Friendly comparison so altitudes mean something. */
export function altitudeComparison(ft: number | null | undefined): string | null {
  if (ft == null || ft < 50) return null
  if (ft < 1500) return 'about the height of a tall skyscraper'
  if (ft < 5000) return `roughly ${Math.round(ft / 1450)} Empire State Buildings high`
  if (ft < 15000) return 'higher than most mountain peaks in the Rockies'
  if (ft < 30000) return 'above Everest — airliner cruising height'
  return 'well above Everest, near the top of airliner cruise'
}

// ---------------------------------------------------------------------------
// Airlines and aircraft types
// ---------------------------------------------------------------------------

/** ICAO three-letter airline codes → names (the ones common at our 21 airports). */
const AIRLINES: Record<string, string> = {
  UAL: 'United', AAL: 'American', DAL: 'Delta', SWA: 'Southwest', JBU: 'JetBlue', ASA: 'Alaska',
  SKW: 'SkyWest', ENY: 'Envoy', RPA: 'Republic', PDT: 'Piedmont', PSA: 'PSA', JIA: 'PSA', GJS: 'GoJet',
  AWI: 'Air Wisconsin', EDV: 'Endeavor', FFT: 'Frontier', NKS: 'Spirit', AAY: 'Allegiant', SCX: 'Sun Country',
  HAL: 'Hawaiian', MXY: 'Breeze', VXP: 'Avelo', FDX: 'FedEx', UPS: 'UPS', GTI: 'Atlas Air', ABX: 'ABX Air',
  ACA: 'Air Canada', JZA: 'Jazz', ROU: 'Air Canada Rouge', WJA: 'WestJet', WEN: 'WestJet Encore', POE: 'Porter',
  TSC: 'Air Transat', FLE: 'Flair', SWG: 'Sunwing', LYNX: 'Lynx',
  BAW: 'British Airways', VIR: 'Virgin Atlantic', DLH: 'Lufthansa', AFR: 'Air France', KLM: 'KLM',
  SWR: 'Swiss', AUA: 'Austrian', SAS: 'SAS', IBE: 'Iberia', TAP: 'TAP', EIN: 'Aer Lingus', FIN: 'Finnair',
  UAE: 'Emirates', QTR: 'Qatar', ETD: 'Etihad', THY: 'Turkish', ELY: 'El Al',
  JAL: 'Japan Airlines', ANA: 'ANA', KAL: 'Korean Air', AAR: 'Asiana', CPA: 'Cathay Pacific', CCA: 'Air China',
  CES: 'China Eastern', CSN: 'China Southern', EVA: 'EVA Air', CAL: 'China Airlines', SIA: 'Singapore',
  QFA: 'Qantas', ANZ: 'Air New Zealand', AMX: 'Aeroméxico', VOI: 'Volaris', AVA: 'Avianca', CMP: 'Copa',
  LAN: 'LATAM', TAM: 'LATAM', ARG: 'Aerolíneas Argentinas', AZU: 'Azul', GLO: 'GOL',
}

/** Parse `UAL2099` → `{ airline: 'United', flightNumber: '2099' }` (or nulls for private/unknown). */
export function describeCallsign(callsign: string): { airline: string | null; flightNumber: string | null } {
  const m = /^([A-Z]{3})(\d{1,4}[A-Z]?)$/.exec(callsign.trim().toUpperCase())
  if (!m) return { airline: null, flightNumber: null }
  return { airline: AIRLINES[m[1]] ?? null, flightNumber: m[2] }
}

/** "United flight 2099" or just the callsign. */
export function friendlyFlightName(callsign: string): string {
  const { airline, flightNumber } = describeCallsign(callsign)
  return airline && flightNumber ? `${airline} flight ${flightNumber}` : callsign
}

/** ICAO type designators → marketing names. */
const TYPES: Record<string, string> = {
  B737: 'Boeing 737-700', B738: 'Boeing 737-800', B739: 'Boeing 737-900', B37M: 'Boeing 737 MAX 7',
  B38M: 'Boeing 737 MAX 8', B39M: 'Boeing 737 MAX 9', B752: 'Boeing 757-200', B753: 'Boeing 757-300',
  B763: 'Boeing 767-300', B764: 'Boeing 767-400', B772: 'Boeing 777-200', B77L: 'Boeing 777-200LR',
  B77W: 'Boeing 777-300ER', B788: 'Boeing 787-8', B789: 'Boeing 787-9', B78X: 'Boeing 787-10',
  B744: 'Boeing 747-400', B748: 'Boeing 747-8', MD11: 'MD-11',
  A319: 'Airbus A319', A320: 'Airbus A320', A321: 'Airbus A321', A19N: 'Airbus A319neo',
  A20N: 'Airbus A320neo', A21N: 'Airbus A321neo', A332: 'Airbus A330-200', A333: 'Airbus A330-300',
  A339: 'Airbus A330-900neo', A343: 'Airbus A340-300', A359: 'Airbus A350-900', A35K: 'Airbus A350-1000',
  A388: 'Airbus A380', A306: 'Airbus A300-600', A310: 'Airbus A310',
  E170: 'Embraer E170', E175: 'Embraer E175', E190: 'Embraer E190', E195: 'Embraer E195', E75L: 'Embraer E175',
  E75S: 'Embraer E175', E290: 'Embraer E190-E2', E295: 'Embraer E195-E2', E145: 'Embraer ERJ-145',
  CRJ2: 'Bombardier CRJ200', CRJ7: 'Bombardier CRJ700', CRJ9: 'Bombardier CRJ900', CRJX: 'Bombardier CRJ1000',
  BCS1: 'Airbus A220-100', BCS3: 'Airbus A220-300', DH8D: 'Dash 8 Q400', DH8A: 'Dash 8-100', AT76: 'ATR 72',
  C172: 'Cessna 172', C208: 'Cessna Caravan', C25A: 'Cessna Citation', C56X: 'Cessna Citation XLS',
  C68A: 'Cessna Citation Latitude', C700: 'Cessna Citation Longitude', CL35: 'Challenger 350',
  CL60: 'Challenger 600', GLF4: 'Gulfstream IV', GLF5: 'Gulfstream V', GLF6: 'Gulfstream G650',
  GL7T: 'Global 7500', GLEX: 'Global Express', E55P: 'Phenom 300', E50P: 'Phenom 100', LJ45: 'Learjet 45',
  PC12: 'Pilatus PC-12', H60: 'Black Hawk helicopter', EC35: 'Airbus H135 helicopter', B06: 'Bell 206 helicopter',
}

/** Marketing name for an ICAO type code, or the code itself when unknown. */
export function aircraftTypeName(code: string | null | undefined): string | null {
  if (!code) return null
  return TYPES[code.toUpperCase()] ?? code.toUpperCase()
}

// ---------------------------------------------------------------------------
// Radio phraseology → everyday English (deterministic fallback for the AI)
// ---------------------------------------------------------------------------

const NUM_WORDS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8',
  nine: '9', niner: '9',
}

const TENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
}

/**
 * Convert spoken numbers into digits and leave other words alone:
 * "two eight right" → "28R", "one two five point zero" → "125.0",
 * "two thousand five hundred" → "2500", "flight level two three zero" → "flight level 230".
 */
export function digitsFromWords(s: string): string {
  const out: string[] = []
  // Punctuation would otherwise glue itself to a number word ("eight," ≠ "eight").
  const words = s.toLowerCase().replace(/[,;:!?]/g, ' ').replace(/\.(?=\s|$)/g, ' ').split(/\s+/).filter(Boolean)
  let buf = ''
  for (const w of words) {
    const d = NUM_WORDS[w]
    if (d != null) {
      buf += d
      continue
    }
    // "two thousand", "five hundred": scale the digits just read.
    if ((w === 'thousand' || w === 'hundred') && buf) {
      out.push(String(Number(buf) * (w === 'thousand' ? 1000 : 100)))
      buf = ''
      continue
    }
    if (buf) {
      out.push(buf)
      buf = ''
    }
    if (w === 'point' || w === 'decimal') out.push('.')
    else if (TENS[w] != null) out.push(String(TENS[w]))
    else out.push(w)
  }
  if (buf) out.push(buf)
  return out
    .join(' ')
    // "2000 500" → "2500"
    .replace(/\b(\d+000) (\d00)\b/g, (_, a: string, b: string) => String(Number(a) + Number(b)))
    // Runway suffixes and decimal points: "28 right" → "28R", "126 . 47" → "126.47"
    .replace(/(\d+) (left|right|center|centre)\b/g, (_, n: string, side: string) => `${n}${side[0].toUpperCase()}`)
    .replace(/(\d+) \. (\d+)/g, '$1.$2')
}

type Rule = { re: RegExp; say: (m: RegExpMatchArray) => string }

/**
 * Runway designator mentioned anywhere in the (already normalized) call:
 * "runway 28R", "runway 9", or a bare "28R" in a clipped readback.
 */
function runwayIn(m: RegExpMatchArray): string | undefined {
  const text = m.input ?? ''
  return (/runway (\d{1,2}[LRC]?)\b/.exec(text) ?? /\b(\d{1,2}[LRC])\b/.exec(text))?.[1]
}

const RULES: Rule[] = [
  {
    re: /cleared for take ?off/,
    say: (m) => (runwayIn(m) ? `Cleared to take off from runway ${runwayIn(m)}.` : 'Cleared to take off.'),
  },
  {
    re: /cleared to land/,
    say: (m) => (runwayIn(m) ? `Cleared to land on runway ${runwayIn(m)}.` : 'Cleared to land.'),
  },
  {
    re: /line up and wait/,
    say: (m) => `Move onto ${runwayIn(m) ? `runway ${runwayIn(m)}` : 'the runway'} and wait there for takeoff clearance.`,
  },
  { re: /hold short(?: of)?(?: runway)? (\d+[LRC]?)/, say: (m) => `Stop and wait before runway ${m[1]}; do not enter it.` },
  { re: /go(?:ing)? around/, say: () => 'Abort the landing and climb away for another attempt.' },
  { re: /continue\b/, say: () => 'Keep flying the approach; landing clearance will follow.' },
  { re: /caution wake turbulence/, say: () => 'Watch out for rough air left behind by the larger aircraft ahead.' },
  { re: /contact (?:\w+ )?(departure|tower|ground|approach|center|centre)(?: on)? ([\d.]+)/, say: (m) => `Switch your radio to ${cap(m[1])} on ${m[2]}.` },
  { re: /monitor (tower|ground|departure|approach)(?: on)? ([\d.]+)/, say: (m) => `Tune to ${cap(m[1])} on ${m[2]} and listen.` },
  { re: /turn (left|right) heading (\d{1,3})/, say: (m) => `Turn ${m[1]} to point ${m[2]}° (${compassDirection(Number(m[2]))}).` },
  { re: /fly heading (\d{1,3})/, say: (m) => `Fly toward ${m[1]}° (${compassDirection(Number(m[1]))}).` },
  { re: /climb and maintain (?:flight level )?(\d+)/, say: (m) => `Climb to ${fmtAlt(m[1])}.` },
  { re: /descend and maintain (?:flight level )?(\d+)/, say: (m) => `Descend to ${fmtAlt(m[1])}.` },
  { re: /maintain (?:flight level )?(\d{3,5})/, say: (m) => `Stay at ${fmtAlt(m[1])}.` },
  { re: /taxi (?:to|via) (.+)/, say: (m) => `Drive along the taxiways to ${m[1].replace(/ via /, ' using ')}.` },
  { re: /cross runway (\d+[LRC]?)/, say: (m) => `Cleared to cross runway ${m[1]}.` },
  { re: /reduce speed(?: to)? (\d+)/, say: (m) => `Slow down to ${m[1]} knots.` },
  { re: /traffic (.+)/, say: (m) => `Heads-up about nearby traffic: ${m[1]}.` },
  { re: /wind (\d{3}) at (\d+)/, say: (m) => `Wind from ${m[1]}° at ${m[2]} knots.` },
  { re: /radar contact/, say: () => 'The controller now sees this aircraft on radar.' },
  { re: /push ?back approved/, say: () => 'Allowed to push back from the gate.' },
  { re: /squawk (\d{4})/, say: (m) => `Set transponder code ${m[1]} so radar can identify you.` },
]

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function fmtAlt(n: string) {
  const v = Number(n)
  // Three-digit values are flight levels (hundreds of feet).
  return v < 1000 ? `${(v * 100).toLocaleString()} ft` : `${v.toLocaleString()} ft`
}

export type Transmission = { speaker?: string; text: string }

/**
 * Translate a radio call into one plain sentence. Returns `null` when no
 * rule matched so callers can fall back to showing the raw text.
 */
export function explainTransmission(t: Transmission): string | null {
  const norm = digitsFromWords(t.text).replace(/[^\w.\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const who = /pilot|aircraft/i.test(t.speaker ?? '') ? 'pilot' : /tower|ground|approach|departure|controller|atc/i.test(t.speaker ?? '') ? 'controller' : null

  for (const r of RULES) {
    const m = norm.match(r.re)
    if (!m) continue
    const s = r.say(m)
    if (who === 'pilot') return `The pilot reads back: ${lowerFirst(s)}`
    if (who === 'controller') return `The controller says: ${lowerFirst(s)}`
    return s
  }
  return null
}

function lowerFirst(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

/**
 * Summarize the most recent exchange for a flight without any AI: the last
 * controller instruction (explained) plus whether the pilot acknowledged.
 */
export function summarizeExchange(transmissions: Transmission[]): string {
  const recent = transmissions.slice(-6)
  const lastCtrl = [...recent].reverse().find((t) => !/pilot|aircraft/i.test(t.speaker ?? ''))
  const lastPilot = [...recent].reverse().find((t) => /pilot|aircraft/i.test(t.speaker ?? ''))
  const latest = recent[recent.length - 1]
  if (!latest) return 'No radio traffic for this flight yet.'

  const core = lastCtrl ? explainTransmission({ text: lastCtrl.text }) : null
  if (core) {
    const ack = lastPilot && recent.indexOf(lastPilot) > recent.indexOf(lastCtrl!) ? ' The pilot has confirmed.' : ''
    return `${core}${ack}`
  }
  return explainTransmission(latest) ?? `Latest call: “${latest.text}”`
}
