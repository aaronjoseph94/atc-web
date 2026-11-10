/**
 * Which gates have an aircraft parked at them.
 *
 * Gate positions come from OpenStreetMap (`aeroway=gate` points in the map
 * tiles). An aircraft counts as parked once it has sat on the ground, barely
 * moving, for a couple of minutes; it is then matched to the gate just ahead
 * of its nose, since aircraft park nose-in to the terminal and the gate point
 * marks the stand's stop position at the building end. Aircraft parked on
 * remote stands with no gate nearby simply stay unmatched.
 */
import type { Aircraft } from '../api/types'
import { airlineInfo, brandFor } from '../airline/airlines'
import { distanceM, toLocal, type LngLat } from '../map/geo'

export type Gate = {
  /** Stable key: the map feature id, or the ref and position. */
  id: string
  /** Gate number as signed (`B22`); empty when the map doesn't name it. */
  ref: string
  lon: number
  lat: number
}

/** Ground speed below which an aircraft is standing still, knots. */
export const PARKED_KT = 2
/** How long it must stand still before it counts as parked. */
export const PARKED_MS = 2 * 60_000
/** Gate to aircraft position, metres. */
export const GATE_REACH_M = 45
/** Ground targets jitter by a few metres; moving less than this is standing still. */
const DRIFT_M = 15

type Parking = {
  /** When it was first seen standing here (epoch ms). */
  since: number
  /** Already parked when first seen, so `since` understates how long it has been there. */
  before: boolean
  pos: LngLat
  seenAt: number
}

export type ParkingState = Map<string, Parking>

export type ParkedAircraft = { aircraft: Aircraft; since: number; before: boolean }

/**
 * Follow which aircraft are standing still. Call with each snapshot; `now`
 * is epoch milliseconds. `fresh` marks the first snapshot of a session, when
 * anything already standing still has been there for an unknown time.
 */
export function trackParking(state: ParkingState, aircraft: Aircraft[], now: number, fresh = false): ParkedAircraft[] {
  const parked: ParkedAircraft[] = []
  for (const a of aircraft) {
    const pos: LngLat = [a.lon, a.lat]
    const prev = state.get(a.icao24)
    // A parked transponder often reports no speed at all; then only movement counts.
    const still = a.onGround && !a.category?.startsWith('C') && (a.speedKt == null || a.speedKt < PARKED_KT) && (!prev || distanceM(prev.pos, pos) < DRIFT_M)
    if (!still) {
      state.delete(a.icao24)
      continue
    }
    const p: Parking = prev ?? { since: now, before: fresh, pos, seenAt: now }
    p.seenAt = now
    state.set(a.icao24, p)
    if (now - p.since >= PARKED_MS) parked.push({ aircraft: a, since: p.since, before: p.before })
  }
  // Gone from the feed for a minute: probably powered down, and it may move before it's back.
  for (const [id, p] of state) if (now - p.seenAt > 60_000) state.delete(id)
  return parked
}

export type GateMatch = { gate: Gate; aircraft: Aircraft; since: number; before: boolean; distanceM: number }

/**
 * How well a gate fits a parked aircraft: lower is better, null when it
 * can't be this aircraft's gate. With a known heading the gate should be
 * ahead of the nose and roughly on the aircraft's axis; without one, plain
 * distance has to do.
 */
export function gateFit(a: Aircraft, gate: Gate): number | null {
  const [e, n] = toLocal([a.lon, a.lat], [gate.lon, gate.lat])
  const dist = Math.hypot(e, n)
  if (dist > GATE_REACH_M) return null
  if (a.headingKnown === false) return dist
  const rad = (a.heading * Math.PI) / 180
  const along = e * Math.sin(rad) + n * Math.cos(rad)
  const cross = e * Math.cos(rad) - n * Math.sin(rad)
  // Behind the tail is someone else's gate (or the taxilane).
  if (along < -12) return null
  // Expect the gate a few tens of metres ahead, close to the centreline.
  const ahead = along < 0 ? -along * 2 : Math.max(0, along - 30)
  return Math.hypot(cross * 1.6, ahead) + dist * 0.25
}

/**
 * Pair parked aircraft with gates, best fits first, so each gate holds at
 * most one aircraft and each aircraft sits at one gate. Aircraft with no gate
 * in reach (remote stands, cargo ramps, hangars) come back in `remote`.
 */
