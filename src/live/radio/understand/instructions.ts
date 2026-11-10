/**
 * Instructions as data: what a controller told an aircraft to do, in a
 * shape the map and the flight story can use. The model reports loose
 * strings (`value: "flight level two four zero"`, `runway: "31 left"`);
 * this turns them into checked values and drops anything that doesn't add
 * up (a heading of 400, a frequency outside the airband), so nothing odd
 * ever reaches the screen.
 */
import type { RawInstruction } from '../../../api/ai/tasks/radioCleanup'

export type Instruction = { callsign: string | null } & (
  | { kind: 'altitude'; action: 'climb' | 'descend' | 'maintain'; ft: number; fl: boolean }
  | { kind: 'heading'; action: 'left' | 'right' | 'fly'; deg: number }
  | { kind: 'speed'; action: 'reduce' | 'increase' | 'maintain'; kt: number }
  | { kind: 'squawk'; code: string }
  | { kind: 'handoff'; action: 'contact' | 'monitor'; facility: string; mhz: number | null }
  | { kind: 'runway'; action: RunwayAction; runway: string | null }
  | { kind: 'taxi'; runway: string | null; via: string[] }
  | { kind: 'pushback' }
)

export type RunwayAction = 'land' | 'takeoff' | 'luaw' | 'hold_short' | 'cross' | 'go_around' | 'exit'
const RUNWAY_ACTIONS: RunwayAction[] = ['land', 'takeoff', 'luaw', 'hold_short', 'cross', 'go_around', 'exit']

const SIDE: Record<string, string> = { l: 'L', left: 'L', r: 'R', right: 'R', c: 'C', center: 'C', centre: 'C' }

/** `DAL 288`, `dal288` → `DAL288`; anything that isn't a plausible callsign → null. */
export function normCallsign(s: unknown): string | null {
  if (typeof s !== 'string') return null
  const c = s.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return c.length >= 2 && c.length <= 8 && /\d|^[A-Z]{4,}$/.test(c) ? c : null
}

/**
 * `31 left`, `31L`, `runway 04R` → the airport's own spelling of that runway
 * (`31L`, `4R`) when it has one; a plausible ident otherwise; null for junk.
 */
export function normRunway(s: unknown, known: string[] = []): string | null {
  if (typeof s !== 'string') return null
  const m = /^\s*(?:rwy|runway)?\s*0?(\d{1,2})\s*(l|r|c|left|right|cent(?:er|re))?\b/i.exec(s)
  if (!m) return null
  const n = Number(m[1])
  if (n < 1 || n > 36) return null
  const side = m[2] ? SIDE[m[2].toLowerCase()] : ''
  const plain = `${n}${side}`
  const hit = known.find((k) => k.replace(/^0/, '').toUpperCase() === plain)
  return hit ?? plain
}

/** `124.75`, `124,750`, `12475` → 124.75 MHz, only inside the VHF airband. */
export function parseMhz(s: unknown): number | null {
  if (typeof s === 'number') return s >= 118 && s < 137 ? Math.round(s * 1000) / 1000 : null
  if (typeof s !== 'string') return null
  const t = s.replace(/\s+/g, '')
  let m = /(1[1-3]\d)[.,](\d{1,3})/.exec(t)
  if (!m) m = /\b(1[1-3]\d)(\d{2,3})\b/.exec(t)
  if (!m) return null
  const v = Number(`${m[1]}.${m[2]}`)
  return v >= 118 && v < 137 ? v : null
}

/** `5000`, `5,000 ft`, `FL240`, `flight level 240` → feet and whether it is a flight level. */
export function parseAltitude(s: unknown): { ft: number; fl: boolean } | null {
  if (typeof s !== 'string' && typeof s !== 'number') return null
  const t = String(s).toUpperCase().replace(/,/g, '').trim()
  const fl = /^(?:FL|FLIGHT\s*LEVEL)\s*(\d{2,3})$/.exec(t)
  if (fl) {
    const n = Number(fl[1])
    return n >= 10 && n <= 600 ? { ft: n * 100, fl: true } : null
  }
  const ft = /^(\d{3,5})\s*(?:FT|FEET)?$/.exec(t)
  if (!ft) return null
  const n = Number(ft[1])
  return n >= 100 && n <= 60000 && n % 100 === 0 ? { ft: n, fl: false } : null
}

