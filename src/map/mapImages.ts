/**
 * Every bitmap the map style references, drawn at runtime with canvas so the
 * app ships no image assets:
 *
 *  - aircraft silhouettes (self-authored, CC0), one per broad airframe class,
 *    converted to signed distance fields so MapLibre can tint, outline and
 *    scale them crisply;
 *  - stretchable sign plates modelled on real airfield signage: yellow-on-black
 *    taxiway location signs and white-on-red runway signs;
 *  - the callsign tag plates.
 */
import type { Map as MapLibreMap } from 'maplibre-gl'

const SIZE = 96
const C = SIZE / 2

type Draw = (ctx: CanvasRenderingContext2D) => void

/** Fill a shape given as its right-hand half; the left half is mirrored. */
function mirrored(ctx: CanvasRenderingContext2D, half: [number, number][]) {
  ctx.beginPath()
  half.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  for (let i = half.length - 1; i >= 0; i--) ctx.lineTo(-half[i][0], half[i][1])
  ctx.closePath()
  ctx.fill()
}

/** Rounded fuselage from nose (−len/2) to tail (+len/2). */
function fuselage(ctx: CanvasRenderingContext2D, len: number, width: number) {
  const h = len / 2
  const w = width / 2
  ctx.beginPath()
  ctx.moveTo(0, -h)
  ctx.bezierCurveTo(w, -h, w, -h + width * 1.6, w, -h + width * 2.4)
  ctx.lineTo(w, h - width * 2.2)
  ctx.bezierCurveTo(w, h - width, w * 0.4, h, 0, h)
  ctx.bezierCurveTo(-w * 0.4, h, -w, h - width, -w, h - width * 2.2)
  ctx.lineTo(-w, -h + width * 2.4)
  ctx.bezierCurveTo(-w, -h + width * 1.6, -w, -h, 0, -h)
  ctx.closePath()
  ctx.fill()
}

function pod(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  for (const sx of [-1, 1]) {
    ctx.beginPath()
    ctx.roundRect(sx * x - w / 2, y, w, h, w / 2)
    ctx.fill()
  }
}

/** Swept-wing airliner; the parameters cover narrow-bodies through the 747. */
function airliner(o: { len: number; body: number; span: number; sweep: number; chord: number; wingY: number; engines: [number, number][]; engine: [number, number]; tail: number }): Draw {
  return (ctx) => {
    fuselage(ctx, o.len, o.body)
    const b = o.body / 2
    // Main wing: leading edge sweeps back to the tip, trailing edge kinks at the root.
    mirrored(ctx, [
      [b - 1, o.wingY],
      [o.span, o.wingY + o.sweep],
      [o.span, o.wingY + o.sweep + 3.4],
      [b + 6, o.wingY + o.chord + 1],
      [b - 1, o.wingY + o.chord + 4],
    ])
    for (const [x, y] of o.engines) pod(ctx, x, y, o.engine[0], o.engine[1])
    // Tailplane.
    const ty = o.len / 2 - 11
    mirrored(ctx, [
      [b - 1.5, ty],
      [o.tail, ty + 7],
      [o.tail, ty + 9.5],
      [1, ty + 7.5],
    ])
  }
}

