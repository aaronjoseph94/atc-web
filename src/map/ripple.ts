/**
 * Geometry and timing for the transmission ripple: soft arcs that travel
 * from whoever is speaking to whoever is listening, like a radio wave
 * crossing the field. Pure, so it can be tested without a map.
 *
 * Each wavefront is an arc of a circle centred on the speaker. Its radius
 * grows from nothing to the full distance as it travels; its width on screen
 * grows a little too (the wave spreads), and it fades in as it leaves and out
 * as it arrives, so nothing ever pops.
 */
import type { Feature, LineString } from 'geojson'
import { metersPerDegLat, metersPerDegLon } from './geo'

/** Time one wavefront takes to cross from speaker to listener, whatever the distance. */
export const TRAVEL_MS = 1350
/** A new wavefront leaves this often while the call is on the air. */
export const EMIT_MS = 520
/** Half-width of an arc on screen as it leaves and as it arrives, in pixels. */
export const ARC_HALF_PX: [number, number] = [9, 24]
/** Widest an arc may open, either side of the line, in degrees. */
const MAX_HALF_ANGLE = 62
/** Points per arc: enough to look round at any size. */
const ARC_POINTS = 11

/** Smooth start, smooth stop (for fades). */
export const smoothstep = (x: number) => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

/** Travel with a gentle landing: quick off the speaker, easing into the listener. */
export const travelEase = (t: number) => 1 - (1 - t) ** 1.7

/**
 * Brightness of a wavefront along its trip: fades in over the first fifth,
 * holds, fades out over the last third.
 */
export function waveOpacity(p: number): number {
  if (p <= 0 || p >= 1) return 0
  return smoothstep(p / 0.2) * smoothstep((1 - p) / 0.34)
}

/**
 * Progress (0..1) of every wavefront alive at `elapsed` ms into a burst that
 * stops emitting after `emitForMs`. Oldest first.
 */
export function wavefronts(elapsed: number, emitForMs: number): number[] {
  const out: number[] = []
  if (elapsed < 0) return out
  const last = Math.floor(Math.min(elapsed, Math.max(0, emitForMs)) / EMIT_MS)
  for (let k = 0; k <= last; k++) {
    const p = (elapsed - k * EMIT_MS) / TRAVEL_MS
    if (p > 0 && p < 1) out.push(p)
  }
  return out
}

/** True once every wavefront of a burst has arrived. */
export function burstDone(elapsed: number, emitForMs: number): boolean {
  const lastLeft = Math.floor(Math.max(0, emitForMs) / EMIT_MS) * EMIT_MS
  return elapsed >= lastLeft + TRAVEL_MS
}

type LonLat = [number, number]

/**
 * The arc for a wavefront at progress `p` from `from` toward `to`, as
 * coordinates. `mpp` is metres per screen pixel at the current zoom, so the
 * arc keeps a sensible size on screen whatever the distance.
 */
export function arc(from: LonLat, to: LonLat, p: number, mpp: number): LonLat[] {
  const kx = metersPerDegLon(from[1])
  const ky = metersPerDegLat(from[1])
  const dx = (to[0] - from[0]) * kx
  const dy = (to[1] - from[1]) * ky
  const dist = Math.hypot(dx, dy)
  if (dist < 1) return []
  const r = dist * travelEase(p)
  if (r < 0.5) return []
  const bearing = Math.atan2(dx, dy)
  const halfM = (ARC_HALF_PX[0] + (ARC_HALF_PX[1] - ARC_HALF_PX[0]) * p) * mpp
  const half = Math.min((MAX_HALF_ANGLE * Math.PI) / 180, Math.asin(Math.min(1, halfM / r)))
  const pts: LonLat[] = []
  for (let i = 0; i < ARC_POINTS; i++) {
    const a = bearing - half + (2 * half * i) / (ARC_POINTS - 1)
    pts.push([from[0] + (r * Math.sin(a)) / kx, from[1] + (r * Math.cos(a)) / ky])
  }
  return pts
}

/**
 * Every feature for one frame of a burst: the faint guide line between the
 * two parties (`kind: 'beam'`) and each wavefront (`kind: 'wave'`), with
 * colour `c` and opacity `o` as properties for the style to read.
 */
export function rippleFeatures(
  from: LonLat,
  to: LonLat,
  elapsed: number,
  emitForMs: number,
  mpp: number,
  color: string,
  { beam, waves }: { beam: number; waves: number },
): Feature<LineString>[] {
  const out: Feature<LineString>[] = []
  if (beam > 0.001) out.push({ type: 'Feature', properties: { kind: 'beam', c: color, o: 0.32 * beam }, geometry: { type: 'LineString', coordinates: [from, to] } })
  if (waves <= 0.001) return out
  for (const p of wavefronts(elapsed, emitForMs)) {
    const coords = arc(from, to, p, mpp)
    if (coords.length < 2) continue
    out.push({ type: 'Feature', properties: { kind: 'wave', c: color, o: waveOpacity(p) * waves }, geometry: { type: 'LineString', coordinates: coords } })
  }
  return out
}

/**
 * Brightness of the guide line and of the waves at `elapsed` ms into a burst
 * whose emission stopped at `stoppedAt` (null while still on the air). The
 * line fades in quickly and out as the last wave lands; waves already
 * travelling always finish their trip.
 */
export function rippleEnvelope(elapsed: number, stoppedAt: number | null): { beam: number; waves: number } {
  const on = smoothstep(elapsed / 260)
  const off = stoppedAt == null ? 1 : 1 - smoothstep((elapsed - stoppedAt) / TRAVEL_MS)
  return { beam: on * off, waves: on }
}

/**
 * How long a live call keeps rippling once its caption is up. Live captions
 * arrive just after the call ends, so the ripple stands in for the call
 * being "on the air": about as long as the call itself, within limits.
 */
export function liveRippleMs(durationMs: number): number {
  return Math.min(6000, Math.max(2600, durationMs))
}
