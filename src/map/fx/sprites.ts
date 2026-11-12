/**
 * Bitmaps for the aircraft effects, drawn with canvas on first use (MapLibre
 * asks for missing ids through `styleimagemissing`). Every sprite is drawn
 * in the same frame as the aircraft artwork: centred on the aircraft, nose
 * up, 48 px box at `icon-size` 1. So a sprite drawn with the aircraft's own
 * size and rotation lands exactly on the airframe, at any zoom and heading.
 *
 *  - lights: navigation lights, strobes and beacon, one image per combination
 *    that is lit at a given instant, at three glow sizes for far/near/close;
 *  - the landing-light beam ahead of the nose;
 *  - engine exhaust shimmer behind the engines (two frames, alternated);
 *  - the fin patch that takes the airline colour (a distance field, tinted per feature);
 *  - a blurred silhouette for shadows of aircraft high up.
 */
import type { Map as MapLibreMap } from 'maplibre-gl'
import { maskToSdf } from '../../aircraft/distance'
import { blur } from '../../aircraft/render'
import { getShape, SHAPE_IDS, type ShapeId } from '../../aircraft/shapes'
import { anchorsFor, bankDegrees, bankSpanScale, BOX, FILL, toIconPx, type Anchors } from './geometry'

/** Light combinations: N navigation (red, green, white tail), S strobes, B beacon. */
export type LightBits = 'N' | 'NS' | 'NB' | 'NSB' | 'S' | 'B' | 'SB'
/** Glow size bands: far (wide view), near, close (artwork shown near life size). */
export type LightBand = 0 | 1 | 2

/** Zoom levels where the glow bands change; mirrored by the style's `step` expression. */
export const LIGHT_BAND_ZOOMS = [13.5, 16] as const

const PREFIX = {
  light: 'fx-lt-',
  land: 'fx-land-',
  exhaust: 'fx-ex-',
  fin: 'fx-fin-',
  blur: 'fx-blur-',
} as const

/**
 * Image id prefix for a light combination on an aircraft drawn level or
 * banked (`bank` is the artwork's bank tag, `bR2`), so the wingtip lights
 * stay on the foreshortened wingtips. The style appends the glow band
 * (`0`, `1`, `2`) by zoom.
 */
export function lightImage(shape: ShapeId, bits: LightBits, bank = ''): string {
  return `${PREFIX.light}${shape}-${bank ? `${bank}-` : ''}${bits}-`
}

export function exhaustImage(shape: ShapeId, frame: 0 | 1): string {
  return `${PREFIX.exhaust}${shape}-${frame}`
}

/**
 * Glow radii (core, halo) per band, in icon-box pixels. Small on purpose:
 * seen from above an aircraft's lights are pinpricks on the wingtips and
 * tail, not lamps. They should be found when looked for, never noticed first.
 */
const GLOW: Record<LightBand, [number, number]> = {
  0: [1.4, 4.6],
  1: [0.72, 2.4],
  2: [0.28, 0.95],
}

type Ctx = CanvasRenderingContext2D

/** A canvas `logical` px square (or `w`×`h`) at `ratio` pixels per logical px, origin at the centre. */
function canvas(w: number, h: number, ratio: number): Ctx {
  const c = document.createElement('canvas')
  c.width = Math.round(w * ratio)
  c.height = Math.round(h * ratio)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.setTransform(ratio, 0, 0, ratio, c.width / 2, c.height / 2)
  return ctx
}

function pixels(ctx: Ctx): ImageData {
  return ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height)
}

/** A light: a faint soft halo around a small core in the light's own colour (only part-whitened, so it never glares). `rgb` as "r,g,b". */
function glow(ctx: Ctx, x: number, y: number, rgb: string, core: number, halo: number, strength = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, halo)
  g.addColorStop(0, `rgba(${rgb},${0.56 * strength})`)
  g.addColorStop(0.25, `rgba(${rgb},${0.2 * strength})`)
  g.addColorStop(0.6, `rgba(${rgb},${0.05 * strength})`)
  g.addColorStop(1, `rgba(${rgb},0)`)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, halo, 0, Math.PI * 2)
  ctx.fill()
  const c = ctx.createRadialGradient(x, y, 0, x, y, core)
  c.addColorStop(0, `rgba(${whiten(rgb, 0.45)},${0.9 * strength})`)
  c.addColorStop(0.55, `rgba(${rgb},${0.7 * strength})`)
  c.addColorStop(1, `rgba(${rgb},0)`)
  ctx.fillStyle = c
  ctx.beginPath()
  ctx.arc(x, y, core, 0, Math.PI * 2)
  ctx.fill()
}

/** `rgb` mixed `k` of the way to white. */
function whiten(rgb: string, k: number): string {
  return rgb
    .split(',')
    .map((v) => Math.round(Number(v) + (255 - Number(v)) * k))
    .join(',')
}