export function matchGates(gates: Gate[], parked: ParkedAircraft[]): { matches: GateMatch[]; remote: ParkedAircraft[] } {
  const pairs: { g: Gate; p: ParkedAircraft; fit: number; dist: number }[] = []
  for (const p of parked) {
    for (const g of gates) {
      // Cheap reject before the exact fit.
      if (Math.abs(g.lat - p.aircraft.lat) > 0.001 || Math.abs(g.lon - p.aircraft.lon) > 0.0015) continue
      const fit = gateFit(p.aircraft, g)
      if (fit != null) pairs.push({ g, p, fit, dist: distanceM([p.aircraft.lon, p.aircraft.lat], [g.lon, g.lat]) })
    }
  }
  pairs.sort((a, b) => a.fit - b.fit)
  const usedGates = new Set<string>()
  const usedAircraft = new Set<string>()
  const matches: GateMatch[] = []
  for (const { g, p, dist } of pairs) {
    if (usedGates.has(g.id) || usedAircraft.has(p.aircraft.icao24)) continue
    usedGates.add(g.id)
    usedAircraft.add(p.aircraft.icao24)
    matches.push({ gate: g, aircraft: p.aircraft, since: p.since, before: p.before, distanceM: dist })
  }
  return { matches, remote: parked.filter((p) => !usedAircraft.has(p.aircraft.icao24)) }
}

/** `40 min`, `1 h 05 min`; with `atLeast`, `12+ min` (we only know when we started watching). */
export function formatParked(ms: number, atLeast: boolean): string {
  const min = Math.max(1, Math.floor(ms / 60_000))
  const plus = atLeast ? '+' : ''
  if (min < 60) return `${min}${plus} min`
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}${plus} min`
}

/** Gate popover text: `Gate B22` and `Delta DAL288 (A321) · parked 40 min`, or `Free`. */
export function describeGate(ref: string, match: GateMatch | null | undefined, now: number): { title: string; detail: string } {
  const title = ref ? `Gate ${ref}` : 'Gate'
  if (!match) return { title, detail: 'Free' }
  const a = match.aircraft
  const brand = brandFor(a.callsign)
  const airline = brand ? (airlineInfo(brand.brand)?.name ?? airlineInfo(brand.operator)?.name ?? null) : null
  // Feeds without a callsign send the transponder address instead; that isn't worth showing.
  const callsign = /^[0-9a-f]{6}$/i.test(a.callsign) && a.callsign.toLowerCase() === a.icao24.toLowerCase() ? null : a.callsign
  const who = [airline, callsign ?? (a.registration || null)].filter(Boolean).join(' ') || 'An aircraft'
  const type = a.type ? ` (${a.type})` : ''
  return { title, detail: `${who}${type} · parked ${formatParked(now - match.since, match.before)}` }
}

/**
 * The colour a logo reads as, from its pixels (RGBA): the most common strong
 * hue among its opaque pixels (so a red-and-blue logo comes out red or blue,
 * not a muddy purple), or null when it is mostly white, grey or black (then
 * a neutral fill is used instead).
 */
export function dominantColour(rgba: ArrayLike<number>): string | null {
  const BINS = 12
  const bins = Array.from({ length: BINS }, () => ({ r: 0, g: 0, b: 0, w: 0 }))
  let opaque = 0
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const alpha = rgba[i + 3] / 255
    if (alpha < 0.5) continue
    opaque++
    const R = rgba[i]
    const G = rgba[i + 1]
    const B = rgba[i + 2]
    const max = Math.max(R, G, B)
    const min = Math.min(R, G, B)
    const sat = max === 0 ? 0 : (max - min) / max
    // Pale tints and near-blacks say little about the brand colour.
    if (sat < 0.35 || max < 50) continue
    const d = max - min
    const hue = max === R ? ((G - B) / d + 6) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4
    const bin = bins[Math.floor((hue / 6) * BINS) % BINS]
    const w = sat * alpha
    bin.r += R * w
    bin.g += G * w
    bin.b += B * w
    bin.w += w
  }
  const top = bins.reduce((a, b) => (b.w > a.w ? b : a))
  // A few coloured specks in a white logo shouldn't paint the whole chip.
  if (!opaque || top.w < opaque * 0.08) return null
  const hex = (v: number) => Math.round(v / top.w).toString(16).padStart(2, '0')
  return `#${hex(top.r)}${hex(top.g)}${hex(top.b)}`
}

/** Dark or white text for a chip of this colour, whichever reads better. */
export function textOn(hex: string): string {
  const v = parseInt(hex.slice(1), 16)
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const lum = 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255)
  // Where white and near-black give the same contrast ratio.
  return lum > 0.19 ? '#14161C' : '#FFFFFF'
}
