/**
 * Paints an aircraft class as shaded top-view artwork, for the map icons and
 * for the illustration in the flight view.
 *
 * The look is built like a cheap relief render: every part (the whole
 * silhouette, the fuselage, and parts that sit on top of it) becomes a height
 * field from its distance-to-edge, so edges round over, the fuselage reads as a
 * tube and engine pods as cylinders; that is lit by one soft light, slightly
 * from the front and left, with a gloss highlight. The fuselage and the parts
 * above it also cast a soft contact shadow on what lies below. The light is
 * nearly overhead on purpose: map icons rotate with the heading, so a strong
 * side light would look wrong on half of them.
 *
 * The geometry and lighting (`prepareAircraft`) are worked out once and then
 * coloured per tone (`paintPrepared`), which is the cheap part.
 */
import { insideDistance } from './distance'
import type { Shape } from './shapes'

export type Tone = 'white' | 'yellow'

type RGB = [number, number, number]

/** Shadow side, flat surface, and fully lit; sampled from the reference renders. */
export const TONES: Record<Tone, { dark: RGB; base: RGB; light: RGB; rotor: string; rotorEdge: string; hub: string; disc: string }> = {
  white: { dark: [116, 122, 134], base: [225, 227, 231], light: [255, 255, 255], rotor: 'rgba(226,230,238,0.95)', rotorEdge: 'rgba(40,46,60,0.55)', hub: '#8D96A8', disc: '220,228,245' },
  yellow: { dark: [176, 116, 22], base: [246, 194, 82], light: [255, 236, 170], rotor: 'rgba(255,220,130,0.95)', rotorEdge: 'rgba(90,56,0,0.55)', hub: '#C98A1C', disc: '255,214,110' },
}

export type RenderOptions = {
  /** Canvas size, pixels. */
  width: number
  height: number
  /** Pixels per metre. */
  ppm: number
  tone: Tone
  /** Rotor blade angle, radians (helicopters only). */
  rotorAngle?: number
  /** A faint dark rim just outside the silhouette, so white art holds up on light map themes. */
  halo?: boolean
}

type Geometry = Omit<RenderOptions, 'tone' | 'rotorAngle'>

// Light from slightly ahead and to the left, mostly overhead.
const LIGHT = norm([-0.22, -0.4, 0.89])
const HALF = norm([LIGHT[0], LIGHT[1], LIGHT[2] + 1])

function norm(v: number[]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}

function makeCanvas(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c.getContext('2d', { willReadFrequently: true })!
}

/** Rasterise path data (metres) into an alpha array, with the aircraft centred. */
function alphaOf(ctx: CanvasRenderingContext2D, o: Geometry, paths: string[]): Float32Array {
  const { width: w, height: h } = o
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.setTransform(o.ppm, 0, 0, o.ppm, w / 2, h / 2)
  ctx.fillStyle = '#fff'
  for (const p of paths) ctx.fill(new Path2D(p))
  const d = ctx.getImageData(0, 0, w, h).data
  const a = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) a[i] = d[i * 4 + 3] / 255
  return a
}

/** Separable box blur, run twice (close to a gaussian). */
export function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const rad = Math.max(1, Math.round(r))
  const inv = 1 / (2 * rad + 1)
  let a = src
  const b = new Float32Array(w * h)
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      let acc = 0
      const row = y * w
      for (let x = -rad; x <= rad; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))]
      for (let x = 0; x < w; x++) {
        b[row + x] = acc * inv
        acc += a[row + Math.min(w - 1, x + rad + 1)] - a[row + Math.max(0, x - rad)]
      }
    }
    const c = new Float32Array(w * h)
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let y = -rad; y <= rad; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x]
      for (let y = 0; y < h; y++) {
        c[y * w + x] = acc * inv
        acc += b[Math.min(h - 1, y + rad + 1) * w + x] - b[Math.max(0, y - rad) * w + x]
      }
    }
    a = c
  }
  return a
}

/**
 * Rounded-edge height field: rises over `radius` pixels from the edge, flat
 * beyond. `radius` gets the part's greatest inside distance, so a part can
 * round over completely (a tube) by returning it.
 */
