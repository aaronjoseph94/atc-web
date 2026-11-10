/**
 * Which airline a callsign belongs to, and whose logo it should wear.
 *
 * An airline callsign is the operator's three-letter ICAO code followed by a
 * flight number that starts with a digit (`DAL227`, `ETD8NY`). Private and
 * GA aircraft call themselves by registration (`N1818C`, `CGENW`) and get no
 * airline.
 *
 * Regional airlines mostly fly under a mainline brand (an Endeavor jet is a
 * Delta Connection flight, painted and sold as Delta), and the reference app
 * shows the mainline logo on them, so `brandFor` resolves the operator to the
 * brand. Two regionals fly for several brands at once; for those the flight
 * number range tells them apart.
 *
 * `scripts/fetch-airline-logos.py` reads the IATA codes in `AIRLINES` (one
 * entry per line, as below) to fetch logos it can't find by ICAO code.
 */

export type AirlineInfo = { icao: string; iata: string | null; name: string }

/** ICAO code → [IATA code, everyday name]. The airlines seen at the airports the app covers. */
const AIRLINES: Record<string, [string, string]> = {
  // United States: mainline and low-cost
  AAL: ['AA', 'American'],
  DAL: ['DL', 'Delta'],
  UAL: ['UA', 'United'],
  SWA: ['WN', 'Southwest'],
  JBU: ['B6', 'JetBlue'],
  ASA: ['AS', 'Alaska'],
  HAL: ['HA', 'Hawaiian'],
  NKS: ['NK', 'Spirit'],
  FFT: ['F9', 'Frontier'],
  AAY: ['G4', 'Allegiant'],
  SCX: ['SY', 'Sun Country'],
  MXY: ['MX', 'Breeze'],
  VXP: ['XP', 'Avelo'],
  // United States: regional
  SKW: ['OO', 'SkyWest'],
  RPA: ['YX', 'Republic'],
  ENY: ['MQ', 'Envoy'],
  PDT: ['PT', 'Piedmont'],
  JIA: ['OH', 'PSA'],
  EDV: ['9E', 'Endeavor'],
  GJS: ['G7', 'GoJet'],
  ASH: ['YV', 'Mesa'],
  UCA: ['C5', 'CommuteAir'],
  QXE: ['QX', 'Horizon'],
  AWI: ['ZW', 'Air Wisconsin'],
  CPZ: ['CP', 'Compass'],
  KAP: ['9K', 'Cape Air'],
  // Cargo
  FDX: ['FX', 'FedEx'],
  UPS: ['5X', 'UPS'],
  GTI: ['5Y', 'Atlas Air'],
  ABX: ['GB', 'ABX Air'],
  ATN: ['8C', 'ATI'],
  CKS: ['K4', 'Kalitta Air'],
  CLX: ['CV', 'Cargolux'],
  AJT: ['M6', 'Amerijet'],
  PAC: ['PO', 'Polar Air Cargo'],
  BOX: ['3S', 'AeroLogic'],
  CJT: ['W8', 'Cargojet'],
  // Canada
  ACA: ['AC', 'Air Canada'],
  JZA: ['QK', 'Jazz'],
  ROU: ['RV', 'Air Canada Rouge'],
  WJA: ['WS', 'WestJet'],
  WEN: ['WR', 'WestJet Encore'],
  POE: ['PD', 'Porter'],
  TSC: ['TS', 'Air Transat'],
  FLE: ['F8', 'Flair'],
  SWG: ['WG', 'Sunwing'],
  PVL: ['PB', 'PAL Airlines'],
  // Mexico, Caribbean, Latin America
  AMX: ['AM', 'Aeroméxico'],
  SLI: ['5D', 'Aeroméxico Connect'],
  VOI: ['Y4', 'Volaris'],
  VIV: ['VB', 'Viva Aerobus'],
  AVA: ['AV', 'Avianca'],
  CMP: ['CM', 'Copa'],
  LAN: ['LA', 'LATAM'],
  TAM: ['JJ', 'LATAM Brasil'],
  LPE: ['LP', 'LATAM Peru'],
  ARG: ['AR', 'Aerolíneas Argentinas'],
  AZU: ['AD', 'Azul'],
  GLO: ['G3', 'GOL'],
  BWA: ['BW', 'Caribbean Airlines'],
  // Europe
  BAW: ['BA', 'British Airways'],
  CFE: ['CJ', 'BA CityFlyer'],
  EFW: ['', 'BA Euroflyer'],
  SHT: ['', 'British Airways Shuttle'],
  VIR: ['VS', 'Virgin Atlantic'],
  EZY: ['U2', 'easyJet'],
  EJU: ['EC', 'easyJet Europe'],
  RYR: ['FR', 'Ryanair'],
  DLH: ['LH', 'Lufthansa'],
  CLH: ['CL', 'Lufthansa CityLine'],
  EWG: ['EW', 'Eurowings'],
  CFG: ['DE', 'Condor'],
  AFR: ['AF', 'Air France'],
  HOP: ['A5', 'Air France Hop'],
  KLM: ['KL', 'KLM'],
  KLC: ['WA', 'KLM Cityhopper'],
  TRA: ['HV', 'Transavia'],
  TVF: ['TO', 'Transavia France'],
  SWR: ['LX', 'Swiss'],
  EDW: ['WK', 'Edelweiss'],
  AUA: ['OS', 'Austrian'],
  BEL: ['SN', 'Brussels Airlines'],
  SAS: ['SK', 'SAS'],
  NAX: ['DY', 'Norwegian'],
  NOZ: ['D8', 'Norwegian'],
  FIN: ['AY', 'Finnair'],
  ICE: ['FI', 'Icelandair'],
  IBE: ['IB', 'Iberia'],
  IBS: ['I2', 'Iberia Express'],
  ANE: ['YW', 'Air Nostrum'],
  VLG: ['VY', 'Vueling'],
  AEA: ['UX', 'Air Europa'],
  TAP: ['TP', 'TAP Air Portugal'],
  EIN: ['EI', 'Aer Lingus'],
  ITY: ['AZ', 'ITA Airways'],
  LOT: ['LO', 'LOT'],
  CSA: ['OK', 'Czech Airlines'],
  LGL: ['LG', 'Luxair'],
  AEE: ['A3', 'Aegean'],
  TOM: ['BY', 'TUI'],
  EXS: ['LS', 'Jet2'],
  WZZ: ['W6', 'Wizz Air'],
  THY: ['TK', 'Turkish Airlines'],
  PGT: ['PC', 'Pegasus'],
  ELY: ['LY', 'El Al'],
  // Middle East and Africa
  UAE: ['EK', 'Emirates'],
  QTR: ['QR', 'Qatar Airways'],
  ETD: ['EY', 'Etihad'],
  SVA: ['SV', 'Saudia'],
  GFA: ['GF', 'Gulf Air'],
  OMA: ['WY', 'Oman Air'],
  RJA: ['RJ', 'Royal Jordanian'],
  MEA: ['ME', 'Middle East Airlines'],
  KAC: ['KU', 'Kuwait Airways'],
  FDB: ['FZ', 'flydubai'],
  ABY: ['G9', 'Air Arabia'],
  MSR: ['MS', 'EgyptAir'],
  RAM: ['AT', 'Royal Air Maroc'],
  ETH: ['ET', 'Ethiopian'],
  KQA: ['KQ', 'Kenya Airways'],
  SAA: ['SA', 'South African'],
  // Asia and the Pacific
  JAL: ['JL', 'Japan Airlines'],
  ANA: ['NH', 'ANA'],
  KAL: ['KE', 'Korean Air'],
  AAR: ['OZ', 'Asiana'],
  CPA: ['CX', 'Cathay Pacific'],
  HKE: ['UO', 'HK Express'],
  CCA: ['CA', 'Air China'],
  CES: ['MU', 'China Eastern'],
  CSN: ['CZ', 'China Southern'],
  CHH: ['HU', 'Hainan Airlines'],
  CXA: ['MF', 'XiamenAir'],
  EVA: ['BR', 'EVA Air'],
  CAL: ['CI', 'China Airlines'],
  SJX: ['JX', 'Starlux'],
  SIA: ['SQ', 'Singapore Airlines'],
  TGW: ['TR', 'Scoot'],
  MAS: ['MH', 'Malaysia Airlines'],
  THA: ['TG', 'Thai'],
  HVN: ['VN', 'Vietnam Airlines'],
  VJC: ['VJ', 'VietJet'],
  PAL: ['PR', 'Philippine Airlines'],
  CEB: ['5J', 'Cebu Pacific'],
  GIA: ['GA', 'Garuda Indonesia'],
  AIC: ['AI', 'Air India'],
  IGO: ['6E', 'IndiGo'],
  QFA: ['QF', 'Qantas'],
  ANZ: ['NZ', 'Air New Zealand'],
  VOZ: ['VA', 'Virgin Australia'],
  JST: ['JQ', 'Jetstar'],
  FJI: ['FJ', 'Fiji Airways'],
}

