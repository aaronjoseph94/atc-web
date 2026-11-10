/**
 * Every bitmap the map draws is made in code, on first use. MapLibre asks
 * for an image it hasn't got through one resolver per map
 * (`setMissingStyleImageResolver`), and waits for it before laying out the
 * tile. The older `styleimagemissing` event comes too late: MapLibre logs an
 * "Image … could not be loaded" warning and lays the tile out without the
 * image first, so a new aircraft class, light combination or tag blinks in a
 * frame late and the console fills with warnings.
 *
 * The resolver is installed as soon as the map exists, before any tile is
 * parsed, and the layers that draw their own images add a handler for their
 * ids while they are mounted.
 */
import type { Map as MapLibreMap } from 'maplibre-gl'

/** Draws the image `id` if it is one of its own (and leaves others alone). */
export type ImageHandler = (map: MapLibreMap, id: string) => void

const handlers = new WeakMap<MapLibreMap, ImageHandler[]>()

function install(map: MapLibreMap): ImageHandler[] {
  let list = handlers.get(map)
  if (list) return list
  const own: ImageHandler[] = []
  list = own
  handlers.set(map, own)
  // Older MapLibre builds have no resolver; the layers' own `styleimagemissing` fallback covers them.
  if (typeof map.setMissingStyleImageResolver !== 'function') return own
  map.setMissingStyleImageResolver((id) => {
    for (const h of [...own]) {
      if (map.hasImage(id)) return
      try {
        h(map, id)
      } catch {
        // One broken drawing must not stop the tile; MapLibre leaves the symbol out.
      }
    }
  })
  return own
}

/**
 * Set the map up to draw images on request, with the handlers that need
 * nothing but the map (call once, as early as possible).
 */
export function installImageResolver(map: MapLibreMap, base: ImageHandler[] = []) {
  const list = install(map)
  for (const h of base) if (!list.includes(h)) list.push(h)
}

/** Add a handler while a layer is mounted; returns the function that removes it. */
export function addImageHandler(map: MapLibreMap, handler: ImageHandler): () => void {
  const list = install(map)
  list.push(handler)
  return () => {
    const i = list.indexOf(handler)
    if (i >= 0) list.splice(i, 1)
  }
}
