/**
 * What the current METAR means for the map's atmosphere: how much cloud
 * shadow, rain, snow and haze to draw, and which way and how hard the wind
 * blows. Pure, so the rules can be tested without a map.
 */
import type { Metar } from '../../api/types'

export type WeatherFx = {
  /** Cloud shadows on the ground: 0 none, about 0.6 broken, 1 overcast. */
  cloud: number
  /** Rain streaks, 0..1 (light drizzle up to heavy rain or a thunderstorm). */
  rain: number
  /** Snow flecks, 0..1. */
  snow: number
  /** Haze toward the screen edges, 0..1, from low visibility and mist or fog. */
  fog: number
  /** Degrees true the wind blows FROM, or null when calm or variable. */
  windFrom: number | null
  /** Mean wind and gust in knots (0 when unknown). */
  windKt: number
  gustKt: number
  variable: boolean
}

export const CALM: WeatherFx = { cloud: 0, rain: 0, snow: 0, fog: 0, windFrom: null, windKt: 0, gustKt: 0, variable: false }

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))

/** Strength of a precipitation group: `-` light, none moderate, `+` heavy. */
function intensity(token: string): number {
  return token.startsWith('-') ? 0.45 : token.startsWith('+') ? 1 : 0.72
}

/** The atmosphere to draw for a METAR (or nothing at all without one). */
export function weatherFx(metar: Metar | null | undefined): WeatherFx {
  if (!metar) return CALM
  // Only layers low enough to shade the ground matter, and the thickest one wins.
  let cloud = 0
  for (const c of metar.clouds) {
    if (c.baseFt != null && c.baseFt > 12000) continue
    const cover = c.cover.toUpperCase()
    const v = cover === 'OVC' || cover === 'VV' ? 1 : cover === 'BKN' ? 0.6 : cover === 'SCT' ? 0.25 : 0
    cloud = Math.max(cloud, v)
  }

  let rain = 0
  let snow = 0
  let mist = 0
  for (const token of (metar.weather ?? '').toUpperCase().split(/\s+/).filter(Boolean)) {
    // "In the vicinity" is not over the field.
    if (token.includes('VC')) continue
    const k = intensity(token)
    if (/SN|SG|PL|IC/.test(token)) snow = Math.max(snow, k)
    if (/RA/.test(token)) rain = Math.max(rain, token.includes('TS') ? Math.max(k, 0.85) : k)
    else if (/DZ/.test(token)) rain = Math.max(rain, k * 0.5)
    else if (/^[-+]?TS/.test(token) && !/SN/.test(token)) rain = Math.max(rain, 0.6)
    if (/FG/.test(token) && !/MIFG|BCFG|PRFG/.test(token)) mist = Math.max(mist, 0.65)
    else if (/FG/.test(token)) mist = Math.max(mist, 0.35)
    if (/BR|HZ|FU/.test(token)) mist = Math.max(mist, 0.28)
  }
  // Rain or snow falling through the visible sky needs a cloud deck to come from.
  if ((rain || snow) && cloud < 0.6) cloud = 0.6

  // Haze from the reported visibility: none at 3 SM or more, full at a quarter mile.
  const vis = metar.visibilitySm
  const fromVis = vis == null || metar.visibilityPlus ? 0 : clamp((3 - vis) / 2.75) ** 0.8
  const fog = clamp(Math.max(fromVis, mist))

  const windKt = Math.max(0, metar.windKt ?? 0)
  return {
    cloud,
    rain,
    snow,
    fog,
    windFrom: windKt > 0 && !metar.windVariable ? metar.windDirDeg : null,
    windKt,
    gustKt: Math.max(windKt, metar.gustKt ?? 0),
    variable: metar.windVariable,
  }
}

/**
 * How far a windsock stands out, 0 (hanging limp) to 1 (full). A real sock is
 * calibrated to stand fully out at 15 knots; under 3 it hangs.
 */
export function sockExtension(kt: number): number {
  if (kt < 3) return 0.18 + (kt / 3) * 0.12
  return clamp(0.3 + ((kt - 3) / 12) * 0.7, 0.3, 1)
}

/** How much the gusts make things sway: 0 steady, 1 gusting 15 kt or more above the mean. */
export function gustiness(fx: WeatherFx): number {
  return clamp((fx.gustKt - fx.windKt) / 15)
}

/**
 * Screen direction (radians, 0 = up, clockwise) the wind blows TOWARD for a
 * map rotated by `bearing` degrees, or null when there is no steady direction.
 */
export function downwindScreenAngle(fx: WeatherFx, bearing: number): number | null {
  if (fx.windFrom == null) return null
  return (((fx.windFrom + 180 - bearing) % 360) * Math.PI) / 180
}