/**
 * Operators that fly under someone else's brand. A function picks the brand
 * from the flight number for operators that fly for several; it returns null
 * when the number doesn't say, and the operator's own logo is used.
 */
const FLIES_FOR: Record<string, string | ((n: number) => string | null)> = {
  EDV: 'DAL',
  CPZ: 'DAL',
  ENY: 'AAL',
  PDT: 'AAL',
  JIA: 'AAL',
  ASH: 'UAL',
  GJS: 'UAL',
  UCA: 'UAL',
  QXE: 'ASA',
  JZA: 'ACA',
  WEN: 'WJA',
  SLI: 'AMX',
  CFE: 'BAW',
  EFW: 'BAW',
  SHT: 'BAW',
  CLH: 'DLH',
  HOP: 'AFR',
  KLC: 'KLM',
  ANE: 'IBE',
  NOZ: 'NAX',
  // Republic: American Eagle flights are numbered 4xxx, Delta Connection 5xxx, United Express 3xxx.
  RPA: (n) => (n >= 5000 && n < 6000 ? 'DAL' : n >= 4000 && n < 5000 ? 'AAL' : n >= 3000 && n < 4000 ? 'UAL' : null),
  // SkyWest: United Express 5xxx-6xxx, Delta Connection 3500-4999; its American and Alaska flights overlap the 3xxx range.
  SKW: (n) => (n >= 5000 && n < 7000 ? 'UAL' : n >= 3500 && n < 5000 ? 'DAL' : null),
}

