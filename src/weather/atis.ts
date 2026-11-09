/**
 * Helpers for the weather panel: turning terse ATIS and METAR shorthand into
 * something a person (or a speech synthesizer) can read, and working out how
 * the wind lines up with each runway.
 */
import type { Metar } from '../api/types'
import type { RunwayEndGeometry } from '../map/airportDiagram'
import { angleDelta } from '../map/geo'

const PHONETIC: Record<string, string> = {
  A: 'Alfa', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India',
  J: 'Juliett', K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo',
  S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu',
}

/** "P" → "Papa". */
export const phonetic = (letter: string) => PHONETIC[letter.toUpperCase()] ?? letter

/** Abbreviations that appear in digital ATIS text, spelled out. Order matters: longer first. */
const ABBREVIATIONS: [RegExp, string][] = [
  [/\bRWYS\b/g, 'runways'],
  [/\bRWY\b|\bRY\b/g, 'runway'],
  [/\bTWYS\b/g, 'taxiways'],
  [/\bTWY\b/g, 'taxiway'],
  [/\bAPCHS\b/g, 'approaches'],
  [/\bAPCH\b/g, 'approach'],
  [/\bARRS\b/g, 'arrivals'],
  [/\bARR\b/g, 'arrivals'],
  [/\bDEPS\b|\bDEPG\b/g, 'departures'],
  [/\bDEP\b/g, 'departure'],
  [/\bEXP\b/g, 'expect'],
  [/\bSIMUL\b/g, 'simultaneous'],
  [/\bCLSD\b/g, 'closed'],
  [/\bOTS\b/g, 'out of service'],
  [/\bCTN\b/g, 'caution'],
  [/\bARPT\b/g, 'airport'],
  [/\bADVS\b/g, 'advise'],
  [/\bINFO\b/g, 'information'],
  [/\bFREQ\b/g, 'frequency'],
  [/\bGND\b/g, 'ground'],
  [/\bCLNC\b/g, 'clearance'],
  [/\bDEL\b/g, 'delivery'],
  [/\bAVBL\b|\bAVL\b/g, 'available'],
  [/\bEQUIP\b/g, 'equipment'],
  [/\bNUM\b/g, 'numerous'],
  [/\bVCNTY\b/g, 'vicinity'],
  [/\bHND\b/g, 'hundred'],
  [/\bTHSD\b/g, 'thousand'],
  [/\bH\/S\b/g, 'hold short'],
  [/\bILS\b/g, 'I L S'],
  [/\bPAPI\b/g, 'PAPI'],
  [/\bNOTAMS?\b/g, 'notices'],
  [/\bRMK\b.*?(?=\.\s|$)/g, ''],
]

const COVER: Record<string, string> = { FEW: 'few clouds at', SCT: 'scattered clouds at', BKN: 'broken clouds at', OVC: 'overcast at', CLR: 'sky clear', SKC: 'sky clear', VV: 'vertical visibility' }

/**
 * Rewrite ATIS shorthand so it can be read aloud or read comfortably:
 * runway designators spoken digit by digit, weather groups decoded,
 * abbreviations expanded.
 */
