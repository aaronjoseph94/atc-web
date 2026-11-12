/**
 * Every bitmap the map style references, drawn at runtime with canvas so the
 * app ships no image assets:
 *
 *  - aircraft, one drawing per broad airframe class (see `src/aircraft`), as
 *    shaded artwork in white and in yellow (the highlighted aircraft), plus a
 *    signed-distance-field silhouette of each for the soft shadow;
 *  - the callsign tag plates.
 */
import type { Map as MapLibreMap } from 'maplibre-gl'
import { shapeFor } from '../aircraft/classify'
import { maskToSdf } from '../aircraft/distance'
import { paintPrepared, prepareAircraft, silhouetteRGBA } from '../aircraft/render'
import { getShape, SHAPE_IDS, type Shape, type ShapeId } from '../aircraft/shapes'
import { drawVehicle, VEHICLE_KINDS, VEHICLE_MAX_LENGTH, vehicleDrawScale, vehicleKind, vehicleOutline, type VehicleKind } from '../aircraft/vehicles'
import { BANK_DRAWN, bankSpanScale } from './fx/geometry'
import { ensureFxImage } from './fx/sprites'
import { ART_PX, artTierPx, artTiers } from './mapStyle'

export { maskToSdf }

export type AircraftIcon = ShapeId

/**
 * Every icon fills the same box: 48 CSS px at `icon-size` 1, with the
 * drawing's longer side across 78% of it. `ICON_SCALE` then sizes the classes
 * against each other.
 */
const BOX = 48
const FILL = 0.78
/** Half the drawing's longer side in CSS px at `icon-size` 1: how far an aircraft's artwork reaches from its point. */
export const ICON_REACH_PX = (BOX * FILL) / 2
/** Pixel size of the shaded artwork. Large, because close in the icons are drawn several times their base size (and twice that on retina). */
const ART = ART_PX
/** Pixel size of the distance-field silhouettes; shadows are soft, so they can be coarse. */
const SDF = 96

const REFERENCE_LENGTH = 39.5 // the narrow-body drawing (737-800)

/**
 * Relative drawn size per class, so a 747 reads bigger than a Cessna. Real
 * size compressed (to the power 0.62, about what the reference app does), with
 * a floor so light aircraft and helicopters stay easy to see and tap (the
 * helicopter a little larger, so its rotor disc reads). Vehicles follow the
 * same rule from the longest of them (a fire engine); the smaller ones are
 * drawn smaller inside the same box (`vehicleDrawScale`).
 */
export const ICON_SCALE = Object.fromEntries(
  SHAPE_IDS.map((id) => {
    const s = getShape(id)
    const rel = ((id === 'ac-vehicle' ? VEHICLE_MAX_LENGTH : Math.max(s.span, s.length)) / REFERENCE_LENGTH) ** 0.62
    const floor = id === 'ac-vehicle' || id === 'ac-dot' ? 0 : id === 'ac-heli' ? 0.68 : 0.62
    // The dot (a parked aircraft nobody knows the heading of) is kept small: a row of them shouldn't outweigh the aircraft drawn around it.
    const fixed: Partial<Record<ShapeId, number>> = { 'ac-dot': 0.35 }
    return [id, Math.round((fixed[id] ?? Math.max(floor, rel)) * 1000) / 1000]
  }),
) as Record<AircraftIcon, number>

/** The artwork sizes to draw for a class: full, and each reduced copy (its suffix appended to every id; see `artTiers`). */
function artSizes(id: ShapeId): { px: number; suffix: string }[] {
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1
  return [{ px: ART, suffix: '' }, ...artTiers().map((t) => ({ px: artTierPx(t.below, ICON_SCALE[id], dpr), suffix: t.suffix }))]
}

/** Rotor frames for helicopters in the air: the blades turn a third of a quarter-turn per frame. */
export const ROTOR_FRAMES = 3
const ROTOR_FRAME_MS = 70

