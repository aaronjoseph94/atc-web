/**
 * Airline logos, served from this site: `public/airline-logos/` holds one
 * small WebP per ICAO airline code, already cut out and tuned for the dark
 * tags by `scripts/fetch-airline-logos.py`, plus `index.json` listing the
 * codes and pixel sizes. Nothing is fetched from third parties at runtime.
 *
 * Everything here is lazy and never blocks a render: the index is fetched
 * the first time a logo is asked for, each picture the first time its
 * airline shows up. Until then callers get "no logo yet" and draw without
 * one. The browser cache (and the service worker) keep the files after the
 * first visit; decoded pictures are kept in memory for the map tags.
 */
import { airlineInfo, logoCandidates } from './airlines'

export type Logo = {
  /** ICAO code of the airline whose logo this is (the brand, not necessarily the operator). */
  code: string
  url: string
  /** Pixel size of the file, for laying it out before it has loaded. */
  w: number
  h: number
  /** Everyday airline name for alt text, when known. */
  name: string | null
}

const BASE = `${import.meta.env.BASE_URL ?? '/'}airline-logos/`
/** After a failed index fetch (offline), try again on the next request after this long. */
const RETRY_MS = 30_000

let index: Map<string, [number, number]> | null = null
let pending: Promise<void> | null = null
let failedAt = 0
let version = 0
const listeners = new Set<() => void>()

function changed() {
  version++
  for (const l of listeners) l()
}

/** Re-render hook: called whenever the index or a picture finishes loading. */
export function subscribeLogos(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function logosVersion(): number {
  return version
}

/** Start fetching the index (once). Safe to call as often as you like. */
export function loadLogoIndex(): Promise<void> {
  if (index) return Promise.resolve()
  if (pending) return pending
  if (failedAt && performance.now() - failedAt < RETRY_MS) return Promise.resolve()
  pending = fetch(`${BASE}index.json`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((json: { logos?: Record<string, [number, number]> }) => {
      index = new Map(Object.entries(json.logos ?? {}))
      changed()
    })
    .catch(() => {
      failedAt = performance.now()
    })
    .finally(() => {
      pending = null
    })
  return pending
}

/** Test seam: install an index directly. */
export function setLogoIndex(logos: Record<string, [number, number]> | null) {
  index = logos ? new Map(Object.entries(logos)) : null
  changed()
}

/**
 * The logo a callsign should wear: `undefined` while the index is still
 * loading, `null` when there is none (private flights, unknown airlines).
 * Pass the transponder address too where there is one: feeds that don't know
 * the callsign send the address instead, and `ACA123` as an address is not
 * Air Canada.
 */
export function logoFor(callsign: string | null | undefined, icao24?: string | null): Logo | null | undefined {
  if (icao24 && /^[0-9a-f]{6}$/i.test(icao24) && callsign?.toLowerCase() === icao24.toLowerCase()) return null
  const candidates = logoCandidates(callsign)
  if (!candidates.length) return null
  if (!index) {
    void loadLogoIndex()
    return undefined
  }
  for (const code of candidates) {
    const size = index.get(code)
    if (size) return { code, url: `${BASE}${code}.webp`, w: size[0], h: size[1], name: airlineInfo(code)?.name ?? null }
  }
  return null
}

// ---------------------------------------------------------------------------
// Decoded pictures, for drawing onto canvases (the map tags)
// ---------------------------------------------------------------------------

type Picture = { img: HTMLImageElement; ready: boolean; failed: boolean }
const pictures = new Map<string, Picture>()

/** A logo picture that has already loaded, by airline code; null otherwise (never starts a download). */
export function loadedPicture(code: string): HTMLImageElement | null {
  const p = pictures.get(code)
  return p?.ready ? p.img : null
}

/**
 * The decoded picture for a logo, or null until it has loaded. The first
 * call starts the download; a missing or broken file just stays null.
 */
export function logoPicture(logo: Logo): HTMLImageElement | null {
  let p = pictures.get(logo.code)
  if (!p) {
    const img = new Image()
    img.decoding = 'async'
    p = { img, ready: false, failed: false }
    pictures.set(logo.code, p)
    const entry = p
    img.onload = () => {
      entry.ready = img.naturalWidth > 0
      changed()
    }
    img.onerror = () => {
      entry.failed = true
    }
    img.src = logo.url
  }
  return p.ready ? p.img : null
}