function heights(alpha: Float32Array, w: number, h: number, radius: (deepest: number) => number, smooth: number): Float32Array {
  const d = insideDistance(alpha, w, h)
  let deepest = 0
  for (let i = 0; i < d.length; i++) if (d[i] > deepest) deepest = d[i]
  const r = Math.max(1.2, radius(deepest))
  const out = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const t = Math.min(1, d[i] / r)
    out[i] = r * Math.sqrt(1 - (1 - t) * (1 - t))
  }
  // A light blur irons out the facets of the polygonal outline and the crease
  // a distance field has along its middle, which would otherwise catch the light.
  return blur(out, w, h, smooth)
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** Light a height field: per pixel, the diffuse term (1 = flat, facing up) and a gloss term. */
function light(hf: Float32Array, w: number, h: number, gloss: number): { lam: Float32Array; spec: Float32Array } {
  const lam = new Float32Array(w * h)
  const spec = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const gx = (hf[i + (x < w - 1 ? 1 : 0)] - hf[i - (x > 0 ? 1 : 0)]) / 2
      const gy = (hf[i + (y < h - 1 ? w : 0)] - hf[i - (y > 0 ? w : 0)]) / 2
      const l = Math.hypot(gx, gy, 1)
      const nx = -gx / l
      const ny = -gy / l
      const nz = 1 / l
      lam[i] = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / LIGHT[2]
      spec[i] = gloss * Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]) ** 48
    }
  }
  return { lam, spec }
}

type Layer = { alpha: Float32Array; lam: Float32Array; spec: Float32Array; shadow: Float32Array | null; shadowK: number }

function layer(alpha: Float32Array, w: number, h: number, radius: (deepest: number) => number, smooth: number, gloss: number, shadowR: number, shadowK: number): Layer {
  return { alpha, ...light(heights(alpha, w, h, radius, smooth), w, h, gloss), shadow: shadowR > 0 ? blur(alpha, w, h, shadowR) : null, shadowK }
}

/** Everything about a drawing that doesn't depend on its colour; colour it with `paintPrepared`. */
export type Prepared = { shape: Shape; o: Geometry; layers: Layer[]; halo: Float32Array | null }

export function prepareAircraft(shape: Shape, o: Geometry): Prepared {
  const { width: w, height: h, ppm } = o
  const ctx = makeCanvas(w, h)
  const maxDim = Math.max(shape.span, shape.length)
  const edge = Math.min(0.7, Math.max(0.18, 0.012 * maxDim)) * ppm
  const smooth = Math.max(1, 0.0045 * Math.max(w, h))
  const aS = alphaOf(ctx, o, [shape.outline])
  // Wings and tails get a narrow rounded edge.
  const layers = [layer(aS, w, h, () => edge, smooth, 0.25, 0, 0)]
  if (shape.body) {
    // The fuselage rounds over completely and casts a soft contact shadow on the wings.
    layers.push(layer(alphaOf(ctx, o, [shape.body]), w, h, (deepest) => deepest, smooth * 1.5, 0.55, 0.32 * ppm, 0.3))
  }
  if (shape.over.length) {
    // Engine pods round over like tubes; a T-tail gets a broad rounded edge.
    layers.push(layer(alphaOf(ctx, o, shape.over), w, h, (deepest) => Math.min(deepest, 0.9 * ppm), smooth, 0.45, 0.28 * ppm, 0.32))
  }
  return { shape, o, layers, halo: o.halo ? blur(aS, w, h, Math.max(1, 0.012 * maxDim * ppm)) : null }
}