export function readableAtis(text: string): string {
  let s = text
  // "INFO P" / "ATIS INFO P 2151Z" → "information Papa, time 21 51 Zulu"
  s = s.replace(/\bINFO ([A-Z])\b/g, (_, l: string) => `information ${phonetic(l)}`)
  s = s.replace(/\b(\d{2})(\d{2})Z\b/g, 'time $1 $2 Zulu')
  // Wind: 21008KT, 33020G27KT, VRB04KT
  s = s.replace(/\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT\b/g, (_, dir: string, spd: string, gust?: string) => {
    const from = dir === 'VRB' ? 'variable' : `${dir.split('').join(' ')}`
    return `wind ${from} at ${Number(spd)}${gust ? `, gusting ${Number(gust)}` : ''}`
  })
  s = s.replace(/\b(\d{1,2})SM\b/g, 'visibility $1 miles')
  s = s.replace(/\b(FEW|SCT|BKN|OVC|VV)(\d{3})\b/g, (_, c: string, h: string) => `${COVER[c]} ${(Number(h) * 100).toLocaleString('en-US')}`)
  s = s.replace(/\b(CLR|SKC)\b/g, (_, c: string) => COVER[c])
  s = s.replace(/\b(M?\d{2})\/(M?\d{2})\b/g, (_, t: string, d: string) => `temperature ${t.replace('M', 'minus ')}, dew point ${d.replace('M', 'minus ')}`.replace(/\b0(\d)\b/g, '$1'))
  s = s.replace(/\bA(\d)(\d)(\d)(\d)\b/g, 'altimeter $1 $2 $3 $4')
  // The altimeter is usually repeated in words in brackets.
  s = s.replace(/\([A-Z ]+\)/g, '')
  // Runway designators: "RWY 27C" → "runway 2 7 centre"
  s = s.replace(/\b(RWYS?|RY)\s+((?:\d{1,2}[LCR]?(?:[,/ ]+)?)+)/g, (_, word: string, list: string) => {
    const spoken = list
      .trim()
      .split(/[,/ ]+/)
      .filter(Boolean)
      .map((r) => r.replace(/^(\d{1,2})([LCR])?$/, (_m, n: string, side?: string) => `${n.split('').join(' ')}${side ? ` ${{ L: 'left', C: 'centre', R: 'right' }[side]}` : ''}`))
      .join(', ')
    return `${/S$/.test(word) ? 'runways' : 'runway'} ${spoken} `
  })
  for (const [re, to] of ABBREVIATIONS) s = s.replace(re, to)
  return s.replace(/\.{2,}/g, '.').replace(/\s+([,.])/g, '$1').replace(/\s{2,}/g, ' ').trim()
}

/** Sentence-case a block of upper-case ATIS text for on-screen reading. */
export function sentenceCase(text: string): string {
  return text.toLowerCase().replace(/(^|[.!?]\s+)([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase()).replace(/\b(i l s|papi|atis|zulu)\b/gi, (m) => (m.toLowerCase() === 'zulu' ? 'Zulu' : m.toUpperCase().replace(/ /g, '')))
}

export type RunwayWind = { ident: string; headwindKt: number; crosswindKt: number; from: 'left' | 'right' | null }

/**
 * Head- and cross-wind on each runway end, best (most headwind) first.
 * Aircraft take off and land into the wind, so the top of this list is where
 * traffic is most likely to be.
 */
export function runwayWinds(metar: Pick<Metar, 'windDirDeg' | 'windKt'> | null | undefined, ends: RunwayEndGeometry[]): RunwayWind[] {
  if (!metar || metar.windDirDeg == null || !metar.windKt) return []
  const out: RunwayWind[] = []
  for (const e of ends) {
    // Angle between where the aircraft points and where the wind comes from.
    const off = (angleDelta(e.bearing, metar.windDirDeg) * Math.PI) / 180
    const cross = Math.sin(off) * metar.windKt
    out.push({
      ident: e.ident,
      headwindKt: Math.round(Math.cos(off) * metar.windKt),
      crosswindKt: Math.abs(Math.round(cross)),
      from: Math.abs(cross) < 0.5 ? null : cross > 0 ? 'right' : 'left',
    })
  }
  return out.sort((a, b) => b.headwindKt - a.headwindKt || a.crosswindKt - b.crosswindKt)
}

/** Lowest broken or overcast layer: the "ceiling". */
export function ceilingFt(metar: Pick<Metar, 'clouds'>): number | null {
  const layers = metar.clouds.filter((c) => /^(BKN|OVC|VV)/.test(c.cover) && c.baseFt != null).map((c) => c.baseFt as number)
  return layers.length ? Math.min(...layers) : null
}
