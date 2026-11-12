/**
 * Keeps the base map coming back after a bad connection.
 *
 * MapLibre asks for the base map's tile index (`/planet`) once. If that one
 * request fails (a dropped mobile connection, a slow start, a blocked request)
 * it never asks again, and the whole base map (land, water, grass, aprons,
 * taxiways, buildings) stays missing for the session while the app's own
 * layers still draw. Single failed tiles are refetched as the map moves, but
 * a missing index is not.
 *
 * This watches for the base source failing and re-requests it with a growing
 * pause (2 s, 4 s, 8 s… up to 30 s), and at once when the device comes back
 * online or the page is shown again. It stops as soon as the source loads.
 */
import type { Map as MapLibreMap, MapSourceDataEvent, VectorTileSource } from 'maplibre-gl'

export const BASE_SOURCE = 'omt'
const FIRST_RETRY_MS = 2000
const MAX_RETRY_MS = 30_000

/** Pause before retry number `n` (0-based). */
export function retryDelay(n: number): number {
  return Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** n)
}

export function watchBaseMap(map: MapLibreMap): () => void {
  let attempts = 0
  let timer: number | undefined
  let healthy = false

  const source = () => map.getSource(BASE_SOURCE) as VectorTileSource | undefined
  // MapLibre marks a source "loaded" even when its index request failed; the tile list it would have
  // read from the index is the real sign that it worked.
  const hasIndex = () => !!source()?.tiles?.length
  const reload = () => {
    timer = undefined
    const src = source()
    const url = src?.url
    if (!src || !url) return
    attempts += 1
    try {
      src.setUrl(url)
    } catch {
      // The style may be mid-swap; the next error or reconnect tries again.
    }
  }
  const schedule = (now = false) => {
    if (healthy || timer !== undefined) return
    timer = window.setTimeout(reload, now ? 0 : retryDelay(attempts))
  }

  const onError = (e: { sourceId?: string; error?: unknown }) => {
    if (e.sourceId !== BASE_SOURCE) return
    // A tile failing while the index loaded is routine (it is refetched as the map moves);
    // only a source that never loaded needs a nudge.
    if (!hasIndex()) {
      healthy = false
      schedule()
    }
  }
  const onData = (e: MapSourceDataEvent) => {
    if (e.sourceId === BASE_SOURCE && hasIndex()) {
      healthy = true
      attempts = 0
    }
  }
  const onOnline = () => {
    if (!healthy) schedule(true)
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible' && !healthy) schedule(true)
  }

  map.on('error', onError as never)
  map.on('sourcedata', onData)
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)
  // If the index failed before this was attached, there is no error left to hear: check once shortly after.
  const initial = window.setTimeout(() => {
    if (!map.getSource(BASE_SOURCE)) return
    if (hasIndex()) healthy = true
    else schedule()
  }, 4000)

  return () => {
    window.clearTimeout(initial)
    if (timer !== undefined) window.clearTimeout(timer)
    map.off('error', onError as never)
    map.off('sourcedata', onData)
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
