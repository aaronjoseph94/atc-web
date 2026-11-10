/**
 * Extra map gestures: press and hold (touch) or right-click (mouse) to glide
 * the map to that spot, with a ripple where the finger was. Right-drag still
 * turns the map; only a right-click that stays put counts.
 */
import type { MapMouseEvent, MapTouchEvent } from 'maplibre-gl'
import { useEffect, useState } from 'react'
import { usePlayhead } from '../playback/playheadStore'
import { haptic } from '../ui/motion'
import { cameraNudge } from './camera'
import { useMap } from './useMap'

/** How long a press must last to count as a long press; just over MapLibre's longest tap. */
const LONG_PRESS_MS = 520
/** Finger travel that turns a press into a pan. */
const MOVE_TOLERANCE_PX = 8

type Ripple = { id: number; x: number; y: number }

export function MapGestures() {
  const map = useMap()
  const [ripples, setRipples] = useState<Ripple[]>([])

  useEffect(() => {
    if (!map) return
    let nextId = 0
    const centre = (e: { lngLat: { lng: number; lat: number }; point: { x: number; y: number } }) => {
      // Moving the map by hand takes the camera, as a drag would.
      const s = usePlayhead.getState()
      if (s.following) s.setFollowing(false)
      if (s.cameraMode !== 'manual') s.setCameraMode('manual')
      cameraNudge.centreOn([e.lngLat.lng, e.lngLat.lat])
      haptic(10)
      const id = ++nextId
      const rect = map.getContainer().getBoundingClientRect()
      setRipples((list) => [...list, { id, x: e.point.x + rect.left, y: e.point.y + rect.top }])
      window.setTimeout(() => setRipples((list) => list.filter((r) => r.id !== id)), 700)
    }

    // Touch: hold still for a moment.
    let timer = 0
    let start: { x: number; y: number } | null = null
    const cancel = () => {
      window.clearTimeout(timer)
      start = null
    }
    const touchStart = (e: MapTouchEvent) => {
      cancel()
      if (e.originalEvent.touches.length !== 1) return
      start = { x: e.point.x, y: e.point.y }
      const at = { lngLat: e.lngLat, point: e.point }
      timer = window.setTimeout(() => {
        if (start) centre(at)
        start = null
      }, LONG_PRESS_MS)
    }
    const touchMove = (e: MapTouchEvent) => {
      if (!start) return
      if (e.originalEvent.touches.length !== 1 || Math.hypot(e.point.x - start.x, e.point.y - start.y) > MOVE_TOLERANCE_PX) cancel()
    }

    // Mouse: a right-click that didn't turn into a rotate.
    let rightDown: { x: number; y: number } | null = null
    let turned = false
    const mouseDown = (e: MapMouseEvent) => {
      if (e.originalEvent.button !== 2) return
      rightDown = { x: e.point.x, y: e.point.y }
      turned = false
    }
    const rotateStart = () => {
      turned = true
    }
    const mouseUp = (e: MapMouseEvent) => {
      if (e.originalEvent.button !== 2 || !rightDown) return
      const still = Math.hypot(e.point.x - rightDown.x, e.point.y - rightDown.y) <= MOVE_TOLERANCE_PX / 2
      rightDown = null
      if (still && !turned) centre(e)
    }
    // The browser's own context menu has nothing useful for a map.
    const noMenu = (e: Event) => e.preventDefault()
    const canvas = map.getCanvasContainer()

    map.on('touchstart', touchStart)
    map.on('touchmove', touchMove)
    map.on('touchend', cancel)
    map.on('touchcancel', cancel)
    map.on('mousedown', mouseDown)
    map.on('mouseup', mouseUp)
    map.on('rotatestart', rotateStart)
    canvas.addEventListener('contextmenu', noMenu)
    return () => {
      cancel()
      map.off('touchstart', touchStart)
      map.off('touchmove', touchMove)
      map.off('touchend', cancel)
      map.off('touchcancel', cancel)
      map.off('mousedown', mouseDown)
      map.off('mouseup', mouseUp)
      map.off('rotatestart', rotateStart)
      canvas.removeEventListener('contextmenu', noMenu)
    }
  }, [map])

  return (
    <>
      {ripples.map((r) => (
        <span key={r.id} aria-hidden className="pointer-events-none fixed z-30 size-16 -translate-x-1/2 -translate-y-1/2 animate-ripple rounded-full border-2 border-white/80 bg-white/15" style={{ left: r.x, top: r.y }} />
      ))}
    </>
  )
}