// A little off the pure signal colours: softer on the eye against the navy map.
const RED = '255,84,76'
const GREEN = '92,236,160'
const WHITE = '255,246,226'
const STROBE = '232,240,255'
const BEACON = '255,72,64'

/** Room around the icon box for glows that spill past the wingtips. */
const LIGHT_BOX = 60

export function drawLights(a: Anchors, bits: string, band: LightBand, bankDeg = 0): ImageData {
  const ratio = band === 2 ? 4 : 2
  const ctx = canvas(LIGHT_BOX, LIGHT_BOX, ratio)
  const [core, halo] = GLOW[band]
  const [tip, ty] = toIconPx(a, a.wingtip)
  // Banked: each wingtip moves in by its wing's foreshortening (the lower wing more).
  const { low, high } = bankSpanScale(bankDeg)
  const right = tip * (bankDeg > 0 ? low : bankDeg < 0 ? high : 1)
  const left = tip * (bankDeg < 0 ? low : bankDeg > 0 ? high : 1)
  const [, tailY] = toIconPx(a, a.tail)
  if (bits.includes('N')) {
    glow(ctx, -left, ty, RED, core, halo)
    glow(ctx, right, ty, GREEN, core, halo)
    glow(ctx, 0, tailY, WHITE, core * 0.8, halo * 0.7, 0.7)
  }
  if (bits.includes('B')) {
    const [, by] = toIconPx(a, a.beacon)
    glow(ctx, 0, by, BEACON, core, halo * 1.1, 0.75)
  }
  if (bits.includes('S')) {
    // Strobes sit just behind the wingtip lights: a brief glint, only a touch brighter than the lights beside it.
    const back = core * 0.6
    glow(ctx, -left, ty + back, STROBE, core * 1.05, halo * 1.2, 0.8)
    glow(ctx, right, ty + back, STROBE, core * 1.05, halo * 1.2, 0.8)
    glow(ctx, 0, tailY + back, STROBE, core * 0.85, halo * 0.9, 0.6)
  }
  return pixels(ctx)
}

/** The landing-light pool is nothing but soft gradients, so one pixel per box pixel is plenty (it is uploaded again every frame, see `FIN_RATIO`). */
const LANDING_RATIO = 1

/**
 * The landing and taxi lights: a faint, warm pool of light on the ground
 * ahead of the nose. Shorter than the aircraft is long, and tungsten-warm
 * rather than white, so it reads as light falling on pavement and not as a
 * beam.
 */
