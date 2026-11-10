/**
 * Which way a parked aircraft points when its transponder doesn't say.
 *
 * Many aircraft at the gate report a position but no track, so they would be
 * drawn as plain markers: a field of grey discs along every pier. Aircraft
 * park nose-in to the terminal, so the nearest building face gives a good
 * guess: the aircraft points straight at it (the same reasoning the stand
 * lead-in lines use, see `atmosphere/stands.ts`). Aircraft with no building
 * close by (remote stands, cargo ramps) keep the marker.
 *
 * Buildings come from the loaded map tiles, so the guess is worked out a few
 * times a second at most and remembered per aircraft while it stays put.
 */
import type { Map as MapLibreMap } from 'maplibre-gl'
import { standPose } from './atmosphere/stands'
import { distanceM, type LngLat } from './geo'

/** Moving more than this means the old guess no longer applies. */
const MOVED_M = 15
/** How often missing guesses are looked for (tiles may have arrived since). */
const LOOK_MS = 1500
/** A failed guess is tried again after this long (the buildings may not have been loaded). */
const RETRY_MS = 5000
/** Buildings are only in the tiles from about this zoom. */
const MIN_ZOOM = 13

type Guess = { pos: LngLat; heading: number | null; at: number }

/** An aircraft that would be drawn as a marker: on the ground, standing still, with no reported heading. */
export function wantsGuess(a: { headingKnown?: boolean; onGround: boolean; speedKt: number | null; category?: string | null }): boolean {
  return a.headingKnown === false && a.onGround && (a.speedKt ?? 0) < 4 && !(a.category ?? '').toUpperCase().startsWith('C')
}

/** Heading (degrees true) of an aircraft at `pos` parked nose-in to the nearest of `rings`, or null if no face is close (`MAX_FACE_M`). */
export function noseInHeading(pos: LngLat, rings: LngLat[][]): number | null {
  const pose = standPose(pos, rings)
  return pose ? (pose.outBearing + 180) % 360 : null
}

export class ParkedHeadings {
  private guesses = new Map<string, Guess>()
  private lookedAt = -Infinity

  /** The guessed heading for an aircraft, if there is one. */
  get(icao24: string): number | null {
    return this.guesses.get(icao24)?.heading ?? null
  }

  /**
   * Bring the guesses up to date for this frame's aircraft. Cheap when there
   * is nothing new: the tiles are only read when some headless parked
   * aircraft has no current guess, and then at most every `LOOK_MS`.
   */
  update(map: MapLibreMap, list: { icao24: string; lon: number; lat: number; headingKnown?: boolean; onGround: boolean; speedKt: number | null; category?: string | null }[], now: number) {
    if (now - this.lookedAt < LOOK_MS) return
    const todo: { id: string; pos: LngLat }[] = []
    const seen = new Set<string>()
    for (const a of list) {
      if (!wantsGuess(a)) continue
      seen.add(a.icao24)
      const pos: LngLat = [a.lon, a.lat]
      const g = this.guesses.get(a.icao24)
      if (g && distanceM(g.pos, pos) < MOVED_M && (g.heading != null || now - g.at < RETRY_MS)) continue
      todo.push({ id: a.icao24, pos })
    }
    for (const id of this.guesses.keys()) if (!seen.has(id)) this.guesses.delete(id)
    if (!todo.length) return
    this.lookedAt = now
    // Buildings aren't in the far tiles, and tiles still loading would give a wrong "no building here".
    if (map.getZoom() < MIN_ZOOM || !map.isSourceLoaded('omt')) return
    const rings = buildingRings(map)
    for (const { id, pos } of todo) {
      // About 100 m in degrees: only buildings around this aircraft.
      const near = rings.filter(({ box }) => pos[0] > box[0] - 0.0015 && pos[0] < box[2] + 0.0015 && pos[1] > box[1] - 0.001 && pos[1] < box[3] + 0.001).map((r) => r.ring)
      this.guesses.set(id, { pos, heading: near.length ? noseInHeading(pos, near) : null, at: now })
    }
  }

  clear() {
    this.guesses.clear()
    this.lookedAt = -Infinity
  }
}

/** Outer rings of the buildings in the loaded tiles, each with a bounding box. */
function buildingRings(map: MapLibreMap): { ring: LngLat[]; box: [number, number, number, number] }[] {
  const out: { ring: LngLat[]; box: [number, number, number, number] }[] = []
  let features: ReturnType<MapLibreMap['querySourceFeatures']>
  try {
    features = map.querySourceFeatures('omt', { sourceLayer: 'building' })
  } catch {
    return out
  }
  for (const f of features) {
    const g = f.geometry
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
    for (const poly of polys) {
      const ring = poly[0] as LngLat[]
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (const [x, y] of ring) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
      out.push({ ring, box: [x0, y0, x1, y1] })
    }
  }
  return out
}