const SHAPES: Record<string, Draw> = {
  // Narrow-body twin: 737, A320 family, 757.
  'ac-jet': airliner({ len: 70, body: 7.4, span: 33, sweep: 15, chord: 9, wingY: -8, engines: [[12.5, -9]], engine: [5.4, 11], tail: 13 }),
  // Wide-body twin: 777, 787, A330, A350.
  'ac-heavy': airliner({ len: 78, body: 9.4, span: 39, sweep: 18, chord: 11, wingY: -10, engines: [[14.5, -12]], engine: [7, 14], tail: 15.5 }),
  // Four engines: 747, A380, A340.
  'ac-quad': airliner({ len: 80, body: 10, span: 41, sweep: 19, chord: 12, wingY: -11, engines: [[13, -13], [25, -4]], engine: [6, 12], tail: 16 }),
  // Rear-engined regional and business jets: CRJ, ERJ-145, Citation, Gulfstream.
  'ac-regional': (ctx) => {
    fuselage(ctx, 68, 6.2)
    mirrored(ctx, [
      [2.2, -1],
      [27, 11],
      [27, 14],
      [8, 9],
      [2.2, 11],
    ])
    pod(ctx, 6.6, 12, 4.6, 11)
    mirrored(ctx, [
      [0.8, 25],
      [12, 31],
      [12, 33.5],
      [0.8, 31],
    ])
  },
  // Twin turboprop: Dash 8, ATR, King Air.
  'ac-turboprop': (ctx) => {
    fuselage(ctx, 62, 6.6)
    mirrored(ctx, [
      [2.4, -9],
      [31, -6.5],
      [31, -2.5],
      [2.4, 0.5],
    ])
    pod(ctx, 11.5, -16, 5, 13)
    mirrored(ctx, [
      [1, 21],
      [12.5, 23],
      [12.5, 26.5],
      [1, 27.5],
    ])
  },
  // Light piston single: Cessna 172, Cirrus, Piper.
  'ac-light': (ctx) => {
    fuselage(ctx, 50, 6)
    ctx.beginPath()
    ctx.roundRect(-33, -12, 66, 9, 3)
    ctx.fill()
    ctx.beginPath()
    ctx.roundRect(-12, 16, 24, 6, 2.5)
    ctx.fill()
  },
  // Helicopter: body, tail boom, crossed rotor blades.
  'ac-heli': (ctx) => {
    ctx.beginPath()
    ctx.ellipse(0, -4, 8, 14, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.roundRect(-2, 6, 4, 26, 2)
    ctx.fill()
    ctx.beginPath()
    ctx.roundRect(-7, 28, 14, 3.4, 1.7)
    ctx.fill()
    ctx.save()
    ctx.translate(0, -4)
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      ctx.save()
      ctx.rotate(a)
      ctx.beginPath()
      ctx.roundRect(-34, -2, 68, 4, 2)
      ctx.fill()
      ctx.restore()
    }
    ctx.restore()
  },
  // Heading unknown (usually parked): a plain marker that doesn't pretend to point anywhere.
  'ac-dot': (ctx) => {
    ctx.beginPath()
    ctx.arc(0, 0, 13, 0, Math.PI * 2)
    ctx.fill()
  },
  // Ground vehicles that carry a transponder (tugs, follow-me cars, fire trucks).
  'ac-vehicle': (ctx) => {
    ctx.beginPath()
    ctx.roundRect(-10, -17, 20, 34, 5)
    ctx.fill()
  },
}

export type AircraftIcon = 'ac-jet' | 'ac-heavy' | 'ac-quad' | 'ac-regional' | 'ac-turboprop' | 'ac-light' | 'ac-heli' | 'ac-dot' | 'ac-vehicle'

/** Relative drawn size per class, so a 747 reads bigger than a Cessna. */
export const ICON_SCALE: Record<AircraftIcon, number> = {
  'ac-jet': 1,
  'ac-heavy': 1.22,
  'ac-quad': 1.34,
  'ac-regional': 0.84,
  'ac-turboprop': 0.8,
  'ac-light': 0.6,
  'ac-heli': 0.7,
  'ac-dot': 0.42,
  'ac-vehicle': 0.4,
}

// ---------------------------------------------------------------------------
// Signed distance field (Felzenszwalb & Huttenlocher exact transform)
// ---------------------------------------------------------------------------

const INF = 1e20

function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  for (let q = 1; q < n; q++) {
    let s: number
    do {
      const r = v[k]
      s = (f[q] + q * q - (f[r] + r * r)) / (2 * q - 2 * r)
    } while (s <= z[k] && --k > -1)
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const r = v[k]
    d[q] = (q - r) * (q - r) + f[r]
  }
}

function edt(grid: Float64Array, w: number, h: number) {
  const n = Math.max(w, h)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x]
    edt1d(f, h, d, v, z)
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y]
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x]
    edt1d(f, w, d, v, z)
    for (let x = 0; x < w; x++) grid[y * w + x] = Math.sqrt(d[x])
  }
}

/**
 * Turn an alpha mask into the distance field MapLibre expects for
 * `sdf: true` images: 0.75 on the edge, falling off over an 8 px radius.
 */
export function maskToSdf(alpha: Uint8ClampedArray, w: number, h: number, radius = 8): Uint8ClampedArray {
  const outside = new Float64Array(w * h)
  const inside = new Float64Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const a = alpha[i * 4 + 3] / 255
    // Anti-aliased edge pixels seed sub-pixel distances.
    outside[i] = a >= 1 ? 0 : a <= 0 ? INF : Math.max(0, 0.5 - a) ** 2
    inside[i] = a >= 1 ? INF : a <= 0 ? 0 : Math.max(0, a - 0.5) ** 2
  }
  edt(outside, w, h)
  edt(inside, w, h)
  const out = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const d = outside[i] - inside[i]
    out[i * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, 0.75 - d / radius)))
  }
  return out
}

function silhouette(draw: Draw): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.translate(C, C)
  ctx.fillStyle = '#fff'
  draw(ctx)
  const mask = ctx.getImageData(0, 0, SIZE, SIZE)
  return new ImageData(maskToSdf(mask.data, SIZE, SIZE) as Uint8ClampedArray<ArrayBuffer>, SIZE, SIZE)
}

// ---------------------------------------------------------------------------
// Stretchable plates
// ---------------------------------------------------------------------------

type Plate = { fill: string; stroke?: string; strokeWidth?: number; radius: number }

