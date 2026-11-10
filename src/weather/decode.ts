/**
 * METAR pieces turned into plain words and numbers for the weather panel:
 * "Light rain, overcast at 1,200 ft", "6 min ago", the variable wind range,
 * density altitude. Pure, so it is easy to test and shared by the TAF
 * timeline.
 */
import type { FlightCategory, Metar } from '../api/types'
import type { AltitudeUnit, SpeedUnit } from '../settings/settingsStore'

export const HPA_PER_INHG = 33.8639
const M_PER_SM = 1609.344

export const CATEGORY_TEXT: Record<FlightCategory, string> = {
  VFR: 'Clear enough to fly by sight',
  MVFR: 'Marginal: lowish cloud or haze',
  IFR: 'Instrument conditions',
  LIFR: 'Very low cloud or fog',
}

/** The FAA's thresholds (ceiling in feet, visibility in statute miles). */
export function flightCategory(ceilingFt: number | null, visibilitySm: number | null): FlightCategory | null {
  if (ceilingFt == null && visibilitySm == null) return null
  const c = ceilingFt ?? Infinity
  const v = visibilitySm ?? Infinity
  if (c < 500 || v < 1) return 'LIFR'
  if (c < 1000 || v < 3) return 'IFR'
  if (c <= 3000 || v <= 5) return 'MVFR'
  return 'VFR'
}

/** Lowest broken, overcast or obscured layer (the "ceiling"). */
export function ceilingOf(clouds: { cover: string; baseFt: number | null }[]): number | null {
  const bases = clouds.filter((c) => /^(BKN|OVC|OVX|VV)/.test(c.cover) && c.baseFt != null).map((c) => c.baseFt as number)
  return bases.length ? Math.min(...bases) : null
}

const COVER_WORD: Record<string, string> = { FEW: 'Few clouds', SCT: 'Scattered clouds', BKN: 'Broken clouds', OVC: 'Overcast', OVX: 'Sky obscured', VV: 'Sky obscured' }
const COVER_SHORT: Record<string, string> = { FEW: 'Few', SCT: 'Scattered', BKN: 'Broken', OVC: 'Overcast', OVX: 'Obscured', VV: 'Obscured' }
/** How much of the sky a layer covers, in eighths, as on a station model. */
const COVER_OKTAS: Record<string, number> = { FEW: 2, SCT: 4, BKN: 6, OVC: 8, OVX: 8, VV: 8 }

export const coverWord = (cover: string) => COVER_SHORT[cover] ?? cover
export const coverOktas = (cover: string) => COVER_OKTAS[cover] ?? 0

/** Cloud heights: feet, or metres rounded to tens for metric users. */
export function formatHeight(ft: number, unit: AltitudeUnit): string {
  const m = ft * 0.3048
  // Metres to the nearest ten, except close to the ground where that would round a 13 ft field to 0 m.
  const text = unit === 'm' ? `${(Math.abs(m) < 100 ? Math.round(m) : Math.round(m / 10) * 10).toLocaleString('en-US')} m` : `${Math.round(ft).toLocaleString('en-US')} ft`
  // A true minus sign: the hyphen sits too low and too short next to the figures.
  return text.replace(/^-/, '\u2212')
}

/** `Overcast at 1,200 ft`: the ceiling if there is one, else the lowest layer, else clear. */
export function describeSky(clouds: { cover: string; baseFt: number | null }[], unit: AltitudeUnit = 'ft'): string {
  const layers = clouds.filter((c) => COVER_WORD[c.cover])
  if (!layers.length) return clouds.some((c) => /^(SKC|CLR)$/.test(c.cover)) ? 'Clear skies' : 'No cloud reported'
  const ceiling = ceilingOf(layers)
  const pick = layers.find((c) => c.baseFt === ceiling && /^(BKN|OVC|OVX|VV)/.test(c.cover)) ?? layers.reduce((a, b) => ((b.baseFt ?? Infinity) < (a.baseFt ?? Infinity) ? b : a))
  return pick.baseFt == null ? COVER_WORD[pick.cover] : `${COVER_WORD[pick.cover]} at ${formatHeight(pick.baseFt, unit)}`
}

const PHENOMENA: Record<string, string> = {
  DZ: 'drizzle', RA: 'rain', SN: 'snow', SG: 'snow grains', IC: 'ice crystals', PL: 'ice pellets', GR: 'hail', GS: 'small hail', UP: 'precipitation',
  BR: 'mist', FG: 'fog', FU: 'smoke', VA: 'volcanic ash', DU: 'dust', SA: 'sand', HZ: 'haze', PY: 'spray',
  PO: 'dust whirls', SQ: 'squalls', FC: 'funnel cloud', SS: 'sandstorm', DS: 'duststorm',
}
const DESCRIPTOR: Record<string, string> = { MI: 'shallow', PR: 'patchy', BC: 'patches of', DR: 'drifting', BL: 'blowing', FZ: 'freezing' }