/** Image id suffix per kind of vehicle (the operations car is the plain `ac-vehicle`). */
const VEHICLE_SUFFIX: Record<VehicleKind, string> = { car: '', tug: '-vt', truck: '-vs', fire: '-vf' }

/**
 * Image id to draw for an aircraft this frame: helicopters in the air cycle
 * through rotor frames (held still when motion is reduced), and a ground
 * vehicle (`who`) gets the drawing for its kind: tug, truck, fire engine or car.
 */
export function iconImage(icon: AircraftIcon, airborne: boolean, tMs: number, reduceMotion: boolean, who?: { category?: string | null; callsign?: string | null }): string {
  if (icon === 'ac-vehicle') return who ? `${icon}${VEHICLE_SUFFIX[vehicleKind(who)]}` : icon
  if (icon !== 'ac-heli' || !airborne || reduceMotion) return icon
  const f = Math.floor(tMs / ROTOR_FRAME_MS) % ROTOR_FRAMES
  return f === 0 ? icon : `${icon}-r${f}`
}

/** Image ids drawn from one shape: the shape itself, plus rotor frames for the helicopter, each with its rotor angle. */
function frames(shape: ShapeId): { id: string; angle: number }[] {
  // Blades start on the diagonals, like an X over the cabin.
  const base = Math.PI / 4
  if (shape !== 'ac-heli') return [{ id: shape, angle: base }]
  return Array.from({ length: ROTOR_FRAMES }, (_, f) => ({ id: f === 0 ? shape : `${shape}-r${f}`, angle: base + (f * Math.PI) / 2 / ROTOR_FRAMES }))
}

/** Which shape an image id belongs to (`ac-heli-r2-hi` → `ac-heli`, `ac-jet-bL2-sdf` → `ac-jet`), or null if it isn't an aircraft image. */
export function shapeOfImage(id: string): ShapeId | null {
  const base = id
    .replace(/~[a-z]$/, '')
    .replace(/-(hi|sdf)$/, '')
    .replace(/-(pk|b[LR][12])$/, '')
    .replace(/-r\d+$/, '')
    .replace(/-v[tsf]$/, '')
  return (SHAPE_IDS as string[]).includes(base) ? (base as ShapeId) : null
}

/** The bank variant an image id asks for (`ac-jet-bR2-hi` → right, steep), or null. */
export function bankOfImage(id: string): { dir: 'L' | 'R'; level: 1 | 2 } | null {
  const m = /-b([LR])([12])(?:-(?:hi|sdf))?(?:~[a-z])?$/.exec(id)
  return m ? { dir: m[1] as 'L' | 'R', level: Number(m[2]) as 1 | 2 } : null
}

/**
 * Add one shape's images: shaded white, shaded yellow for the highlighted
 * aircraft, and a distance-field mask the shadow layer can tint and blur
 * (times the rotor frames for the helicopter). The shading is worked out once
 * and coloured twice.
 */
function addShape(map: MapLibreMap, id: ShapeId) {
  if (id === 'ac-vehicle') return addVehicles(map)
  const shape = getShape(id)
  const maxDim = Math.max(shape.span, shape.length)
  const list = frames(id)
  for (const { px, suffix } of artSizes(id)) {
    const has = (x: string) => map.hasImage(`${x}${suffix}`)
    const add = (x: string, img: ImageData) => map.addImage(`${x}${suffix}`, img, { pixelRatio: px / BOX })
    if (list.every((f) => has(f.id) && has(`${f.id}-hi`)) && has(`${id}-pk`)) continue
    const prepared = prepareAircraft(shape, { width: px, height: px, ppm: (px * FILL) / maxDim, halo: true })
    for (const f of list) {
      if (!has(f.id) || (f.id === id && !has(`${id}-pk`))) {
        const white = paintPrepared(prepared, 'white', f.angle)
        if (!has(f.id)) add(f.id, white)
        // Parked aircraft use a greyer, flatter copy (see `parkedTone`).
        if (f.id === id && !has(`${id}-pk`)) add(`${id}-pk`, parkedTone(white))
      }
      if (!has(`${f.id}-hi`)) add(`${f.id}-hi`, paintPrepared(prepared, 'yellow', f.angle))
    }
  }
  for (const f of list) {
    if (map.hasImage(`${f.id}-sdf`)) continue
    const mask = silhouetteRGBA(shape, SDF, SDF, (SDF * FILL) / maxDim, f.angle)
    map.addImage(`${f.id}-sdf`, new ImageData(maskToSdf(mask.data, SDF, SDF) as Uint8ClampedArray<ArrayBuffer>, SDF, SDF), { sdf: true, pixelRatio: SDF / BOX })
  }
}