/** `DAL227` → `{ prefix: 'DAL', number: 227 }`; null for registrations and anything else. */
export function parseCallsign(callsign: string | null | undefined): { prefix: string; number: number | null } | null {
  const m = /^([A-Z]{3})(\d[A-Z0-9]{0,4})$/.exec((callsign ?? '').trim().toUpperCase())
  if (!m) return null
  const digits = /^\d+/.exec(m[2])
  return { prefix: m[1], number: digits ? Number(digits[0]) : null }
}

/** Everyday name and IATA code for an ICAO airline code, when it's one we know. */
export function airlineInfo(icao: string | null | undefined): AirlineInfo | null {
  const row = icao ? AIRLINES[icao.toUpperCase()] : undefined
  return row ? { icao: icao!.toUpperCase(), iata: row[0] || null, name: row[1] } : null
}

/**
 * The airline a flight is sold as. `operator` flies it, `brand` is whose
 * colours it wears (the same code for mainline flights). Null for private
 * and GA callsigns.
 */
export function brandFor(callsign: string | null | undefined): { operator: string; brand: string } | null {
  const p = parseCallsign(callsign)
  if (!p) return null
  const rule = FLIES_FOR[p.prefix]
  const brand = typeof rule === 'function' ? (p.number == null ? null : rule(p.number)) : rule
  return { operator: p.prefix, brand: brand ?? p.prefix }
}

/** Logo codes to try for a callsign, best first: the brand, then the operator's own. */
export function logoCandidates(callsign: string | null | undefined): string[] {
  const b = brandFor(callsign)
  if (!b) return []
  return b.brand === b.operator ? [b.brand] : [b.brand, b.operator]
}

export type FlightDesignator = {
  /** IATA airline code of the brand the flight is sold under, e.g. `DL`. */
  iata: string
  /** Flight number without leading zeros, e.g. `189`, `12A`. */
  number: string
  /** `DL 189`, as printed on tickets and departure boards. */
  text: string
  /** Who sells the flight, and who flies it (the same for mainline flights). */
  brand: AirlineInfo
  operator: AirlineInfo | null
}

/**
 * The flight number passengers know, from the radio callsign: `DAL189` →
 * `DL 189`, `UAL0012` → `UA 12`. Regional flights take their brand's code
 * (a SkyWest `SKW5432` flown for United is `UA 5432`). Null for private
 * callsigns, airlines we don't know the IATA code of, and alphanumeric
 * callsigns (`BAW9GE`, `ETD8NY`), which don't spell out the flight number.
 */
export function flightDesignator(callsign: string | null | undefined): FlightDesignator | null {
  const cs = (callsign ?? '').trim().toUpperCase()
  const b = brandFor(cs)
  if (!b) return null
  const m = /^\d{1,4}[A-Z]?$/.exec(cs.slice(3))
  if (!m) return null
  const operator = airlineInfo(b.operator)
  const brand = airlineInfo(b.brand) ?? operator
  const iata = brand?.iata ?? operator?.iata
  if (!brand || !iata) return null
  const number = m[0].replace(/^0+(?=\d)/, '')
  return { iata, number, text: `${iata} ${number}`, brand, operator }
}
