/**
 * Decides whether this frame's aircraft data is worth sending to the map.
 *
 * Every `setData` on a GeoJSON source makes MapLibre re-cut that source's
 * tiles in its worker, lay the symbols out again, re-run collision for the
 * tags and upload a fresh icon atlas per tile (the callsign tags and
 * aircraft artwork, premultiplied in JavaScript first). With a busy sky that
 * was megabytes of texture upload per frame, on every frame, and a 120 Hz
 * desktop display did it twice as often as a phone.
 *
 * Most frames change nothing anyone could see: at the airfield view an
 * airliner on approach crosses about ten pixels a second, so one frame moves
 * it a sixth of a pixel, and parked aircraft don't move at all. So the frame
 * is sent only when something on screen has visibly changed: an aircraft
 * (or its shadow) moved or turned by at least `motionPx` screen pixels, it
 * faded, or anything drawn about it changed (its tag, its artwork, being
 * selected). Aircraft off screen don't count, except for coming into view.
 * Everything is still sent at least every `maxStaleMs`, so nothing drifts
 * far from the truth while off screen.
 *
 * Pure (no map, no DOM) so the decisions can be tested.
 */

export type GateItem = {
  id: string
  lon: number
  lat: number
  /** Where its shadow is drawn, when it has one. */
  shadow?: [number, number] | null
  heading: number
  /** How far the artwork reaches from its point (px): turning or resizing it moves its edges by this lever. */
  reachPx: number
  scale: number
  /** Fade (0..1). */
  o: number
  /** Tag edge fade (0..1). */
  eo: number
  /** Everything else drawn, as one string: any change is sent at once. */
  key: string
  /** On screen (or near it). */
  vis: boolean
}

export type GateOptions = {
  /** Smallest on-screen movement (px) worth a send. */
  motionPx: number
  /** Least time between sends driven by motion alone (ms). */
  minSendMs: number
  /** Most time between sends whatever happens (ms). */
  maxStaleMs: number
}

export type SendReason = 'first' | 'set' | 'key' | 'view' | 'stale' | 'motion' | 'fade'

const FADE_STEP = 0.02
const EDGE_FADE_STEP = 0.03
const M_PER_DEG_LAT = 110_540
const M_PER_DEG_LON_EQ = 111_320

/** Ground distance between two points in metres (flat-earth, fine over the few metres compared here). */
function metres(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const kx = M_PER_DEG_LON_EQ * Math.cos((lat1 * Math.PI) / 180)
  return Math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * M_PER_DEG_LAT)
}

/** Smallest difference between two headings, degrees. */
export function headingDelta(a: number, b: number): number {
  const d = (((a - b) % 360) + 540) % 360 - 180
  return Math.abs(d)
}

export class SendGate {
  private sent = new Map<string, GateItem>()
  private sentAt = -Infinity
  private any = false

  /** Forget what was sent: the next frame goes out whatever it holds. */
  reset() {
    this.sent.clear()
    this.any = false
  }

  /**
   * Why this frame should be sent, or null to skip it. `mPerPx` is ground
   * metres per screen pixel at the current zoom.
   */
  check(items: GateItem[], now: number, mPerPx: number, o: GateOptions): SendReason | null {
    if (!this.any) return 'first'
    if (items.length !== this.sent.size) return 'set'
    // Things that change what is drawn, not just where: always at once.
    for (const n of items) {
      const p = this.sent.get(n.id)
      if (!p) return 'set'
      if (n.vis !== p.vis) return 'view'
      if (n.vis && (n.key !== p.key || !n.shadow !== !p.shadow)) return 'key'
    }
    const since = now - this.sentAt
    if (since >= o.maxStaleMs) return 'stale'
    if (since < o.minSendMs) return null
    const px = Math.max(1e-9, mPerPx)
    for (const n of items) {
      if (!n.vis) continue
      const p = this.sent.get(n.id)!
      if (metres(p.lon, p.lat, n.lon, n.lat) / px >= o.motionPx) return 'motion'
      if (n.shadow && p.shadow && metres(p.shadow[0], p.shadow[1], n.shadow[0], n.shadow[1]) / px >= o.motionPx) return 'motion'
      if (((headingDelta(n.heading, p.heading) * Math.PI) / 180) * n.reachPx >= o.motionPx) return 'motion'
      if (Math.abs(n.scale / (p.scale || 1) - 1) * n.reachPx >= o.motionPx) return 'motion'
      if (Math.abs(n.o - p.o) >= FADE_STEP || Math.abs(n.eo - p.eo) >= EDGE_FADE_STEP) return 'fade'
    }
    return null
  }

  /** Record that `items` went to the map at `now`. */
  commit(items: GateItem[], now: number) {
    this.sent.clear()
    for (const n of items) this.sent.set(n.id, n)
    this.sentAt = now
    this.any = true
  }
}

/** Is a point inside a lon/lat box grown by `margin` (a fraction of its size) on every side? */
export function inBox(lon: number, lat: number, box: { west: number; south: number; east: number; north: number }, margin: number): boolean {
  const mx = (box.east - box.west) * margin
  const my = (box.north - box.south) * margin
  return lon >= box.west - mx && lon <= box.east + mx && lat >= box.south - my && lat <= box.north + my
}
