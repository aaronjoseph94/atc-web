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
import { useCallback, useEffect, useRef } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { AirportConfig } from '../api/airports'
import { atOtherField } from '../live/radio/match'
import { useRadio } from '../live/radio/radioStore'
import { usePlayhead } from '../playback/playheadStore'
import { reducedMotion } from '../ui/motion'
import { driftAt, IDLE_MS } from './drift'
import { metersPerDegLat, metersPerDegLon } from './geo'
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
type State = { key: string | null; settleAt: number; homeAt: number; zoom: number; retries: number; until: number }

/**
 * The idle drift in progress: where and when it began, and the camera it
 * last set, so a move made by anything else is noticed and ends the drift.
 */
type Drift = { start: number; lng: number; lat: number; zoom: number; set: [number, number, number] | null }

/**
 * Returns a per-frame function for `MapView`'s frame loop. It returns true
 * while the radio is steering the camera, so the map's own automatic camera
 * stays out of the way.
 */
export function useRadioCamera(map: MapLibreMap | null, airport: AirportConfig, goHome: (ms?: number) => void, reduceMotion: boolean) {
  const state = useRef<State>({ key: null, settleAt: 0, homeAt: 0, zoom: 0, retries: 0, until: 0 })
  // Last time anything happened to the camera (input, or a move the drift didn't make).
  const busyAt = useRef(0)
  const drift = useRef<Drift | null>(null)

  // Any touch, click, wheel or key, anywhere, ends the drift on the spot and restarts the idle wait.
  useEffect(() => {
    busyAt.current = performance.now()
    const poke = () => {
      busyAt.current = performance.now()
      drift.current = null
    }
    const opts = { capture: true, passive: true }
    const kinds = ['pointerdown', 'wheel', 'touchstart', 'keydown'] as const
    for (const k of kinds) window.addEventListener(k, poke, opts)
    return () => {
      for (const k of kinds) window.removeEventListener(k, poke, opts)
    }
  }, [])

  return useCallback(
    (list: LiveAircraft[], dt: number): boolean => {
      const st = state.current
      if (!map) return false
      const s = usePlayhead.getState()
      const now = performance.now()
      const auto = s.mode === 'live' && s.cameraMode === 'auto' && !s.selectedIcao && !s.following
      if (!auto) {
        // The user (or a selection) has the map; forget what we were doing.
        st.key = null
        st.homeAt = 0
        busyAt.current = now
        drift.current = null
        return false
      }
      const focus = useRadio.getState().focus
      const targets = focus ? cameraTargets(list, focus.ids, airport) : []

      if (targets.length) {
        busyAt.current = now
        drift.current = null
        st.homeAt = 0
        // Each new call in the exchange may nudge the layout (and cut a move short) again.
        if (focus && focus.until !== st.until) {
          st.until = focus.until
          st.retries = 0
        }
        const key = targets.map((a) => a.icao24).join(',')
        if (key !== st.key) {
          st.key = key
          st.retries = 0
          st.settleAt = now + (reduceMotion ? 0 : FLY_MS)
          st.zoom = frame(map, targets, airport, reduceMotion, FLY_MS)
        } else if (!map.isMoving()) {
          // Something stopped the move halfway (the map's padding changes as the
          // caption appears, which cancels camera animations): carry on from here.
          if ((Math.abs(map.getZoom() - st.zoom) > 0.08 || offCentre(map, targets) > 0.25) && st.retries < 3) {
            st.retries++
            st.settleAt = now + (reduceMotion ? 0 : RESUME_MS)
            st.zoom = frame(map, targets, airport, reduceMotion, RESUME_MS, true)
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
        busyAt.current = now
        if (now >= st.homeAt) {
          st.homeAt = 0
          goHome(HOME_MS)
          return false
        }
        return true
      }
      idleDrift(map, s, now, reduceMotion, busyAt, drift)
      return false
    },
    [map, airport, goHome, reduceMotion],
  )

}

/**
 * The aircraft a call is about that the camera should go to: those on the
 * map, leaving out any on the ground at another airport (they keep their
 * highlight, but flying the camera across to LaGuardia for a JFK frequency
 * would lose the airfield the user is watching).
 */
export function cameraTargets(list: LiveAircraft[], ids: string[], airport: Pick<AirportConfig, 'center' | 'elevationFt'>): LiveAircraft[] {
  const out: LiveAircraft[] = []
  for (const id of ids) {
    const a = list.find((x) => x.icao24 === id)
    if (a && !atOtherField(a, airport)) out.push(a)
  }
  return out
}

/**
 * Move onto the aircraft: a flight for a long way, a glide for a short one, a
 * cut with reduced motion. Returns the zoom it is heading for.
 */
function frame(map: MapLibreMap, targets: LiveAircraft[], airport: AirportConfig, reduceMotion: boolean, duration: number, resume = false): number {
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
    // Picking up a cut-short move never arcs out again.
    if (far && !resume) map.flyTo({ ...opts, curve: 1.25 })
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
  else if (resume) map.easeTo({ ...cam, duration, easing: easeInOutCubic, essential: true })
  else map.flyTo({ ...cam, duration, easing: easeInOutCubic, curve: 1.25, essential: true })
  return cam.zoom ?? map.getZoom()
}

/** How far the aircraft (or the middle of a pair) sits from the middle of the view, as a fraction of its shorter side. */
function offCentre(map: MapLibreMap, targets: LiveAircraft[]): number {
  let lon = 0
  let lat = 0
  for (const a of targets) {
    lon += a.lon / targets.length
    lat += a.lat / targets.length
  }
  const c = map.project(map.getCenter())
  const p = map.project([lon, lat])
  const canvas = map.getCanvas()
  return Math.hypot(p.x - c.x, p.y - c.y) / Math.max(1, Math.min(canvas.clientWidth, canvas.clientHeight))
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

/**
 * Nothing on the air and nobody touching the map: after a quiet spell, let
 * the camera drift. Anything else moving the camera (the map's own
 * automatic camera, a padding change, an animation) counts as activity.
 */
function idleDrift(map: MapLibreMap, s: ReturnType<typeof usePlayhead.getState>, now: number, reduceMotion: boolean, busyAt: { current: number }, drift: { current: Drift | null }) {
  const talking = s.activeCallsign ?? s.caption?.icao24
  if (reduceMotion || talking || map.isMoving() || reducedMotion()) {
    busyAt.current = now
    drift.current = null
    return
  }
  const c = map.getCenter()
  const z = map.getZoom()
  let d = drift.current
  if (d?.set && (Math.abs(d.set[0] - c.lng) > 1e-9 || Math.abs(d.set[1] - c.lat) > 1e-9 || Math.abs(d.set[2] - z) > 1e-6)) {
    // Someone else moved the camera since the last drift frame.
    busyAt.current = now
    drift.current = d = null
  }
  if (now - busyAt.current < IDLE_MS) return
  if (!d) d = drift.current = { start: now, lng: c.lng, lat: c.lat, zoom: z, set: null }
  const off = driftAt(now - d.start, d.zoom)
  const lng = d.lng + off.east / metersPerDegLon(d.lat)
  const lat = d.lat + off.north / metersPerDegLat(d.lat)
  map.jumpTo({ center: [lng, lat], zoom: d.zoom + off.zoom })
  // Read back what the map made of it (it may round), to compare next frame.
  const after = map.getCenter()
  d.set = [after.lng, after.lat, map.getZoom()]
}