/**
 * Ground vehicles: one drawing per kind (`src/aircraft/vehicles.ts`), in its
 * own colours, with a yellow-rimmed copy for the highlighted one and a mask
 * for the shadow. All share the `ac-vehicle` box, sized for the longest.
 */
function addVehicles(map: MapLibreMap) {
  const paint = (kind: VehicleKind, px: number, how: 'plain' | 'selected' | 'mask'): ImageData => {
    const canvas = document.createElement('canvas')
    canvas.width = px
    canvas.height = px
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const ppm = ((px * FILL) / VEHICLE_MAX_LENGTH) * vehicleDrawScale(kind)
    ctx.setTransform(ppm, 0, 0, ppm, px / 2, px / 2)
    if (how === 'mask') {
      ctx.fillStyle = '#fff'
      vehicleOutline(ctx, kind)
      ctx.fill()
    } else drawVehicle(ctx, kind, how === 'selected')
    return ctx.getImageData(0, 0, px, px)
  }
  for (const kind of VEHICLE_KINDS) {
    const id = `ac-vehicle${VEHICLE_SUFFIX[kind]}`
    for (const { px, suffix } of artSizes('ac-vehicle')) {
      if (!map.hasImage(`${id}${suffix}`)) map.addImage(`${id}${suffix}`, paint(kind, px, 'plain'), { pixelRatio: px / BOX })
      if (!map.hasImage(`${id}-hi${suffix}`)) map.addImage(`${id}-hi${suffix}`, paint(kind, px, 'selected'), { pixelRatio: px / BOX })
    }
    if (!map.hasImage(`${id}-sdf`)) {
      const mask = paint(kind, SDF, 'mask')
      map.addImage(`${id}-sdf`, new ImageData(maskToSdf(mask.data, SDF, SDF) as Uint8ClampedArray<ArrayBuffer>, SDF, SDF), { sdf: true, pixelRatio: SDF / BOX })
    }
  }
}

/**
 * Parked aircraft: the white artwork drained a little toward a neutral grey
 * and darkened, so a parked aircraft drawn nearly opaque reads as switched off
 * rather than as a faded, blue-tinted ghost of a moving one.
 */
export function parkedTone(src: ImageData): ImageData {
  const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height)
  const d = out.data
  for (let i = 0; i < d.length; i += 4) {
    const grey = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]
    for (let c = 0; c < 3; c++) d[i + c] = (grey * 0.35 + d[i + c] * 0.65) * 0.8
  }
  return out
}

// ---------------------------------------------------------------------------
// Banked artwork
// ---------------------------------------------------------------------------

/** Classes drawn banked; helicopters, vehicles and markers aren't. */
const BANKS = new Set<ShapeId>(SHAPE_IDS.filter((id) => id !== 'ac-heli' && id !== 'ac-vehicle' && id !== 'ac-dot'))

/**
 * The outline of an aircraft rolled `deg` degrees (positive: right wing
 * down), seen from above (see `bankSpanScale`). The fuselage barely changes.
 */