/** One present-weather group (`-SHRA`, `+TSRA`, `VCFG`, `BR`) in words. */
export function describeWeatherGroup(code: string): string | null {
  const m = code.match(/^([-+]|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?((?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)*)$/)
  if (!m) return null
  const [, intensity, desc, rest] = m
  const kinds = (rest.match(/../g) ?? []).map((k) => PHENOMENA[k]).filter(Boolean)
  let words: string
  if (desc === 'TS') words = kinds.length ? `thunderstorm with ${kinds.join(' and ')}` : 'thunderstorm'
  else if (desc === 'SH') words = kinds.length ? `${kinds.join(' and ')} showers` : 'showers'
  else if (desc) words = [DESCRIPTOR[desc], kinds.join(' and ')].filter(Boolean).join(' ')
  else words = kinds.join(' and ')
  if (!words) return null
  if (intensity === '-') words = `light ${words}`
  else if (intensity === '+') words = `heavy ${words}`
  else if (intensity === 'VC') words = `${words} nearby`
  return words
}

/** `-RA BR` → `Light rain and mist`. */
export function describeWeather(codes: string | null | undefined): string | null {
  const parts = (codes ?? '').split(/\s+/).filter(Boolean).map(describeWeatherGroup).filter((w): w is string => !!w)
  if (!parts.length) return null
  const text = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return text[0].toUpperCase() + text.slice(1)
}

/** `Light rain, overcast at 1,200 ft`. */
export function conditionsLine(m: Pick<Metar, 'weather' | 'clouds'>, unit: AltitudeUnit = 'ft'): string {
  const wx = describeWeather(m.weather)
  const sky = describeSky(m.clouds, unit)
  if (!wx) return sky
  return sky === 'No cloud reported' ? wx : `${wx}, ${sky[0].toLowerCase()}${sky.slice(1)}`
}

/** `just now`, `6 min ago`, `1 h 20 min ago`. */
export function agoText(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  const rest = min % 60
  if (h >= 24) return `${Math.round(h / 24)} d ago`
  return rest ? `${h} h ${rest} min ago` : `${h} h ago`
}

/** The `220V280` group: the wind's swing either side of its mean. */
export function variableRange(raw: string | null | undefined): [number, number] | null {
  const m = (raw ?? '').replace(/\bRMK\b.*$/, '').match(/\b(\d{3})V(\d{3})\b/)
  return m ? [+m[1] % 360, +m[2] % 360] : null
}

const POINTS = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast', 'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest']
/** 250 → `west-southwest`. */
export const compassPoint = (deg: number) => POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]

/** A wind speed in the user's unit, without the unit (the label carries it). */
export function speedValue(kt: number, unit: SpeedUnit): number {
  return Math.round(unit === 'kmh' ? kt * 1.852 : unit === 'mph' ? kt * 1.15078 : kt)
}
export const speedUnitLabel = (unit: SpeedUnit) => (unit === 'kmh' ? 'km/h' : unit === 'mph' ? 'mph' : 'kt')

/** `10+ mi`, `3/4 mi`, `16 km`: statute miles, or kilometres for metric users. */
export function formatVisibility(sm: number | null, plus: boolean, unit: AltitudeUnit = 'ft'): string {
  if (sm == null) return '—'
  if (unit === 'm') {
    const km = (sm * M_PER_SM) / 1000
    // "6SM or more" and ICAO 9999 both mean the 10 km the observers stop counting at.
    if (plus && km >= 9.5) return '10+ km'
    if (km < 1) return `${Math.round(km * 1000)} m`
    return `${km >= 10 ? Math.round(km) : Math.round(km * 10) / 10}${plus ? '+' : ''} km`
  }
  const whole = Math.floor(sm)
  const frac = sm - whole
  const fracText = frac < 0.05 ? '' : frac < 0.3 ? '1/4' : frac < 0.6 ? '1/2' : frac < 0.85 ? '3/4' : ''
  const n = frac >= 0.85 ? whole + 1 : whole
  const value = fracText ? (n ? `${n} ${fracText}` : fracText) : String(Math.round(sm * 10) / 10 === n ? n : Math.round(sm * 10) / 10)
  return `${value}${plus ? '+' : ''} mi`
}

/**
 * Density altitude: the height the aircraft "feels", from pressure altitude
 * corrected for how far the air is from standard temperature (the usual
 * 120 ft per °C rule of thumb).
 */
export function densityAltitudeFt(elevationFt: number, tempC: number | null, altimeterInHg: number | null): number | null {
  if (tempC == null || altimeterInHg == null) return null
  const pressureAlt = elevationFt + (29.92 - altimeterInHg) * 1000
  const isa = 15 - (2 * pressureAlt) / 1000
  return Math.round(pressureAlt + 120 * (tempC - isa))
}

/** Does the station report its pressure in hectopascals (Q group) rather than inches (A group)? */
export const reportsHpa = (raw: string | null | undefined) => /\bQ\d{4}\b/.test((raw ?? '').replace(/\bRMK\b.*$/, ''))

/** A whole number with a true minus sign, for temperatures. */
export const signed = (n: number) => String(Math.round(n)).replace(/^-/, '\u2212')

export const toHpa = (inHg: number) => Math.round(inHg * HPA_PER_INHG)
export const toF = (c: number) => Math.round((c * 9) / 5 + 32)
