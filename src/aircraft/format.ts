/** Unit formatting for aircraft facts, following the user's altitude and speed units. */
import { formatSpeed, type AltitudeUnit, type SpeedUnit } from '../settings/settingsStore'
import type { TypeFacts } from './types'

const num = (v: number, digits = 0) => v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })

/** Wingspan or length: metres with one decimal, or whole feet. */
export function formatLength(m: number, unit: AltitudeUnit): string {
  return unit === 'm' ? `${num(m, 1)} m` : `${num(m / 0.3048)} ft`
}

/** Range in the distance unit that goes with the speed unit (kt → nm, km/h → km, mph → mi). */
export function formatRange(nm: number, unit: SpeedUnit): string {
  // Published ranges are round numbers; keep the conversions round too.
  if (unit === 'kmh') return `${num(Math.round((nm * 1.852) / 50) * 50)} km`
  if (unit === 'mph') return `${num(Math.round((nm * 1.15078) / 50) * 50)} mi`
  return `${num(nm)} nm`
}

/** Cruise: Mach number for jets, speed in the user's unit for the rest. */
export function formatCruise(c: NonNullable<TypeFacts['cruise']>, unit: SpeedUnit): string {
  return 'mach' in c ? `Mach ${c.mach}` : formatSpeed(c.kt, unit)
}