export function bankShape(shape: Shape, deg: number): Shape {
  const lowSide = Math.sign(deg) // +1: the right (x > 0) wing is the lower one
  const { low, high } = bankSpanScale(deg)
  const tx = (x: number) => x * (Math.sign(x) === lowSide ? low : high)
  const map = (path: string) => path.replace(/(-?\d*\.?\d+) (-?\d*\.?\d+)/g, (_, x: string, y: string) => `${Math.round(tx(Number(x)) * 100) / 100} ${y}`)
  return { ...shape, outline: map(shape.outline), body: shape.body ? map(shape.body) : null, over: shape.over.map(map) }
}

/** Shade the lower wing a touch darker and the raised one a touch brighter, as the light now falls on them. */
function bankLight(img: ImageData, deg: number): ImageData {
  const { width: w, height: h, data } = img
  const k = 0.16 * Math.sin((Math.abs(deg) * Math.PI) / 180) * 2.2
  const lowSide = Math.sign(deg)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xn = (x - w / 2) / (w / 2)
      const f = 1 - lowSide * k * xn
      const i = (y * w + x) * 4
      for (let c = 0; c < 3; c++) data[i + c] = data[i + c] * f
    }
  }
  return img
}

function addBank(map: MapLibreMap, id: ShapeId, dir: 'L' | 'R', level: 1 | 2) {
  const vid = `${id}-b${dir}${level}`
  const deg = BANK_DRAWN[level] * (dir === 'R' ? 1 : -1)
  const shape = bankShape(getShape(id), deg)
  const maxDim = Math.max(getShape(id).span, getShape(id).length)
  for (const { px, suffix } of artSizes(id)) {
    const opts = { pixelRatio: px / BOX }
    const white = `${vid}${suffix}`
    const yellow = `${vid}-hi${suffix}`
    if (map.hasImage(white) && map.hasImage(yellow)) continue
    const prepared = prepareAircraft(shape, { width: px, height: px, ppm: (px * FILL) / maxDim, halo: true })
    if (!map.hasImage(white)) map.addImage(white, bankLight(paintPrepared(prepared, 'white', Math.PI / 4), deg), opts)
    if (!map.hasImage(yellow)) map.addImage(yellow, bankLight(paintPrepared(prepared, 'yellow', Math.PI / 4), deg), opts)
  }
  if (!map.hasImage(`${vid}-sdf`)) {
    const mask = silhouetteRGBA(shape, SDF, SDF, (SDF * FILL) / maxDim)
    map.addImage(`${vid}-sdf`, new ImageData(maskToSdf(mask.data, SDF, SDF) as Uint8ClampedArray<ArrayBuffer>, SDF, SDF), { sdf: true, pixelRatio: SDF / BOX })
  }
}

/** Banked drawings waiting to be shaded, drawn one at a time when the browser is idle. */
const bankQueue = new Map<string, () => void>()
let bankScheduled = false

function drainBanks() {
  bankScheduled = false
  const next = bankQueue.entries().next()
  if (next.done) return
  const [key, run] = next.value
  bankQueue.delete(key)
  run()
  scheduleBanks()
}

function scheduleBanks() {
  if (bankScheduled || bankQueue.size === 0) return
  bankScheduled = true
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  if (idle) idle(drainBanks, { timeout: 1500 })
  else setTimeout(drainBanks, 60)
}

/**
 * The image to draw for an aircraft banked to `level` (0, ±1, ±2; positive =
 * turning right). Banked drawings take tens of milliseconds to shade, so the
 * first time one is wanted it is queued for idle time and the level drawing
 * is used meanwhile: a turn never makes an aircraft blink out or stutter.
 */