/** Sign and tag plates. Colours for the two signs follow FAA AC 150/5340-18. */
const PLATES: Record<string, Plate> = {
  // Taxiway location sign: yellow legend on black, yellow border.
  'sign-taxiway': { fill: '#0A0A0A', stroke: '#F5C518', strokeWidth: 2, radius: 5 },
  // Runway (mandatory instruction) sign: white legend on red.
  'sign-runway': { fill: '#C8102E', stroke: 'rgba(255,255,255,0.9)', strokeWidth: 1.5, radius: 5 },
  tag: { fill: 'rgba(18,24,40,0.88)', stroke: 'rgba(255,255,255,0.14)', strokeWidth: 1, radius: 8 },
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

/** Register every image the style uses. Safe to call again (e.g. after a context restore). */
export function ensureMapImages(map: MapLibreMap) {
  for (const [id, draw] of Object.entries(SHAPES)) {
    if (!map.hasImage(id)) map.addImage(id, silhouette(draw), { sdf: true, pixelRatio: 2 })
  }
  for (const [id, p] of Object.entries(PLATES)) {
    if (map.hasImage(id)) continue
    const { data, inset } = plate(p)
    const s = data.width
    map.addImage(id, data, {
      pixelRatio: 2,
      stretchX: [[inset, s - inset]],
      stretchY: [[inset, s - inset]],
      content: [inset, inset, s - inset, s - inset],
    })
  }
}

// ---------------------------------------------------------------------------
// Which silhouette for which aircraft
// ---------------------------------------------------------------------------

const QUAD = /^(B74|A38|A34|IL9|A124|A225|C5M|B52|IL76|C17)/
const HEAVY = /^(B76|B77|B78|A30|A31|A33|A35|MD11|DC10|L101|B3XM|IL96|C135|K35)/
const REGIONAL = /^(CRJ|CL[236]|E13|E14|E45|E35|E50P|E55P|E545|E550|C25|C5[0-9]|C6[0-9]|C7[0-9]|GL|G[1-7][0-9]{2}|GLF|GLEX|LJ|F2TH|F900|FA[5-8]|H25|HA4T|BE40|PC24|SF50|PRM1|ASTR|G150|G280)/
const TURBOPROP = /^(DH8|AT[4-7]|B190|B350|BE20|BE9|BE99|SW[34]|SF34|E120|C208|PC12|TBM|P180|JS[34]|D328|AN2[46]|L410|PA4[26]|C441|C425|DHC[67]|SH3|F50|E110|M28|P46T)/
const HELI = /^(H[0-9]|EC|AS[3-6]|B0[67]|B2[01]|B4[0-9]|R22|R44|R66|S76|S92|UH|AH|CH|MD[56]|A10[59]|A139|A169|B429|B505|BK17|EH10|S61|S70|KMAX|MI)/
const LIGHT = /^(C1[0-9]{2}|C2[0-1][0-9]|C17|C18|C20|C21|P28|PA[1-3]|SR2|DA[24]|M20|BE[23][356]|BE5[58]|BE76|AA5|RV|DR40|TB[12]|C77|C82|P32|PA32|PA34|PA44|DV20|EV97|TECN|P92|P20|C150|C152|C162|CH7|S22T|LA4|GLID|ULAC|BALL)/

/**
 * Pick a silhouette from the type designator when we have one, else from the
 * ADS-B emitter category, else assume an airliner (by far the commonest thing
 * at these airports).
 */
export function iconFor(a: { type?: string | null; category?: string | null; headingKnown?: boolean; onGround: boolean; speedKt: number | null }): AircraftIcon {
  const cat = a.category ?? ''
  if (cat.startsWith('C')) return 'ac-vehicle'
  // No heading and not moving: don't draw something that points.
  if (a.headingKnown === false && a.onGround && (a.speedKt ?? 0) < 4) return 'ac-dot'

  const t = (a.type ?? '').toUpperCase()
  if (t) {
    if (QUAD.test(t)) return 'ac-quad'
    if (HEAVY.test(t)) return 'ac-heavy'
    if (HELI.test(t)) return 'ac-heli'
    if (TURBOPROP.test(t)) return 'ac-turboprop'
    if (REGIONAL.test(t)) return 'ac-regional'
    if (LIGHT.test(t)) return 'ac-light'
    if (/^(B7[0-5]|B3[7-9]|A2[0-2]|A31[89]|A32|BCS|E1[79]|E29|E75|MD[89]|B71|DC9|F100|F70|SU95|C919|A19N|A20N|A21N)/.test(t)) return 'ac-jet'
  }
  switch (cat) {
    case 'A1':
    case 'B1':
    case 'B4':
      return 'ac-light'
    case 'A2':
      return 'ac-regional'
    case 'A5':
      return 'ac-heavy'
    case 'A7':
      return 'ac-heli'
    default:
      return 'ac-jet'
  }
}
