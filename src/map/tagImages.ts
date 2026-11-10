/**
 * Callsign tags for the map, drawn as bitmaps so they match the reference
 * exactly: a dark grey rounded plate (purple for the selected or talking
 * aircraft) with the airline logo left of the callsign, set in the app's own
 * UI font. MapLibre can only set text in the Noto glyphs its style serves,
 * so the whole tag is one canvas image used as `icon-image`.
 *
 * Each distinct tag gets an image id that spells out everything drawn on it
 * (`tagKey`). The aircraft layer puts that id on the feature every frame;
 * MapLibre asks for ids it hasn't got (`styleimagemissing`) and we draw them
 * then. Ids nobody has used for a while are removed again, so a busy evening
 * doesn't pile up thousands of bitmaps. A tag first appears without a logo
 * while the logo downloads, and switches to the logo version once it's in.
 */
import type { Map as MapLibreMap } from 'maplibre-gl'
import { loadedPicture, logoFor, logoPicture, logosVersion, type Logo } from '../airline/logos'

const PREFIX = 'tag|'

/**
 * Geometry in CSS pixels, measured off the reference (3x phone screenshots):
 * a 26 px plate with ~5.5 px corners, a logo up to ~14 px across, a 12 px
 * medium-weight callsign, slightly tracked, with ~7 px of air either side.
 */
export const TAG = {
  height: 26,
  radius: 5.5,
  font: 12,
  weight: 500,
  /** Tracking in px; the reference's SF Pro is set a little open at this size. */
  tracking: 0.25,
  /** Data block line under the callsign. */
  subFont: 10,
  subWeight: 500,
  /** Extra height the data block line adds. */
  subLine: 11.5,
  padText: 8,
  padLogo: 6,
  gap: 7,
  logoW: 14.5,
  logoH: 13.5,
  /** Very wide wordmarks may run wider than a square mark, up to this. */
  logoMaxW: 24,
  logoMinH: 4,
  fill: 'rgba(72,78,88,0.76)',
} as const

/** How long an unused tag bitmap is kept before it is removed from the map. */
const KEEP_MS = 12_000
const SWEEP_MS = 4_000

export type TagSpec = { active: boolean; logo: string | null; callsign: string; sub: string }

/** Image id for a tag. Everything drawn is in it, so a change of any of it is a new image. */
export function encodeTag(spec: TagSpec): string {
  return `${PREFIX}${spec.active ? 'a' : 'n'}|${spec.logo ?? '-'}|${spec.callsign}|${spec.sub}`
}

export function decodeTag(id: string): TagSpec | null {
  if (!id.startsWith(PREFIX)) return null
  const parts = id.slice(PREFIX.length).split('|')
  if (parts.length < 4) return null
  return { active: parts[0] === 'a', logo: parts[1] === '-' ? null : parts[1], callsign: parts[2], sub: parts.slice(3).join('|') }
}

export type TagLayout = {
  width: number
  height: number
  logo: { x: number; y: number; w: number; h: number } | null
  textX: number
  baseline: number
  subBaseline: number
}

/**
 * Where everything goes, from measured text widths and cap heights and the
 * logo's pixel size. Pure, so it can be tested without a canvas.
 */
export function tagLayout(m: { textW: number; capH: number; subW?: number; subCapH?: number; logo?: { w: number; h: number } | null }): TagLayout {
  const sub = (m.subW ?? 0) > 0
  const height = sub ? TAG.height + TAG.subLine : TAG.height
  // With a data block the callsign row moves up a little so both lines sit evenly.
  const row = sub ? TAG.height / 2 - 1 : TAG.height / 2
  let logo: TagLayout['logo'] = null
  let textX = TAG.padText
  if (m.logo && m.logo.w > 0 && m.logo.h > 0) {
    const aspect = m.logo.w / m.logo.h
    // Fit the logo box; a long wordmark gets a little more width rather than shrinking to a hairline.
    let h = Math.min(TAG.logoH, TAG.logoW / aspect)
    if (h < TAG.logoMinH) h = Math.min(TAG.logoMinH, TAG.logoMaxW / aspect)
    const w = h * aspect
    const slot = Math.max(w, Math.min(TAG.logoW, TAG.logoMaxW))
    logo = { x: TAG.padLogo + (slot - w) / 2, y: row - h / 2, w, h }
    textX = TAG.padLogo + slot + TAG.gap
  }
  const lineW = textX + m.textW + TAG.padText
  const subLineW = sub ? textX + (m.subW ?? 0) + TAG.padText : 0
  return {
    width: Math.ceil(Math.max(lineW, subLineW)),
    height,
    logo,
    textX,
    baseline: row + m.capH / 2,
    subBaseline: height - 6.5,
  }
}

// ---------------------------------------------------------------------------
// Which tag an aircraft wears this frame
// ---------------------------------------------------------------------------

const used = new Map<string, number>()
const logoMemo = new Map<string, { v: number; logo: Logo | null | undefined }>()

function memoLogo(callsign: string, icao24: string): Logo | null | undefined {
  const v = logosVersion()
  const hit = logoMemo.get(callsign)
  if (hit && hit.v === v) return hit.logo
  const logo = logoFor(callsign, icao24)
  logoMemo.set(callsign, { v, logo })
  return logo
}