const intIn = (s: unknown, lo: number, hi: number): number | null => {
  const m = /^\s*(\d{1,3})\s*(?:°|deg|degrees|kts?|knots)?\s*$/i.exec(String(s ?? ''))
  if (!m) return null
  const n = Number(m[1])
  return n >= lo && n <= hi ? n : null
}

const PHONETIC: Record<string, string> = {
  ALPHA: 'A', ALFA: 'A', BRAVO: 'B', CHARLIE: 'C', DELTA: 'D', ECHO: 'E', FOXTROT: 'F', GOLF: 'G', HOTEL: 'H', INDIA: 'I', JULIET: 'J', JULIETT: 'J',
  KILO: 'K', LIMA: 'L', MIKE: 'M', NOVEMBER: 'N', OSCAR: 'O', PAPA: 'P', QUEBEC: 'Q', ROMEO: 'R', SIERRA: 'S', TANGO: 'T', UNIFORM: 'U',
  VICTOR: 'V', WHISKEY: 'W', WHISKY: 'W', XRAY: 'X', YANKEE: 'Y', ZULU: 'Z',
}

/** `Alpha`, `kilo 4`, `k-a` → `A`, `K4`, `KA`. */
export function taxiwayName(s: unknown): string {
  return String(s ?? '')
    .toUpperCase()
    .replace(/X-RAY/g, 'XRAY')
    .split(/[^A-Z0-9]+/)
    .map((w) => PHONETIC[w] ?? w)
    .join('')
}

