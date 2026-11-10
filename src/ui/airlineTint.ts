/**
 * The flight card's purple, leaning toward the airline's own colour: KLM's
 * card goes a little bluer, Delta's a little redder, WestJet's a touch teal.
 *
 * The brand colour is read off the airline's processed logo (the most common
 * saturated hue, ignoring white, black and greys), cached per airline, and
 * mixed into the card purple by about 30% in OKLCH, where a mix keeps its
 * vividness instead of going muddy. The result is darkened if needed so white
 * text keeps at least 4.5:1 contrast. A logo with no clear colour (white
 * wordmarks, monochrome marks) leaves the card its standard purple.
 */
import { logoPicture } from '../airline/logos'
import { useAirlineLogo } from '../airline/useAirlineLogo'

export type Rgb = [number, number, number]
export type Oklch = [number, number, number]

/** The card's two gradient stops, as in `--color-atc-card` and `--color-atc-card-deep`. */
export const CARD_TOP = '#5b3df5'
export const CARD_BOTTOM = '#4a2fd6'
/** How far the card moves toward the airline colour. */
export const TINT_AMOUNT = 0.28
/**
 * Most the card's hue may turn, in degrees. Red brands would otherwise push
 * the card into the magenta that means "replay" elsewhere in the app; this
 * keeps every card recognisably the flight card, just leaning.
 */
export const MAX_HUE_SHIFT = 22
/** White text must keep at least this contrast on the tinted card. */
export const MIN_CONTRAST = 4.5

