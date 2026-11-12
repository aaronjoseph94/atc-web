/**
 * The automatic camera for the radio: when the tower calls an aircraft (or
 * its pilot answers), ease in to frame it, stay with it while the exchange
 * goes on, then ease back out to the whole airfield a moment after it ends.
 * The same in a replay, where the cue being spoken is the call.
 *
 * Only in automatic mode, which means the person watching has not taken the
 * map: once they drag, zoom or touch it mid-move, or follow a selected
 * flight, this steps aside until "Back to automatic map".
 *
 * The moves are meant to go unnoticed. They are slow (about two seconds),
 * start and stop softly, come in only as far as leaves the surroundings in
 * view, and don't happen at all when the aircraft is already comfortably in
 * frame. A move that something cuts short (the caption appearing changes the
 * map's padding, which stops camera animations) is picked up again from
 * where it stopped, over the time it had left.
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

/** The move onto an aircraft takes between these, longer the further it has to come in. */
export const FLY_MIN_MS = 1600
export const FLY_MAX_MS = 2200
/** The least time given to the rest of a move that something cut short. */
const RESUME_MIN_MS = 900
/** Length of the move back to the airfield. */
const HOME_MS = 2200
/** Pause after the exchange ends before easing back out. */
const RELEASE_DELAY_MS = 2400
/**
 * A beat between the call arriving and the camera starting to move: the
 * caption appears in the same instant and resizes the map's padding, and a
 * move begun before that settles would be stopped as it starts.
 */
const START_DELAY_MS = 260
/** Time constant of the gentle chase that keeps a moving aircraft in frame, and how long the chase takes to come up to it. */
const CHASE_TAU_MS = 620
const CHASE_RAMP_MS = 1400
/** Extra room around a pair of aircraft framed together, in pixels. */
const PAIR_PADDING = 96
/** Already framed: within this much of the middle of the view (a fraction of its shorter side)… */
export const FRAMED_OFFSET = 0.2
/** …and no further out than this, nor closer in than this, relative to the zoom the camera would choose. */
export const FRAMED_ZOOM_OUT = 0.6
export const FRAMED_ZOOM_IN = 1.3

/**
 * Camera easing: a soft start and a soft stop with no rush in the middle
 * (quintic "smootherstep": speed and acceleration are both zero at each end,
 * and the fastest point is under twice the average).
 */
export const cameraEase = (t: number) => {
  const x = Math.min(1, Math.max(0, t))
  return x * x * x * (x * (x * 6 - 15) + 10)
}

/**
 * How close to come in on one aircraft. Modest on purpose: close enough to
 * pick the aircraft out and read its taxiway, wide enough that the runways
 * and terminals around it stay in the picture. Wider still for traffic in the air.
 */
export function focusZoom(a: Pick<LiveAircraft, 'onGround' | 'altitudeFt'>, airport: Pick<AirportConfig, 'zoom' | 'elevationFt'>): number {
  const agl = a.onGround || a.altitudeFt == null ? 0 : a.altitudeFt - airport.elevationFt
  const z = a.onGround ? 14.8 : agl < 2000 ? 13.9 : agl < 6000 ? 13.1 : 12.4
  return Math.min(15.6, Math.max(airport.zoom + 0.8, z))
}

/** Is the aircraft already comfortably in view (`off`: its distance from the middle, as a fraction of the view) at a sensible zoom? Then the camera stays where it is. */
export function alreadyFramed(off: number, zoom: number, want: number): boolean {
  return off <= FRAMED_OFFSET && zoom >= want - FRAMED_ZOOM_OUT && zoom <= want + FRAMED_ZOOM_IN
}

/** How long a move takes: `off` is the pan as a fraction of the view, `dZoom` the zoom change. */
export function flyDuration(off: number, dZoom: number): number {
  const effort = Math.min(1, Math.abs(dZoom) / 2.5 + off / 2)
  return Math.round(FLY_MIN_MS + (FLY_MAX_MS - FLY_MIN_MS) * effort)
}

