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
import { getShape, SHAPE_IDS, type ShapeId } from '../aircraft/shapes'

export { maskToSdf }

export type AircraftIcon = ShapeId

/**
 * Every icon fills the same box: 48 CSS px at `icon-size` 1, with the
 * drawing's longer side across 78% of it. `ICON_SCALE` then sizes the classes
 * against each other.
 */
const BOX = 48
const FILL = 0.78
/** Pixel size of the shaded artwork. Large, because close in the icons are drawn several times their base size (and twice that on retina). */
const ART = 384
/** Pixel size of the distance-field silhouettes; shadows are soft, so they can be coarse. */
const SDF = 96

const REFERENCE_LENGTH = 39.5 // the narrow-body drawing (737-800)

/**
 * Relative drawn size per class, so a 747 reads bigger than a Cessna. Real
 * size compressed (to the power 0.62, about what the reference app does), with
 * a floor so light aircraft and helicopters stay easy to see and tap (the
 * helicopter a little larger, so its rotor disc reads).
 */
export const ICON_SCALE = Object.fromEntries(
  SHAPE_IDS.map((id) => {
    const s = getShape(id)
    const rel = (Math.max(s.span, s.length) / REFERENCE_LENGTH) ** 0.62
    const floor = id === 'ac-vehicle' || id === 'ac-dot' ? 0 : id === 'ac-heli' ? 0.68 : 0.62
    const fixed: Partial<Record<ShapeId, number>> = { 'ac-vehicle': 0.4, 'ac-dot': 0.42 }
    return [id, Math.round((fixed[id] ?? Math.max(floor, rel)) * 1000) / 1000]
  }),
) as Record<AircraftIcon, number>

/** Rotor frames for helicopters in the air: the blades turn a third of a quarter-turn per frame. */
export const ROTOR_FRAMES = 3
const ROTOR_FRAME_MS = 70

/**
 * Image id to draw for an aircraft this frame: helicopters in the air cycle
 * through rotor frames (held still when motion is reduced).
 */
export function iconImage(icon: AircraftIcon, airborne: boolean, tMs: number, reduceMotion: boolean): string {
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

/** Which shape an image id belongs to (`ac-heli-r2-hi` → `ac-heli`), or null if it isn't an aircraft image. */
export function shapeOfImage(id: string): ShapeId | null {
  const base = id.replace(/-(hi|sdf)$/, '').replace(/-r\d+$/, '')
  return (SHAPE_IDS as string[]).includes(base) ? (base as ShapeId) : null
}

/**
 * Add one shape's images: shaded white, shaded yellow for the highlighted
 * aircraft, and a distance-field mask the shadow layer can tint and blur
 * (times the rotor frames for the helicopter). The shading is worked out once
 * and coloured twice.
 */
function addShape(map: MapLibreMap, id: ShapeId) {
  const shape = getShape(id)
  const maxDim = Math.max(shape.span, shape.length)
  const list = frames(id)
  const opts = { pixelRatio: ART / BOX }
  if (list.some((f) => !map.hasImage(f.id) || !map.hasImage(`${f.id}-hi`))) {
    const prepared = prepareAircraft(shape, { width: ART, height: ART, ppm: (ART * FILL) / maxDim, halo: true })
    for (const f of list) {
      if (!map.hasImage(f.id)) map.addImage(f.id, paintPrepared(prepared, 'white', f.angle), opts)
      if (!map.hasImage(`${f.id}-hi`)) map.addImage(`${f.id}-hi`, paintPrepared(prepared, 'yellow', f.angle), opts)
    }
  }
  for (const f of list) {
    if (map.hasImage(`${f.id}-sdf`)) continue
    const mask = silhouetteRGBA(shape, SDF, SDF, (SDF * FILL) / maxDim, f.angle)
    map.addImage(`${f.id}-sdf`, new ImageData(maskToSdf(mask.data, SDF, SDF) as Uint8ClampedArray<ArrayBuffer>, SDF, SDF), { sdf: true, pixelRatio: SDF / BOX })
  }
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
  const shape = id ? shapeOfImage(id) : null
  if (shape) addShape(map, shape)
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
