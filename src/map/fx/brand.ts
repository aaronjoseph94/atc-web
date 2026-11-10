/**
 * An airline's brand colour, read off its logo (the same processed pictures
 * the callsign tags show), for a touch of livery on the aircraft's fin.
 *
 * The logo is drawn small, and the colour that covers the most of it among
 * the clearly coloured pixels wins: white, grey and near-black parts are
 * left out, so a red-and-white logo gives red. Logos with no real colour give
 * none, and the aircraft simply stays white. Worked out once per airline.
 */
import { logoFor, logoPicture } from '../../airline/logos'

/** Hue buckets. */
const BINS = 24
/** Below this share of the logo being colourful, the airline has no colour to show. */
const MIN_COLOURFUL = 0.06
const SAMPLE = 24

/**
 * Dominant colour of RGBA pixels as `#rrggbb`, or null when the picture is
 * essentially white, grey or black. Pure, for tests.
 */
export function dominantColour(px: Uint8ClampedArray): string | null {
  const weight = new Float64Array(BINS)
  const sum = Array.from({ length: BINS }, () => [0, 0, 0])
  let visible = 0
  let colourful = 0
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255
    if (a < 0.5) continue
    visible += a
    const r = px[i] / 255
    const g = px[i + 1] / 255
    const b = px[i + 2] / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const sat = max === 0 ? 0 : (max - min) / max
    if (sat < 0.35 || max < 0.22) continue
    const w = a * sat
    colourful += a
    const bin = Math.floor((hue(r, g, b, max, min) / 360) * BINS) % BINS
    weight[bin] += w
    sum[bin][0] += px[i] * w
    sum[bin][1] += px[i + 1] * w
    sum[bin][2] += px[i + 2] * w
  }
  if (visible === 0 || colourful / visible < MIN_COLOURFUL) return null
  let best = 0
  for (let k = 1; k < BINS; k++) if (weight[k] > weight[best]) best = k
  // Average the winning bucket with its neighbours, so a hue on a bucket edge isn't split in two.
  let w = 0
  const rgb = [0, 0, 0]
  for (const k of [best - 1, best, best + 1]) {
    const j = (k + BINS) % BINS
    w += weight[j]
    for (let c = 0; c < 3; c++) rgb[c] += sum[j][c]
  }
  return toHex(paintable(rgb.map((v) => v / w) as [number, number, number]))
}

function hue(r: number, g: number, b: number, max: number, min: number): number {
  const d = max - min
  if (d === 0) return 0
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  return h < 0 ? h + 360 : h
}

/**
 * Keep the colour inside a range that reads as paint on a white airframe
 * under the map's light: not washed out (some logos were lightened for the
 * dark tags), not so dark that it looks like a hole.
 */
function paintable([r, g, b]: [number, number, number]): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 510
  const target = Math.max(0.36, Math.min(0.56, l))
  // Scale toward the target lightness around grey, which keeps the hue.
  const k = l > 0 ? target / l : 1
  const out = [r, g, b].map((v) => v * k) as [number, number, number]
  const top = Math.max(...out)
  return top > 255 ? (out.map((v) => (v * 255) / top) as [number, number, number]) : out
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`
}

/** Per airline code: the colour, null for none, or absent while its logo loads. */
const colours = new Map<string, string | null>()

/**
 * The fin colour for a callsign: a `#rrggbb`, or '' when there is none (yet).
 * Starts loading the logo the first time an airline is seen; never blocks.
 */
export function brandColour(callsign: string, icao24: string): string {
  const logo = logoFor(callsign, icao24)
  if (!logo) return ''
  const known = colours.get(logo.code)
  if (known !== undefined) return known ?? ''
  const img = logoPicture(logo)
  if (!img) return ''
  let colour: string | null = null
  try {
    const c = document.createElement('canvas')
    c.width = SAMPLE
    c.height = SAMPLE
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    const scale = Math.min(SAMPLE / img.naturalWidth, SAMPLE / img.naturalHeight)
    const w = img.naturalWidth * scale
    const h = img.naturalHeight * scale
    ctx.drawImage(img, (SAMPLE - w) / 2, (SAMPLE - h) / 2, w, h)
    colour = dominantColour(ctx.getImageData(0, 0, SAMPLE, SAMPLE).data)
  } catch {
    // A picture we can't read back simply means no colour.
    colour = null
  }
  colours.set(logo.code, colour)
  return colour ?? ''
}
