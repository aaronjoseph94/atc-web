/**
 * Small generated images for the surface detail: a pavement grain tile, the
 * animated sheen that drifts over water, and the soft blob cloud shadows are
 * stamped from. All made in code so nothing extra is downloaded.
 */
import type { Map as MapLibreMap, StyleImageInterface } from 'maplibre-gl'

/** Deterministic random numbers, so the grain looks the same on every load. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const NOISE_IMAGE = 'atmo-pavement-grain'
export const SHEEN_IMAGE = 'atmo-water-sheen'
const NOISE_PX = 128

/**
 * Concrete and asphalt grain: mostly transparent, with sparse light and dark
 * flecks and a faint blotchiness, so it only shows as texture up close.
 */
export function pavementGrain(size = NOISE_PX, seed = 7): Uint8Array {
  const rand = mulberry32(seed)
  const data = new Uint8Array(size * size * 4)
  // A coarse blotch field (8 px cells, smoothly blended) under the fine grain.
  const cells = size / 8
  const blotch = Array.from({ length: cells * cells }, () => rand())
  const at = (cx: number, cy: number) => blotch[((cy + cells) % cells) * cells + ((cx + cells) % cells)]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x / 8
      const fy = y / 8
      const ix = Math.floor(fx)
      const iy = Math.floor(fy)
      const tx = fx - ix
      const ty = fy - iy
      const b = (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty
      const r = rand()
      const i = (y * size + x) * 4
      if (r < 0.07) {
        // Light aggregate.
        data.set([214, 222, 240, 5 + Math.round(rand() * 8)], i)
      } else if (r < 0.16) {
        // Dark pits and tar.
        data.set([0, 2, 10, 8 + Math.round(rand() * 11)], i)
      } else {
        // The blotches: a shade lighter or darker than the pavement.
        const d = b - 0.5
        data.set(d > 0 ? [200, 210, 232, Math.round(d * 10)] : [0, 2, 10, Math.round(-d * 14)], i)
      }
    }
  }
  return data
}

/** Add the grain tile to the map once. */
export function addPavementGrain(map: MapLibreMap) {
  if (map.hasImage(NOISE_IMAGE)) return
  // Drawn at half size, so each fleck is a single device pixel on a retina screen.
  map.addImage(NOISE_IMAGE, { width: NOISE_PX, height: NOISE_PX, data: pavementGrain() }, { pixelRatio: 2 })
}

/** Size of the sheen tile in image pixels; it is shown 8× larger (512 px), as it is all soft gradient. */
const SHEEN_PX = 64
const SHEEN_SCALE = 0.125
/** Three slow waves across the tile (whole cycles per tile, so it repeats seamlessly). */
const WAVES: [number, number, number, number][] = [
  // kx, ky (cycles per tile), speed (radians per second), weight
  [1, 2, 0.21, 1],
  [2, -1, -0.16, 0.8],
  [3, 1, 0.12, 0.45],
]
/** At most this many redraws a second: the motion is slow, and each redraw re-uploads the tile. */
const SHEEN_FPS = 6

/**
 * A slow, soft specular sheen for the water, as a pattern image that redraws
 * itself (MapLibre calls `render` before each frame). `strength` (0..1) scales
 * it: full on a clear day, faint under overcast or at night; `animate` false
 * freezes it (reduced motion, hidden tab).
 */
export class WaterSheen implements StyleImageInterface {
  width = SHEEN_PX
  height = SHEEN_PX
  data = new Uint8Array(SHEEN_PX * SHEEN_PX * 4)
  strength = 1
  animate = true
  private last = -1
  private drawnStrength = -1
  // Each wave is sin(ax + by - wt): split into per-column and per-row terms so a redraw is only multiply-adds.
  private readonly sx: Float32Array[]
  private readonly cx: Float32Array[]

  constructor() {
    this.sx = WAVES.map(([kx]) => Float32Array.from({ length: SHEEN_PX }, (_, x) => Math.sin((2 * Math.PI * kx * x) / SHEEN_PX)))
    this.cx = WAVES.map(([kx]) => Float32Array.from({ length: SHEEN_PX }, (_, x) => Math.cos((2 * Math.PI * kx * x) / SHEEN_PX)))
    this.draw(0)
  }

  render(): boolean {
    const now = performance.now()
    if (!this.animate) {
      if (this.drawnStrength === this.strength) return false
      this.draw(this.last < 0 ? 0 : this.last)
      return true
    }
    if (now - this.last < 1000 / SHEEN_FPS && this.drawnStrength === this.strength) return false
    this.last = now
    this.draw(now)
    return true
  }

  private draw(now: number) {
    const t = now / 1000
    const n = SHEEN_PX
    const total = WAVES.reduce((s, w) => s + w[3], 0)
    const peak = 15 * this.strength
    const rows = WAVES.map(([, ky, w]) => {
      const sy = new Float32Array(n)
      const cy = new Float32Array(n)
      for (let y = 0; y < n; y++) {
        const p = (2 * Math.PI * ky * y) / n - w * t
        sy[y] = Math.sin(p)
        cy[y] = Math.cos(p)
      }
      return { sy, cy }
    })
    const d = this.data
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let v = 0
        for (let k = 0; k < WAVES.length; k++) v += WAVES[k][3] * (this.sx[k][x] * rows[k].cy[y] + this.cx[k][x] * rows[k].sy[y])
        // Only the crests catch the light, with a soft shoulder.
        const c = Math.max(0, v / total - 0.3) / 0.7
        const i = (y * n + x) * 4
        d[i] = 196
        d[i + 1] = 218
        d[i + 2] = 255
        d[i + 3] = Math.round(peak * c * c * (3 - 2 * c))
      }
    }
    this.drawnStrength = this.strength
  }
}

export function addWaterSheen(map: MapLibreMap, sheen: WaterSheen) {
  if (map.hasImage(SHEEN_IMAGE)) map.removeImage(SHEEN_IMAGE)
  map.addImage(SHEEN_IMAGE, sheen, { pixelRatio: SHEEN_SCALE })
}

const sheens = new WeakMap<MapLibreMap, WaterSheen>()

/** The map's water sheen, made on first use (the style's water asks for it before the atmosphere layer mounts). */
export function waterSheenFor(map: MapLibreMap): WaterSheen {
  let s = sheens.get(map)
  if (!s) {
    s = new WaterSheen()
    sheens.set(map, s)
  }
  return s
}

/** Draw the surface pattern images on request (see `imageResolver`). */
export function surfaceImage(map: MapLibreMap, id: string) {
  if (id === NOISE_IMAGE) addPavementGrain(map)
  else if (id === SHEEN_IMAGE && !map.hasImage(SHEEN_IMAGE)) map.addImage(SHEEN_IMAGE, waterSheenFor(map), { pixelRatio: SHEEN_SCALE })
}

/** A soft round blob (opaque black centre fading to nothing) to stamp cloud shadows with. */
export function blobSprite(size = 64): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  // A gentle bell curve rather than a linear ramp, so no edge is visible.
  for (let i = 0; i <= 8; i++) {
    const r = i / 8
    const a = (Math.exp(-4.2 * r * r) - Math.exp(-4.2)) / (1 - Math.exp(-4.2))
    grad.addColorStop(r, `rgba(0,0,0,${a.toFixed(3)})`)
  }
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  return c
}
