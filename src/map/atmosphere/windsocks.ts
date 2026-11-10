/**
 * Where the windsocks stand and how one is drawn. Real ones sit beside the
 * touchdown zone of each runway end, off to the left of the pilot, clear of
 * the pavement; that is where these go.
 */
import type { RunwayEndGeometry } from '../airportDiagram'
import { distanceM, offset, type LngLat } from '../geo'

/** Metres past the threshold, and clear of the runway edge, for each sock. */
const ALONG_M = 260
const CLEAR_M = 75
/** Two socks closer than this (crossing or close parallel runways) are one. */
const MERGE_M = 300

/** One windsock per runway end, merged where runway ends share a spot. */
export function windsockSites(ends: RunwayEndGeometry[]): LngLat[] {
  const out: LngLat[] = []
  for (const end of ends) {
    if (end.lengthM < 600) continue
    const b = (end.bearing * Math.PI) / 180
    const along = Math.min(ALONG_M, end.lengthM / 3)
    const cross = -(end.widthM / 2 + CLEAR_M)
    // Along the runway (sin, cos of the bearing) plus to its left (perpendicular).
    const east = along * Math.sin(b) + cross * Math.cos(b)
    const north = along * Math.cos(b) - cross * Math.sin(b)
    const p = offset(end.threshold, east, north)
    if (out.some((q) => distanceM(p, q) < MERGE_M)) continue
    out.push(p)
  }
  return out
}

/** Stripes of a windsock, from the pole outward: each stands for 3 knots. */
const STRIPES = ['#F26B21', '#F4F1EA', '#F26B21', '#F4F1EA', '#F26B21']

/**
 * Draw one sock seen from above at (x, y): a tapered tube from the pole
 * pointing along `angle` (screen radians, 0 = up), `length` px when fully out,
 * filled `ext` (0..1) of the way. A limp sock is a short stub hanging at the pole.
 */
export function drawWindsock(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, length: number, ext: number, alpha: number) {
  const len = length * (0.28 + 0.72 * ext)
  const w0 = Math.max(2.6, length * 0.24)
  // A hanging sock narrows toward the ground; a full one stays wide to its tail.
  const w1 = w0 * (0.42 + 0.33 * ext)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(x, y)
  // Soft ground shadow, down and to the right, as the aircraft shadows fall.
  ctx.save()
  ctx.translate(1.4, 2)
  ctx.rotate(angle)
  ctx.fillStyle = 'rgba(2,5,14,0.35)'
  taper(ctx, 0, -len, w0 * 1.1, w1 * 1.1)
  ctx.fill()
  ctx.restore()

  ctx.rotate(angle)
  const n = STRIPES.length
  for (let i = 0; i < n; i++) {
    const a = (i / n) * len
    const b = ((i + 1) / n) * len
    const wa = w0 + (w1 - w0) * (i / n)
    const wb = w0 + (w1 - w0) * ((i + 1) / n)
    ctx.fillStyle = STRIPES[i]
    taper(ctx, -a, -b, wa, wb)
    ctx.fill()
  }
  // The hoop at the mouth and the pole.
  ctx.fillStyle = '#2A2F3D'
  ctx.beginPath()
  ctx.arc(0, 0, Math.max(1.3, w0 * 0.32), 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Trapezoid from `y0` to `y1` along the local y axis (negative = forward). */
function taper(ctx: CanvasRenderingContext2D, y0: number, y1: number, w0: number, w1: number) {
  ctx.beginPath()
  ctx.moveTo(-w0 / 2, y0)
  ctx.lineTo(w0 / 2, y0)
  ctx.lineTo(w1 / 2, y1)
  ctx.lineTo(-w1 / 2, y1)
  ctx.closePath()
}