export function drawLanding(a: Anchors): { data: ImageData; size: number } {
  const [, noseY] = toIconPx(a, a.nose)
  const reach = BOX * FILL * 0.82
  const size = Math.ceil(2 * (Math.abs(noseY) + reach + 4))
  const ctx = canvas(size, size, LANDING_RATIO)
  const cy = noseY - reach * 0.46
  ctx.save()
  ctx.translate(0, cy)
  ctx.scale(0.4, 1)
  const g = ctx.createRadialGradient(0, reach * 0.3, 0, 0, 0, reach * 0.62)
  g.addColorStop(0, 'rgba(255,236,198,0.26)')
  g.addColorStop(0.4, 'rgba(255,232,190,0.1)')
  g.addColorStop(0.75, 'rgba(255,230,186,0.035)')
  g.addColorStop(1, 'rgba(255,228,182,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, reach * 0.62, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  // The lamps themselves, in the wing roots / nose gear: a small warm point.
  const spot = ctx.createRadialGradient(0, noseY - 1, 0, 0, noseY - 1, 3)
  spot.addColorStop(0, 'rgba(255,244,220,0.55)')
  spot.addColorStop(1, 'rgba(255,240,212,0)')
  ctx.fillStyle = spot
  ctx.beginPath()
  ctx.arc(0, noseY - 1, 3, 0, Math.PI * 2)
  ctx.fill()
  return { data: pixels(ctx), size }
}

const EXHAUST_BOX = 72

/** Hot exhaust on the takeoff roll: faint, wavering smudges behind each engine. */
export function drawExhaust(a: Anchors, frame: 0 | 1): ImageData {
  const ctx = canvas(EXHAUST_BOX, EXHAUST_BOX, 2)
  const k = (BOX * FILL) / a.maxDim
  const len = Math.min(EXHAUST_BOX / 2 - 2, 0.42 * a.maxDim * k + 6)
  for (const [x, , yExit] of a.engines) {
    for (const side of [-1, 1]) {
      const ex = side * x * k
      const ey = yExit * k
      const wobble = frame === 0 ? 0.6 : -0.6
      const w = Math.max(1.6, 1.3 * k)
      ctx.save()
      ctx.translate(ex + wobble * side * 0.4, ey + len * 0.5)
      ctx.scale(w / len, 1)
      const g = ctx.createRadialGradient(0, -len * 0.3, 0, 0, 0, len * (frame === 0 ? 0.55 : 0.5))
      g.addColorStop(0, 'rgba(232,236,244,0.34)')
      g.addColorStop(0.5, 'rgba(226,232,242,0.13)')
      g.addColorStop(1, 'rgba(220,228,240,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(0, 0, len * 0.6, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }
  return pixels(ctx)
}

/**
 * Pixels per icon-box pixel for the fin. A distance field stays crisp when
 * scaled up, and every sprite the aircraft use is uploaded again each frame
 * (see `ART_TIERS` in mapStyle), so it is kept small.
 */
const FIN_RATIO = 2

/** The fin patch as a distance field, so one image takes any airline's colour. */
export function drawFin(a: Anchors): ImageData | null {
  if (!a.fin) return null
  const ctx = canvas(BOX, BOX, FIN_RATIO)
  const k = (BOX * FILL) / a.maxDim
  const { y0, y1, w0, w1 } = a.fin
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.moveTo(-w0 * k, y0 * k)
  ctx.lineTo(w0 * k, y0 * k)
  ctx.lineTo(w1 * k, y1 * k)
  ctx.lineTo(-w1 * k, y1 * k)
  ctx.closePath()
  ctx.fill()
  const img = pixels(ctx)
  // The falloff spans the same 2 box pixels whatever the resolution, so the edge renders the same.
  return new ImageData(maskToSdf(img.data, img.width, img.height, 2 * FIN_RATIO) as Uint8ClampedArray<ArrayBuffer>, img.width, img.height)
}

const BLUR_RATIO = 2

/** A soft black silhouette for the shadow of an aircraft well above the ground. */
export function drawBlurredShadow(shape: ShapeId): ImageData {
  const s = getShape(shape)
  const n = BOX * BLUR_RATIO
  const ctx = canvas(BOX, BOX, BLUR_RATIO)
  const k = (BOX * FILL) / Math.max(s.span, s.length)
  ctx.scale(k, k)
  ctx.fillStyle = '#000'
  ctx.fill(new Path2D(s.outline))
  if (s.rotor) {
    ctx.globalAlpha = 0.35
    ctx.beginPath()
    ctx.arc(s.rotor[0], s.rotor[1], s.rotor[2], 0, Math.PI * 2)
    ctx.fill()
  }
  const img = pixels(ctx)
  const alpha = new Float32Array(n * n)
  for (let i = 0; i < n * n; i++) alpha[i] = img.data[i * 4 + 3] / 255
  const soft = blur(alpha, n, n, 2.6 * BLUR_RATIO)
  const out = new ImageData(n, n)
  for (let i = 0; i < n * n; i++) out.data[i * 4 + 3] = Math.round(255 * Math.min(1, soft[i] * 1.1))
  return out
}

/** Which shape an effect image id is for, and what to draw, or null if the id isn't an effect image. */
export function parseFxImage(id: string): { kind: keyof typeof PREFIX; shape: ShapeId; rest: string } | null {
  for (const [kind, prefix] of Object.entries(PREFIX) as [keyof typeof PREFIX, string][]) {
    if (!id.startsWith(prefix)) continue
    const body = id.slice(prefix.length)
    // Longest shape id first: `ac-twin-piston` before a shorter id that prefixes it.
    const shape = [...SHAPE_IDS].sort((x, y) => y.length - x.length).find((s) => body === s || body.startsWith(`${s}-`))
    if (!shape) return null
    return { kind, shape, rest: body.slice(shape.length + 1) }
  }
  return null
}

/** Draw and register an effect image MapLibre asked for. Returns false if `id` isn't one. */
export function ensureFxImage(map: MapLibreMap, id: string): boolean {
  const p = parseFxImage(id)
  if (!p) return false
  if (map.hasImage(id)) return true
  const a = anchorsFor(p.shape)
  switch (p.kind) {
    case 'light': {
      const m = /^(?:(b[LR][12])-)?([NSB]+)-([012])$/.exec(p.rest)
      if (!m) return false
      const band = Number(m[3]) as LightBand
      map.addImage(id, drawLights(a, m[2], band, bankDegrees(m[1])), { pixelRatio: band === 2 ? 4 : 2 })
      return true
    }
    case 'land': {
      const { data } = drawLanding(a)
      map.addImage(id, data, { pixelRatio: LANDING_RATIO })
      return true
    }
    case 'exhaust':
      map.addImage(id, drawExhaust(a, p.rest === '1' ? 1 : 0), { pixelRatio: 2 })
      return true
    case 'fin': {
      const data = drawFin(a)
      // A class without a livery still needs an image so MapLibre stops asking; an empty field draws nothing.
      map.addImage(id, data ?? new ImageData(1, 1), { sdf: true, pixelRatio: data ? FIN_RATIO : 1 })
      return true
    }
    case 'blur':
      map.addImage(id, drawBlurredShadow(p.shape), { pixelRatio: BLUR_RATIO })
      return true
  }
}
