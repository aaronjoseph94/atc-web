/** Camera nudges shared by the map buttons and the keyboard: quick, with no wind-up. */
import { mapHandle } from '../live/session'
import { CAMERA_EASE_OUT, reducedMotion } from '../ui/motion'

export const cameraNudge = {
  zoom(by: number) {
    const map = mapHandle.current
    if (!map) return
    map.easeTo({ zoom: map.getZoom() + by, duration: reducedMotion() ? 0 : 320, easing: CAMERA_EASE_OUT })
  },
  northUp() {
    mapHandle.current?.easeTo({ bearing: 0, duration: reducedMotion() ? 0 : 500, easing: CAMERA_EASE_OUT })
  },
  /** Glide to a point, keeping the zoom (long-press / right-click on the map). */
  centreOn(lngLat: [number, number]) {
    mapHandle.current?.easeTo({ center: lngLat, duration: reducedMotion() ? 0 : 600, easing: CAMERA_EASE_OUT })
  },
}
