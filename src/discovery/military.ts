/**
 * Is this a military (or state) flight? Judged only from what ADS-B carries:
 * the callsign, the transponder address block, a military-style serial in
 * the registration field, or a type only air forces fly.
 *
 * Pure and deterministic. It names the service (from the published callsign
 * conventions) but never a person: VIP callsigns are flagged as VIP, no more.
 */

export type MilitaryBy = 'callsign' | 'address' | 'registration' | 'type'

export type MilitaryInfo = {
  by: MilitaryBy
  /** The service or mission the callsign belongs to, when the callsign says. */
  operator: string | null
  /** Government VIP transport (Special Air Mission and friends). */
  vip: boolean
}

/**
 * Callsign prefixes used by military and state flights, followed by digits
 * (`RCH123`, `CNV4521`, `SAM44`, `VENUS21`). The longer ones first so `VENUS`
 * is not read as something shorter.
 */
const CALLSIGNS: [prefix: string, operator: string, vip: boolean][] = [
  ['VENUS', 'US Air Force VIP transport', true],
  ['EXEC', 'US government VIP transport', true],
  ['SPAR', 'US Air Force VIP transport', true],
  ['NAVY', 'US Navy', false],
  ['ARMY', 'US Army', false],
  ['NATO', 'NATO', false],
  ['RCH', 'US Air Mobility Command (Reach)', false],
  ['CNV', 'US Navy (Convoy)', false],
  ['PAT', 'US Army (Patriot)', false],
  ['SAM', 'US Air Force Special Air Mission', true],
  ['CFC', 'Royal Canadian Air Force', false],
  ['RRR', 'Royal Air Force', false],
  ['GAF', 'German Air Force', false],
  ['CTM', 'French Air and Space Force', false],
  ['IAM', 'Italian Air Force', false],
  ['BAF', 'Belgian Air Component', false],
]

/** The two callsigns that are always and only the presidential and vice-presidential aircraft. */
const STATE: Record<string, string> = { AF1: 'Air Force One', AF2: 'Air Force Two' }

/**
 * Types flown (almost) only by air forces. A 737 or 757 can be military too
 * (C-40, C-32), but then only the callsign or address gives it away.
 */
export const MILITARY_TYPES = new Set(
  'C17 C5 C5M C130 C30J K35R K35E KC10 KC46 KC30 A400 C2 E2 E3TF E3CF E6 E737 P8 P3 B52 B1 B2 U2 F15 F16 F18H F18S F22 F35 A10 T38 T6 V22 H60 H47 H53 H64 UH1 UH1Y AH1 CH47 C12 C21 C26 C27J C295 CN35 R135 RC35'.split(' '),
)

/** US Department of Defense ICAO24 block, and the UK military block. */
const ADDRESS_BLOCKS: [lo: number, hi: number, operator: string][] = [
  [0xadf7c8, 0xafffff, 'US military'],
  [0x43c000, 0x43cfff, 'UK military'],
]

/** Military-style serials as some feeds put them in the registration field: `05-5140`, `166693`-style Navy BuNos are too ambiguous. */
const SERIAL = /^\d{2}-\d{4,5}$/

export function militaryInfo(a: { callsign?: string | null; icao24?: string | null; registration?: string | null; type?: string | null }): MilitaryInfo | null {
  const cs = (a.callsign ?? '').trim().toUpperCase()
  if (STATE[cs]) return { by: 'callsign', operator: STATE[cs], vip: true }
  for (const [prefix, operator, vip] of CALLSIGNS) {
    if (cs.length > prefix.length && cs.startsWith(prefix) && /^\d/.test(cs.slice(prefix.length))) return { by: 'callsign', operator, vip }
  }
  const hex = Number.parseInt(a.icao24 ?? '', 16)
  if (Number.isFinite(hex)) {
    for (const [lo, hi, operator] of ADDRESS_BLOCKS) if (hex >= lo && hex <= hi) return { by: 'address', operator, vip: false }
  }
  if (SERIAL.test((a.registration ?? '').trim())) return { by: 'registration', operator: null, vip: false }
  if (a.type && MILITARY_TYPES.has(a.type.trim().toUpperCase())) return { by: 'type', operator: null, vip: false }
  return null
}
