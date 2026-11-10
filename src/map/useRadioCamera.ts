/**
 * The automatic camera for live radio: when the controller calls an
 * aircraft (or a pilot answers), glide in to frame it, stay with it while
 * the exchange goes on, then ease back out to the whole airfield a few
 * seconds after it ends.
 *
 * Only in automatic mode: once the user drags or zooms, or follows a
 * selected flight, this steps aside and `MapView` does what it always did.
 * Moves are long and eased so they read as one continuous camera, and every
 * one is interruptible (a drag stops it and hands the map to the user).
 */
import { useCallback, useRef } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { AirportConfig } from '../api/airports'
import { useRadio } from '../live/radio/radioStore'
import { usePlayhead } from '../playback/playheadStore'
import type { LiveAircraft } from './livePositions'

/** Length of the move onto an aircraft. */
const FLY_MS = 1700
/** Length of the rest of a move that something cut short. */
const RESUME_MS = 1100
/** Length of the move back to the airfield. */
const HOME_MS = 1900
/** Pause after the exchange ends before easing back out. */
const RELEASE_DELAY_MS = 2600
/** Time constant of the gentle chase that keeps a moving aircraft in frame. */
const CHASE_TAU_MS = 520
/** Extra room around a pair of aircraft framed together, in pixels. */
const PAIR_PADDING = 80

/** Smooth start, smooth stop. */
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/** How close to come in on one aircraft: tight on the taxiways, wider for traffic in the air. */
export function focusZoom(a: Pick<LiveAircraft, 'onGround' | 'altitudeFt'>, airport: Pick<AirportConfig, 'zoom' | 'elevationFt'>): number {
  const agl = a.onGround || a.altitudeFt == null ? 0 : a.altitudeFt - airport.elevationFt
  const z = a.onGround ? 15.3 : agl < 2000 ? 14.2 : agl < 6000 ? 13.2 : 12.4
  return Math.min(16, Math.max(airport.zoom + 0.8, z))
}

/** `key`: who is framed. `zoom`: where the move was headed. `retries`: times a cut-short move was resumed. */
type State = { key: string | null; settleAt: number; homeAt: number; zoom: number; retries: number }

/**
 * Returns a per-frame function for `MapView`'s frame loop. It returns true
 * while the radio is steering the camera, so the map's own automatic camera
 * stays out of the way.
 */
export function useRadioCamera(map: MapLibreMap | null, airport: AirportConfig, goHome: (ms?: number) => void, reduceMotion: boolean) {
  const state = useRef<State>({ key: null, settleAt: 0, homeAt: 0, zoom: 0, retries: 0 })

  return useCallback(
    (list: LiveAircraft[], dt: number): boolean => {
      const st = state.current
      if (!map) return false
      const s = usePlayhead.getState()
      const auto = s.mode === 'live' && s.cameraMode === 'auto' && !s.selectedIcao && !s.following
      if (!auto) {
        // The user (or a selection) has the map; forget what we were doing.
        st.key = null
        st.homeAt = 0
        return false
      }
      const now = performance.now()
      const focus = useRadio.getState().focus
      const targets = focus ? focus.ids.map((id) => list.find((a) => a.icao24 === id)).filter((a): a is LiveAircraft => !!a) : []

      if (targets.length) {
        st.homeAt = 0
        const key = targets.map((a) => a.icao24).join(',')
        if (key !== st.key) {
          st.key = key
          st.retries = 0
          st.settleAt = now + (reduceMotion ? 0 : FLY_MS)
          st.zoom = frame(map, targets, airport, reduceMotion, FLY_MS)
        } else if (!map.isMoving()) {
          // Something stopped the move halfway (the map's padding changes as the
          // caption appears, which cancels camera animations): carry on from here.
          if (Math.abs(map.getZoom() - st.zoom) > 0.08 && st.retries < 3) {
            st.retries++
            st.settleAt = now + (reduceMotion ? 0 : RESUME_MS)
            st.zoom = frame(map, targets, airport, reduceMotion, RESUME_MS)
          } else if (now >= st.settleAt) chase(map, targets, dt, reduceMotion)
        }
        return true
      }

      if (st.key) {
        // The exchange is over: hold a moment, then pull back.
        st.key = null
        st.homeAt = now + (reduceMotion ? 600 : RELEASE_DELAY_MS)
        return true
      }
      if (st.homeAt) {
        if (now >= st.homeAt) {
          st.homeAt = 0
          goHome(HOME_MS)
          return false
        }
        return true
      }
      return false
    },
    [map, airport, goHome, reduceMotion],
  )
}

/**
 * Move onto the aircraft: a flight for a long way, a glide for a short one, a
 * cut with reduced motion. Returns the zoom it is heading for.
 */
function frame(map: MapLibreMap, targets: LiveAircraft[], airport: AirportConfig, reduceMotion: boolean, duration: number): number {
  if (targets.length === 1) {
    const a = targets[0]
    const zoom = focusZoom(a, airport)
    if (reduceMotion) {
      map.jumpTo({ center: [a.lon, a.lat], zoom })
      return zoom
    }
    const here = map.project(map.getCenter())
    const there = map.project([a.lon, a.lat])
    const far = Math.hypot(there.x - here.x, there.y - here.y) > map.getCanvas().clientWidth * 0.6 || Math.abs(map.getZoom() - zoom) > 1.6
    const opts = { center: [a.lon, a.lat] as [number, number], zoom, bearing: map.getBearing(), duration, easing: easeInOutCubic, essential: true }
    if (far) map.flyTo({ ...opts, curve: 1.25 })
    else map.easeTo(opts)
    return zoom
  }
  // Two parties (a traffic call): frame both.
  let w = Infinity
  let so = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const a of targets) {
    w = Math.min(w, a.lon)
    e = Math.max(e, a.lon)
    so = Math.min(so, a.lat)
    n = Math.max(n, a.lat)
  }
  const cam = map.cameraForBounds([[w, so], [e, n]], { padding: PAIR_PADDING, maxZoom: 15.3 })
  if (!cam) return map.getZoom()
  if (reduceMotion) map.jumpTo(cam)
  else map.flyTo({ ...cam, duration, easing: easeInOutCubic, curve: 1.25, essential: true })
  return cam.zoom ?? map.getZoom()
}

/** Keep a moving aircraft (or the middle of a pair) in frame without jerks. */
function chase(map: MapLibreMap, targets: LiveAircraft[], dt: number, reduceMotion: boolean) {
  let lon = 0
  let lat = 0
  for (const a of targets) {
    lon += a.lon / targets.length
    lat += a.lat / targets.length
  }
  const c = map.getCenter()
  const k = reduceMotion ? 1 : 1 - Math.exp(-dt / CHASE_TAU_MS)
  const lng = c.lng + (lon - c.lng) * k
  const la = c.lat + (lat - c.lat) * k
  if (Math.abs(lng - c.lng) > 1e-7 || Math.abs(la - c.lat) > 1e-7) map.jumpTo({ center: [lng, la] })
}