// ---------------------------------------------------------------------------
// Colour maths (sRGB <-> OKLab/OKLCH, WCAG contrast)
// ---------------------------------------------------------------------------

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`
}

const toLinear = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const fromLinear = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

export function rgbToOklab([r, g, b]: Rgb): [number, number, number] {
  const lr = toLinear(r)
  const lg = toLinear(g)
  const lb = toLinear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

/** Linear sRGB from OKLab (may fall outside 0..1 when out of gamut). */
function oklabToLinear([L, a, b]: [number, number, number]): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
}

export function rgbToOklch(rgb: Rgb): Oklch {
  const [L, a, b] = rgbToOklab(rgb)
  const C = Math.hypot(a, b)
  const H = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
  return [L, C, H]
}

/** Back to sRGB, pulling chroma in until the colour fits the sRGB gamut. */
export function oklchToRgb([L, C, H]: Oklch): Rgb {
  const h = (H * Math.PI) / 180
  let c = C
  for (let i = 0; i < 24; i++) {
    const lin = oklabToLinear([L, c * Math.cos(h), c * Math.sin(h)])
    if (lin.every((v) => v >= -0.0005 && v <= 1.0005) || c < 1e-4) return lin.map((v) => fromLinear(Math.min(1, Math.max(0, v)))) as Rgb
    c *= 0.9
  }
  return oklabToLinear([L, 0, 0]).map((v) => fromLinear(Math.min(1, Math.max(0, v)))) as Rgb
}

/** Mix two colours in OKLCH, `t` of the way from `a` to `b`, the short way round the hue circle. */
export function mixOklch(a: Oklch, b: Oklch, t: number, maxHueShift = 180): Oklch {
  let dh = b[2] - a[2]
  if (dh > 180) dh -= 360
  if (dh < -180) dh += 360
  const turn = Math.max(-maxHueShift, Math.min(maxHueShift, dh * t))
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (a[2] + turn + 360) % 360]
}

/** WCAG relative luminance. */
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

/** WCAG contrast ratio of white text on this colour. */
export function whiteContrast(rgb: Rgb): number {
  return 1.05 / (luminance(rgb) + 0.05)
}

/** Darken (lower OKLCH lightness) until white text reads at `min`:1 or better. */
export function withWhiteContrast(c: Oklch, min = MIN_CONTRAST): Rgb {
  let L = c[0]
  let rgb = oklchToRgb(c)
  while (whiteContrast(rgb) < min && L > 0.05) {
    L -= 0.01
    rgb = oklchToRgb([L, c[1], c[2]])
  }
  return rgb
}

// ---------------------------------------------------------------------------
// Brand colour from a logo
// ---------------------------------------------------------------------------

/** Pixels must be at least this colourful (OKLCH chroma) to count as brand colour. */
const MIN_CHROMA = 0.06
/** Of the logo's visible pixels, at least this share must be colourful. */
const MIN_COLOURFUL = 0.08
const BINS = 24

/**
 * The dominant saturated colour in RGBA pixel data, or null if the picture is
 * essentially white, grey or black. Colours are binned by hue, weighted by
 * how colourful each pixel is; the winning hue (with its neighbours) is
 * averaged in OKLab.
 */
export function dominantColor(data: ArrayLike<number>): Rgb | null {
  const weight = new Float64Array(BINS)
  const sums: [number, number, number][] = Array.from({ length: BINS }, () => [0, 0, 0])
  let visible = 0
  let colourful = 0
  for (let i = 0; i + 3 < data.length; i += 4) {
    const alpha = data[i + 3] / 255
    if (alpha < 0.6) continue
    visible++
    const lab = rgbToOklab([data[i], data[i + 1], data[i + 2]])
    const C = Math.hypot(lab[1], lab[2])
    if (C < MIN_CHROMA || lab[0] < 0.2 || lab[0] > 0.97) continue
    colourful++
    const H = ((Math.atan2(lab[2], lab[1]) * 180) / Math.PI + 360) % 360
    const bin = Math.floor(H / (360 / BINS)) % BINS
    const w = C * alpha
    weight[bin] += w
    sums[bin][0] += lab[0] * w
    sums[bin][1] += lab[1] * w
    sums[bin][2] += lab[2] * w
  }
  if (!visible || colourful / visible < MIN_COLOURFUL) return null
  let best = 0
  for (let k = 1; k < BINS; k++) if (weight[k] > weight[best]) best = k
  let w = 0
  const lab: [number, number, number] = [0, 0, 0]
  for (const k of [best - 1, best, best + 1]) {
    const j = (k + BINS) % BINS
    w += weight[j]
    lab[0] += sums[j][0]
    lab[1] += sums[j][1]
    lab[2] += sums[j][2]
  }
  if (w <= 0) return null
  const lin = oklabToLinear([lab[0] / w, lab[1] / w, lab[2] / w])
  return lin.map((v) => fromLinear(Math.min(1, Math.max(0, v)))) as Rgb
}

export type CardTint = { top: string; bottom: string; brand: string }

/** The card's two stops pulled `amount` of the way toward `brand`, kept readable under white text. */
export function tintCard(brand: Rgb, amount = TINT_AMOUNT): CardTint {
  const b = rgbToOklch(brand)
  const stop = (hex: string) => rgbToHex(withWhiteContrast(mixOklch(rgbToOklch(hexToRgb(hex)), b, amount, MAX_HUE_SHIFT)))
  return { top: stop(CARD_TOP), bottom: stop(CARD_BOTTOM), brand: rgbToHex(brand) }
}

// ---------------------------------------------------------------------------
// Per-airline cache and the hook
// ---------------------------------------------------------------------------

/** Tint per airline code; null once a logo has been read and has no usable colour. */
const tints = new Map<string, CardTint | null>()

/** Read a loaded logo picture's brand colour (same-origin files, so the canvas can be read). */
function analyse(img: HTMLImageElement): CardTint | null {
  try {
    const size = 48
    const scale = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)
    const brand = dominantColor(ctx.getImageData(0, 0, w, h).data)
    return brand ? tintCard(brand) : null
  } catch {
    return null
  }
}

/** The card colours for this aircraft's airline, or null for the standard purple. */
export function useAirlineTint(callsign: string | null | undefined, icao24?: string | null): CardTint | null {
  // Re-renders when the index and, later, the picture finish loading.
  const logo = useAirlineLogo(callsign, icao24)
  if (!logo) return null
  const cached = tints.get(logo.code)
  if (cached !== undefined) return cached
  const img = logoPicture(logo)
  if (!img) return null
  const tint = analyse(img)
  tints.set(logo.code, tint)
  return tint
}

let registered = false

/**
 * Let the browser animate the card colours: custom properties registered as
 * colours interpolate, so a gradient built from them can cross-fade.
 */
export function registerCardColors() {
  if (registered || typeof CSS === 'undefined' || !('registerProperty' in CSS)) return
  registered = true
  for (const [name, initial] of [
    ['--card-top', CARD_TOP],
    ['--card-bottom', CARD_BOTTOM],
  ]) {
    try {
      CSS.registerProperty({ name, syntax: '<color>', inherits: false, initialValue: initial })
    } catch {
      // Already registered (hot reload): fine.
    }
  }
}