/** A model-reported instruction, checked and normalised; null when it doesn't make sense. */
export function normaliseInstruction(raw: Partial<RawInstruction> | null | undefined, runways: string[] = []): Instruction | null {
  if (!raw || typeof raw !== 'object') return null
  const callsign = normCallsign(raw.callsign)
  const action = String(raw.action ?? '').toLowerCase().trim()
  switch (raw.type) {
    case 'altitude': {
      const alt = parseAltitude(raw.value)
      if (!alt) return null
      // "Climb and maintain" is a climb.
      return { kind: 'altitude', callsign, action: /climb/.test(action) ? 'climb' : /descend/.test(action) ? 'descend' : 'maintain', ...alt }
    }
    case 'heading': {
      const deg = intIn(raw.value, 1, 360)
      if (deg == null) return null
      return { kind: 'heading', callsign, action: /left/.test(action) ? 'left' : /right/.test(action) ? 'right' : 'fly', deg }
    }
    case 'speed': {
      const kt = intIn(raw.value, 60, 400)
      if (kt == null) return null
      return { kind: 'speed', callsign, action: /reduce|slow/.test(action) ? 'reduce' : /increase/.test(action) ? 'increase' : 'maintain', kt }
    }
    case 'squawk': {
      const code = String(raw.value ?? '').replace(/\D/g, '')
      return /^[0-7]{4}$/.test(code) ? { kind: 'squawk', callsign, code } : null
    }
    case 'handoff': {
      const mhz = parseMhz(raw.value)
      const facility = String(raw.facility ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
      if (mhz == null && !facility) return null
      return { kind: 'handoff', callsign, action: action === 'monitor' ? 'monitor' : 'contact', facility, mhz }
    }
    case 'runway': {
      const a = action.replace(/[\s-]+/g, '_').replace(/^(?:line_up_and_wait|lineup)$/, 'luaw').replace(/^(?:hold|holdshort)$/, 'hold_short').replace(/^goaround$/, 'go_around')
      if (!(RUNWAY_ACTIONS as string[]).includes(a)) return null
      const runway = normRunway(raw.runway, runways)
      // Every runway clearance names its runway, except a go-around.
      if (!runway && a !== 'go_around') return null
      return { kind: 'runway', callsign, action: a as RunwayAction, runway }
    }
    case 'taxi': {
      const via = (Array.isArray(raw.route) ? raw.route : [])
        .map(taxiwayName)
        .filter((r) => r.length >= 1 && r.length <= 4)
        .slice(0, 12)
      const runway = normRunway(raw.runway, runways)
      if (!via.length && !runway) return null
      return { kind: 'taxi', callsign, runway, via }
    }
    case 'pushback':
      return { kind: 'pushback', callsign }
    default:
      return null
  }
}

const thousands = (n: number) => n.toLocaleString('en-US')
const altText = (i: { ft: number; fl: boolean }) => (i.fl ? `FL${Math.round(i.ft / 100)}` : thousands(i.ft))
/** `124.75`, `135.9`, `121.875`: as many decimals as the frequency has. */
const mhzText = (m: number) => m.toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0')

/** The few characters shown next to the aircraft on the map: `↑5,000`, `HDG 270`, `→124.75`. */
export function badgeLabel(i: Instruction): string {
  switch (i.kind) {
    case 'altitude':
      return `${i.action === 'climb' ? '↑' : i.action === 'descend' ? '↓' : 'ALT '}${altText(i)}`
    case 'heading':
      return `HDG ${String(i.deg).padStart(3, '0')}`
    case 'speed':
      return `SPD ${i.kt}`
    case 'squawk':
      return `SQK ${i.code}`
    case 'handoff':
      return i.mhz != null ? `→${mhzText(i.mhz)}` : `→${i.facility.toUpperCase().slice(0, 10)}`
    case 'runway':
      return { land: 'LAND', takeoff: 'TAKEOFF', luaw: 'LINE UP', hold_short: 'HOLD SHORT', cross: 'CROSS', go_around: 'GO AROUND', exit: 'EXIT' }[i.action] + (i.runway && i.action !== 'go_around' ? ` ${i.runway}` : '')
    case 'taxi':
      return i.runway ? `TAXI ${i.runway}` : `TAXI ${i.via.slice(0, 3).join(' ')}`
    case 'pushback':
      return 'PUSHBACK'
  }
}

/** One step of a flight's story: "taxi via A, B to 31L", "cleared for takeoff 31L", "contact Departure 124.75". */
export function stepText(i: Instruction): string {
  switch (i.kind) {
    case 'altitude':
      return `${i.action} ${altText(i)}`
    case 'heading':
      return `${i.action === 'fly' ? 'heading' : `turn ${i.action}`} ${String(i.deg).padStart(3, '0')}`
    case 'speed':
      return `speed ${i.kt}`
    case 'squawk':
      return `squawk ${i.code}`
    case 'handoff':
      return `${i.action} ${[i.facility, i.mhz != null ? mhzText(i.mhz) : ''].filter(Boolean).join(' ')}`
    case 'runway': {
      const r = i.runway ? ` ${i.runway}` : ''
      return { land: `cleared to land${r}`, takeoff: `cleared for takeoff${r}`, luaw: `line up and wait${r}`, hold_short: `hold short${r}`, cross: `cross${r}`, go_around: 'go around', exit: `exit${r}` }[i.action]
    }
    case 'taxi':
      return ['taxi', i.via.length ? `via ${i.via.join(', ')}` : '', i.runway ? `to ${i.runway}` : ''].filter(Boolean).join(' ')
    case 'pushback':
      return 'pushback'
  }
}

/** Instructions that make sense as a badge on the map (a lasting assignment, not a one-off). */
export function isBadgeWorthy(i: Instruction): boolean {
  return i.kind !== 'pushback' && !(i.kind === 'runway' && i.action === 'exit')
}

export { mhzText }