/**
 * The image id for this aircraft's tag right now. Starts the logo download
 * the first time a callsign is seen; until it lands the tag has no logo.
 */
export function tagKey(callsign: string, icao24: string, active: boolean, sub: string, now = performance.now()): string {
  const logo = memoLogo(callsign, icao24)
  const ready = logo ? logoPicture(logo) : null
  const key = encodeTag({ active, logo: ready ? logo!.code : null, callsign, sub: sub.replace(/^\n/, '') })
  used.set(key, now)
  return key
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

let canvas: HTMLCanvasElement | null = null
const style = { family: '', card: '', readAt: -Infinity }

/** The UI font and the card purple, read from the page so tags follow the app's styling. */
function readStyle() {
  const now = performance.now()
  if (now - style.readAt < 2000 && style.family) return style
  style.readAt = now
  style.family = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif'
  style.card = getComputedStyle(document.documentElement).getPropertyValue('--color-atc-card').trim() || '#5b3df5'
  return style
}

function pixelRatio(): number {
  return Math.min(3, Math.max(1, window.devicePixelRatio || 1))
}

/** Letter spacing where the canvas supports it (not every browser does yet); harmless elsewhere. */
function setTracking(ctx: CanvasRenderingContext2D, px: number) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`
}

function drawTag(spec: TagSpec, dpr: number): ImageData | null {
  canvas ??= document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  const { family, card } = readStyle()
  const font = `${TAG.weight} ${TAG.font}px ${family}`
  const subFont = `${TAG.subWeight} ${TAG.subFont}px ${family}`

  ctx.font = font
  setTracking(ctx, TAG.tracking)
  const textW = ctx.measureText(spec.callsign).width
  const capH = ctx.measureText('H').actualBoundingBoxAscent || TAG.font * 0.7
  let subW = 0
  let subCapH = 0
  if (spec.sub) {
    ctx.font = subFont
    setTracking(ctx, 0)
    subW = ctx.measureText(spec.sub).width
    subCapH = ctx.measureText('H').actualBoundingBoxAscent || TAG.subFont * 0.7
  }
  const img = spec.logo ? loadedPicture(spec.logo) : null
  const L = tagLayout({ textW, capH, subW, subCapH, logo: img ? { w: img.naturalWidth, h: img.naturalHeight } : null })

  const w = Math.ceil(L.width * dpr)
  const h = Math.ceil(L.height * dpr)
  canvas.width = w
  canvas.height = h
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, L.width, L.height)

  ctx.beginPath()
  ctx.roundRect(0, 0, w / dpr, h / dpr, TAG.radius)
  ctx.fillStyle = spec.active ? card : TAG.fill
  ctx.fill()

  if (img && L.logo) {
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, L.logo.x, L.logo.y, L.logo.w, L.logo.h)
  }

  ctx.font = font
  setTracking(ctx, TAG.tracking)
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#FFFFFF'
  ctx.fillText(spec.callsign, L.textX, L.baseline)
  if (spec.sub) {
    ctx.font = subFont
    setTracking(ctx, 0)
    ctx.fillStyle = spec.active ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.62)'
    ctx.fillText(spec.sub, L.textX, L.subBaseline)
  }
  return ctx.getImageData(0, 0, w, h)
}

/**
 * Serve tag images to a map: draws them on request, sweeps out stale ones,
 * and redraws everything once the UI font has loaded (tags drawn before
 * that used a fallback face). Returns the detach function.
 */
export function attachTagImages(map: MapLibreMap): () => void {
  const drawn = new Set<string>()
  let dpr = pixelRatio()
  let fontsReady = typeof document === 'undefined' || !document.fonts
  let drewEarly = false

  const removeAll = () => {
    for (const id of drawn) if (map.hasImage(id)) map.removeImage(id)
    drawn.clear()
  }

  const onMissing = (e: { id: string }) => {
    const spec = decodeTag(e.id)
    if (!spec || map.hasImage(e.id)) return
    const data = drawTag(spec, dpr)
    if (!data) return
    map.addImage(e.id, data, { pixelRatio: dpr })
    drawn.add(e.id)
    if (!fontsReady) drewEarly = true
  }
  map.on('styleimagemissing', onMissing)

  if (!fontsReady) {
    const family = readStyle().family
    Promise.all([document.fonts.ready, document.fonts.load(`${TAG.weight} ${TAG.font}px ${family}`), document.fonts.load(`${TAG.subWeight} ${TAG.subFont}px ${family}`)])
      .catch(() => undefined)
      .then(() => {
        fontsReady = true
        style.readAt = -Infinity
        if (drewEarly) removeAll()
      })
  }

  const sweep = window.setInterval(() => {
    const now = performance.now()
    // Moved to a screen with a different pixel density: redraw at the new density.
    const next = pixelRatio()
    if (next !== dpr) {
      dpr = next
      removeAll()
    }
    for (const id of drawn) {
      if (now - (used.get(id) ?? 0) > KEEP_MS) {
        if (map.hasImage(id)) map.removeImage(id)
        drawn.delete(id)
      }
    }
    for (const [id, t] of used) if (now - t > KEEP_MS && !drawn.has(id)) used.delete(id)
    if (logoMemo.size > 2000) logoMemo.clear()
  }, SWEEP_MS)

  return () => {
    map.off('styleimagemissing', onMissing)
    window.clearInterval(sweep)
    removeAll()
  }
}