export function bankedImage(map: MapLibreMap, image: string, level: number): string {
  if (level === 0) return image
  const shape = shapeOfImage(image)
  if (!shape || !BANKS.has(shape) || image !== shape) return image
  const dir = level > 0 ? 'R' : 'L'
  const mag = Math.min(2, Math.abs(level)) as 1 | 2
  const vid = `${shape}-b${dir}${mag}`
  const ready = (v: string) => map.hasImage(`${v}-sdf`) && [{ suffix: '' }, ...artTiers()].every((t) => map.hasImage(`${v}${t.suffix}`) && map.hasImage(`${v}-hi${t.suffix}`))
  if (ready(vid)) return vid
  if (!bankQueue.has(vid)) {
    bankQueue.set(vid, () => {
      // The map may have gone (airport change, unmount) by the time this runs.
      try {
        if (map.getStyle()) addBank(map, shape, dir, mag)
      } catch {
        // Nothing to draw into; the level drawing stays in use.
      }
    })
    scheduleBanks()
  }
  // A steep bank that isn't drawn yet can borrow the slight one.
  const slight = `${shape}-b${dir}1`
  return mag === 2 && ready(slight) ? slight : image
}

// ---------------------------------------------------------------------------
// Stretchable plates
// ---------------------------------------------------------------------------

type Plate = { fill: string; stroke?: string; strokeWidth?: number; radius: number }

/** Callsign tag plates. */
const PLATES: Record<string, Plate> = {
  // Gate numbers on the terminals: bright amber chips.
  'gate-chip': { fill: '#F5B93D', radius: 3 },
  tag: { fill: 'rgba(58,66,90,0.92)', stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1, radius: 8 },
  // The highlighted aircraft's tag takes the flight card's purple.
  'tag-active': { fill: '#5B3DF5', stroke: 'rgba(255,255,255,0.35)', strokeWidth: 1, radius: 8 },
}

function plate(p: Plate): { data: ImageData; inset: number } {
  const s = 32
  const canvas = document.createElement('canvas')
  canvas.width = s
  canvas.height = s
  const ctx = canvas.getContext('2d')!
  const sw = p.strokeWidth ?? 0
  ctx.beginPath()
  ctx.roundRect(sw / 2, sw / 2, s - sw, s - sw, p.radius)
  ctx.fillStyle = p.fill
  ctx.fill()
  if (p.stroke) {
    ctx.lineWidth = sw
    ctx.strokeStyle = p.stroke
    ctx.stroke()
  }
  return { data: ctx.getImageData(0, 0, s, s), inset: Math.ceil(p.radius + sw) }
}

/**
 * Register the images the style uses. Safe to call again (e.g. after a context
 * restore). Aircraft artwork takes a few tens of milliseconds per class to
 * shade, so with `id` (from MapLibre's `styleimagemissing`) only that class is
 * drawn; without it, only the classes in `eager` are drawn up front.
 */
export function ensureMapImages(map: MapLibreMap, id?: string, eager: ShapeId[] = ['ac-jet']) {
  // Effect sprites (lights, exhaust, fin colour, soft shadows) are cheap and drawn on request.
  if (id && ensureFxImage(map, id)) return
  const shape = id ? shapeOfImage(id) : null
  const bank = id ? bankOfImage(id) : null
  // A banked drawing asked for by id (normally they are queued, see `bankedImage`; this is after a context loss).
  if (shape && bank) addBank(map, shape, bank.dir, bank.level)
  else if (shape) addShape(map, shape)
  else if (!id) for (const s of eager) addShape(map, s)
  for (const [plateId, p] of Object.entries(PLATES)) {
    if (map.hasImage(plateId)) continue
    const { data, inset } = plate(p)
    const s = data.width
    map.addImage(plateId, data, {
      pixelRatio: 2,
      stretchX: [[inset, s - inset]],
      stretchY: [[inset, s - inset]],
      content: [inset, inset, s - inset, s - inset],
    })
  }
}

/**
 * Pick a drawing from the type designator when we have one, else from the
 * ADS-B emitter category, else assume an airliner. See `src/aircraft/classify.ts`.
 */
export function iconFor(a: { type?: string | null; category?: string | null; headingKnown?: boolean; onGround: boolean; speedKt: number | null }): AircraftIcon {
  return shapeFor(a)
}