/** Colour a prepared drawing, adding the rotor for helicopters. */
export function paintPrepared(p: Prepared, tone: Tone, rotorAngle = 0): ImageData {
  const { width: w, height: h, ppm } = p.o
  const t = TONES[tone]
  const img = new ImageData(w, h)
  const px = img.data
  const rgb = [0, 0, 0]
  for (let i = 0; i < w * h; i++) {
    let a = 0
    rgb[0] = rgb[1] = rgb[2] = 0
    for (let k = 0; k < p.layers.length; k++) {
      const L = p.layers[k]
      const la = L.alpha[i]
      // What lies below darkens under this layer's contact shadow.
      if (L.shadow) {
        const dim = 1 - L.shadowK * L.shadow[i] * (1 - la)
        rgb[0] *= dim
        rgb[1] *= dim
        rgb[2] *= dim
      }
      if (la <= 0) continue
      const lam = L.lam[i]
      const sp = L.spec[i]
      for (let c = 0; c < 3; c++) {
        let v = lam < 1 ? mix(t.dark[c], t.base[c], lam ** 1.35) : mix(t.base[c], t.light[c], Math.min(1, (lam - 1) * 4))
        v += sp * (t.light[c] - v)
        rgb[c] = k === 0 ? v : mix(rgb[c], v, la)
      }
      if (la > a) a = la
    }
    let r = rgb[0]
    let g = rgb[1]
    let b = rgb[2]
    if (p.halo && a < 1) {
      // Dark rim under the anti-aliased edge (premultiplied "over").
      const ha = 0.45 * p.halo[i] * (1 - a)
      const na = a + ha
      if (na > 0) {
        r = (r * a + 10 * ha) / na
        g = (g * a + 14 * ha) / na
        b = (b * a + 28 * ha) / na
      }
      a = na
    }
    px[i * 4] = r
    px[i * 4 + 1] = g
    px[i * 4 + 2] = b
    px[i * 4 + 3] = a * 255
  }
  if (!p.shape.rotor) return img
  // Helicopters: translucent rotor disc and the blades over the airframe.
  const ctx = makeCanvas(w, h)
  ctx.putImageData(img, 0, 0)
  ctx.setTransform(ppm, 0, 0, ppm, w / 2, h / 2)
  paintRotor(ctx, p.shape.rotor, tone, rotorAngle, ppm)
  return ctx.getImageData(0, 0, w, h)
}

/** Paint the shape into RGBA pixels. */
export function renderAircraft(shape: Shape, o: RenderOptions): ImageData {
  return paintPrepared(prepareAircraft(shape, o), o.tone, o.rotorAngle)
}

/** Blade chord in metres: real-ish when drawn large, widened so blades stay visible when small. */
const bladeChord = (ppm: number) => Math.max(0.34, 2.2 / ppm)

function bladePaths(ctx: CanvasRenderingContext2D, rotor: [number, number, number], angle: number, ppm: number, each: () => void) {
  const [x, y, R] = rotor
  const chord = bladeChord(ppm)
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  for (let k = 0; k < 4; k++) {
    ctx.rotate(Math.PI / 2)
    ctx.beginPath()
    ctx.roundRect(0, -chord / 2, R * 0.98, chord, chord / 2)
    each()
  }
  ctx.restore()
}

/** Rotor disc, four blades and the hub, in metres. */
export function paintRotor(ctx: CanvasRenderingContext2D, rotor: [number, number, number], tone: Tone, angle: number, ppm: number) {
  const [x, y, R] = rotor
  const t = TONES[tone]
  const disc = ctx.createRadialGradient(x, y, 0, x, y, R)
  disc.addColorStop(0, `rgba(${t.disc},0.06)`)
  disc.addColorStop(0.75, `rgba(${t.disc},0.14)`)
  disc.addColorStop(1, `rgba(${t.disc},0.3)`)
  ctx.fillStyle = disc
  ctx.beginPath()
  ctx.arc(x, y, R, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineWidth = Math.max(1 / ppm, 0.08)
  ctx.strokeStyle = `rgba(${t.disc},0.45)`
  ctx.stroke()
  ctx.fillStyle = t.rotor
  ctx.strokeStyle = t.rotorEdge
  ctx.lineWidth = Math.max(0.6 / ppm, 0.04)
  bladePaths(ctx, rotor, angle, ppm, () => {
    ctx.fill()
    ctx.stroke()
  })
  ctx.beginPath()
  ctx.arc(x, y, Math.max(0.45, 2 / ppm), 0, Math.PI * 2)
  ctx.fillStyle = t.hub
  ctx.fill()
}

/** Plain silhouette (blades included), for distance-field shadows. */
export function silhouetteRGBA(shape: Shape, w: number, h: number, ppm: number, rotorAngle = 0): ImageData {
  const ctx = makeCanvas(w, h)
  ctx.setTransform(ppm, 0, 0, ppm, w / 2, h / 2)
  ctx.fillStyle = '#fff'
  ctx.fill(new Path2D(shape.outline))
  if (shape.rotor) bladePaths(ctx, shape.rotor, rotorAngle, ppm, () => ctx.fill())
  return ctx.getImageData(0, 0, w, h)
}
