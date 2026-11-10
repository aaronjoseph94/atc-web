/**
 * A small picture of the map for a feedback report. The map is WebGL and
 * doesn't keep its last frame, so we ask it to draw once more and copy the
 * canvas inside that frame. Only the map: the app's own panels are DOM and
 * would need a page-rendering library, which isn't worth its weight here.
 */
import { mapHandle } from '../live/session'

/** Longest side of the picture, in pixels. Keeps the upload around 50–120 KB. */
const MAX_SIDE = 760

export function captureMap(): Promise<string | null> {
  const map = mapHandle.current
  if (!map) return Promise.resolve(null)
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), 1500)
    map.once('render', () => {
      window.clearTimeout(timer)
      try {
        const src = map.getCanvas()
        const scale = Math.min(1, MAX_SIDE / Math.max(src.width, src.height))
        const out = document.createElement('canvas')
        out.width = Math.max(1, Math.round(src.width * scale))
        out.height = Math.max(1, Math.round(src.height * scale))
        const ctx = out.getContext('2d')
        if (!ctx) return resolve(null)
        ctx.drawImage(src, 0, 0, out.width, out.height)
        resolve(out.toDataURL('image/jpeg', 0.72))
      } catch {
        // A tainted or lost context: carry on without a picture.
        resolve(null)
      }
    })
    map.triggerRepaint()
  })
}