/**
 * `key`: who is framed. `startAt`: when the move onto them begins.
 * `flyAt`/`flyMs`: when it began and how long it was given. `zoom`: where it
 * is headed. `retries`: times a cut-short move was resumed. `homeAt`: when to
 * start back out; `homeUntil`: when that move should be done.
 */
type State = { key: string | null; startAt: number; flyAt: number; flyMs: number; settleAt: number; homeAt: number; homeUntil: number; zoom: number; retries: number; until: number }

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
export function useRadioCamera(map: MapLibreMap | null, airport: AirportConfig, goHome: (ms?: number, easing?: (t: number) => number) => void, reduceMotion: boolean) {
  const state = useRef<State>({ key: null, startAt: 0, flyAt: 0, flyMs: 0, settleAt: 0, homeAt: 0, homeUntil: 0, zoom: 0, retries: 0, until: 0 })
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

  // A touch on the map while the camera is on its way to (or holding on, or leaving) an aircraft
  // hands the map to the person: the move stops where it is and automatic mode ends.
  useEffect(() => {
    if (!map) return
    const take = (stop: boolean) => {
      const s = usePlayhead.getState()
      const st = state.current
      const steering = st.key != null || st.homeAt > 0 || st.homeUntil > 0
      if (!steering || s.cameraMode !== 'auto') return
      if (stop) map.stop()
      s.setCameraMode('manual')
    }
    // A finger or the mouse going down on the map: stop the move there. (This runs before the map's own
    // gesture handlers see the touch, so stopping doesn't cost them the gesture.)
    const down = () => take(true)
    // Anything else the person does to the camera, such as panning with the arrow keys. The gesture
    // itself already stopped the move; stopping again here would cancel the gesture.
    const moved = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) take(false)
    }
    const canvas = map.getCanvasContainer()
    canvas.addEventListener('pointerdown', down, { passive: true })
    map.on('movestart', moved)
    return () => {
      canvas.removeEventListener('pointerdown', down)
      map.off('movestart', moved)
    }
  }, [map])

  return useCallback(
    (list: LiveAircraft[], dt: number): boolean => {
      const st = state.current
      if (!map) return false
      const s = usePlayhead.getState()
      const now = performance.now()
      const auto = s.cameraMode === 'auto' && !s.selectedIcao && !s.following
      if (!auto) {
        // The user (or a selection) has the map; forget what we were doing.
        st.key = null
        st.homeAt = 0
        st.homeUntil = 0
        busyAt.current = now
        drift.current = null
        return false
      }
      // Who the call is about: the live exchange's aircraft, or whoever a replayed (or re-heard) call names.
      const focus = s.mode === 'live' ? useRadio.getState().focus : null
      const talking = s.activeCallsign?.toLowerCase()
      const ids = focus ? focus.ids : talking ? [talking] : []
      const targets = ids.length ? cameraTargets(list, ids, airport) : []

      if (targets.length) {
        busyAt.current = now
        drift.current = null
        st.homeAt = 0
        st.homeUntil = 0
        // Each new call in the exchange may nudge the layout (and cut a move short) again.
        const until = focus?.until ?? 0
        if (until !== st.until) {
          st.until = until
          st.retries = 0
        }
        const key = targets.map((a) => a.icao24).join(',')
        if (key !== st.key) {
          st.key = key
          st.retries = 0
          st.flyMs = 0
          st.startAt = now + (reduceMotion ? 0 : START_DELAY_MS)
        }
        if (now < st.startAt) return true
        if (!st.flyMs) {
          const plan = framing(map, targets, airport)
          if (alreadyFramed(offCentre(map, targets), map.getZoom(), plan.zoom)) {
            // In view already, at a zoom that shows it well: leave the camera be, and just keep the aircraft in frame.
            st.flyMs = 1
            st.flyAt = now
            st.settleAt = now
            st.zoom = map.getZoom()
          } else {
            st.flyMs = flyDuration(offCentre(map, targets), plan.zoom - map.getZoom())
            st.flyAt = now
            st.settleAt = now + (reduceMotion ? 0 : st.flyMs)
            st.zoom = plan.zoom
            move(map, plan, reduceMotion ? 0 : st.flyMs)
          }
        } else if (!map.isMoving()) {
          // Something stopped the move part-way (the map's padding changes as the caption
          // appears, which cancels camera animations): carry on from here over the time it had left.
          const short = Math.abs(map.getZoom() - st.zoom) > 0.08 || offCentre(map, targets) > 0.25
          if (short && now < st.settleAt + 400 && st.retries < 3) {
            st.retries++
            const left = Math.max(RESUME_MIN_MS, st.settleAt - now)
            st.settleAt = now + (reduceMotion ? 0 : left)
            move(map, { ...framing(map, targets, airport), zoom: st.zoom }, reduceMotion ? 0 : left)
          } else if (now >= st.settleAt) chase(map, targets, reduceMotion ? 1 : cameraEase((now - st.settleAt) / CHASE_RAMP_MS) * (1 - Math.exp(-dt / CHASE_TAU_MS)))
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
          st.homeUntil = reduceMotion ? 0 : now + HOME_MS
          goHome(HOME_MS, cameraEase)
        }
        return true
      }
      if (st.homeUntil) {
        // On the way back out. The caption leaving resizes the map's padding and stops the move: finish it over the time it had left.
        busyAt.current = now
        if (now >= st.homeUntil - 120) st.homeUntil = 0
        else if (!map.isMoving()) goHome(Math.max(RESUME_MIN_MS, st.homeUntil - now), cameraEase)
        return true
      }
      if (s.mode === 'live') idleDrift(map, s, now, reduceMotion, busyAt, drift)
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

type Framing = { center: [number, number]; zoom: number }

/** Where the camera should sit for these aircraft: on one, or around a pair (a traffic call). */
function framing(map: MapLibreMap, targets: LiveAircraft[], airport: AirportConfig): Framing {
  if (targets.length === 1) return { center: [targets[0].lon, targets[0].lat], zoom: focusZoom(targets[0], airport) }
  let w = Infinity
  let so = Infinity
  let e = -Infinity
  let n = -Infinity
  let closest = Infinity
  for (const a of targets) {
    w = Math.min(w, a.lon)
    e = Math.max(e, a.lon)
    so = Math.min(so, a.lat)
    n = Math.max(n, a.lat)
    closest = Math.min(closest, focusZoom(a, airport))
  }
  const cam = map.cameraForBounds([[w, so], [e, n]], { padding: PAIR_PADDING, maxZoom: closest })
  const c = cam?.center as { lng: number; lat: number } | [number, number] | undefined
  const center: [number, number] = Array.isArray(c) ? c : c ? [c.lng, c.lat] : [(w + e) / 2, (so + n) / 2]
  return { center, zoom: cam?.zoom ?? map.getZoom() }
}

/** One continuous eased move (a cut with reduced motion). Never an arc out and back: the airfield stays in view throughout. */
function move(map: MapLibreMap, to: Framing, duration: number) {
  if (duration <= 0) map.jumpTo({ center: to.center, zoom: to.zoom })
  else map.easeTo({ center: to.center, zoom: to.zoom, bearing: map.getBearing(), duration, easing: cameraEase, essential: true })
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

/** Keep a moving aircraft (or the middle of a pair) in frame without jerks: close the fraction `k` of the gap this frame. */
function chase(map: MapLibreMap, targets: LiveAircraft[], k: number) {
  let lon = 0
  let lat = 0
  for (const a of targets) {
    lon += a.lon / targets.length
    lat += a.lat / targets.length
  }
  const c = map.getCenter()
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
