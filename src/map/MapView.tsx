/**
 * Full-bleed MapLibre map. Owns the live traffic query, the camera and the
 * map-level toggles (theme, radar); delegates per-frame drawing to
 * `AircraftLayer` and the painted airfield to `AirportDiagramLayer`.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Map as MapLibreMap, RasterTileSource } from 'maplibre-gl'
import { getAirport } from '../api/airports'
import { getAircraft } from '../api/client'
import { TRAFFIC_ATTRIBUTION } from '../api/credits'
import { detectEvents } from '../live/events'
import { eventState, liveBuffer, liveRecorder, mapHandle, resetLiveSession } from '../live/session'
import { usePlayhead } from '../playback/playheadStore'
import { useSettings } from '../settings/settingsStore'
import { CAMERA_EASE } from '../ui/motion'
import { AircraftLayer } from './AircraftLayer'
import { runwayEnds } from './airportDiagram'
import { AirportDiagramLayer } from './AirportDiagramLayer'
import type { LiveAircraft } from './livePositions'
import { applyGroundCover, applyTheme, buildStyle, effectiveTheme, LAYER, radarTiles, themeHasVectorBase } from './mapStyle'
import { useRadioCamera } from './useRadioCamera'

/** Extra zoom applied when the camera closes in on a talking/selected aircraft. */
const FOCUS_ZOOM_BOOST = 1.5
const FOCUS_ZOOM_MAX = 15.6
/** Delay before easing back out once nobody is talking or selected. */
const UNFOCUS_DELAY_MS = 1600
/** Time constant of the follow camera; lower is tighter. */
const FOLLOW_TAU_MS = 260

// Lazy so the ~1 MB MapLibre bundle doesn't block first paint. The worker URL
// must be configured before the first Map is constructed (see maplibreSetup).
// Named MapGL to avoid shadowing the global `Map`.
const MapGL = lazy(async () => {
  await import('./maplibreSetup')
  const m = await import('react-map-gl/maplibre')
  return { default: m.Map }
})

/**
 * Camera target bookkeeping, read and written from the frame loop:
 * `id` is who the camera is on, `settleAt` when the opening ease finishes
 * (smooth following starts after it), `homeAt` when to drift back out.
 * Module-level because there is one map and this never drives rendering.
 */
const focus: { id: string | null; settleAt: number; homeAt: number } = { id: null, settleAt: 0, homeAt: 0 }

function resetFocus(homeAt = 0) {
  focus.id = null
  focus.settleAt = 0
  focus.homeAt = homeAt
}

/** Space the floating chrome takes at the top and bottom, so the camera frames around it. */
function chromePadding() {
  const bottom = document.getElementById('bottom-stack')?.offsetHeight ?? 150
  const wide = window.innerWidth >= 768
  return { top: 76, bottom: Math.min(bottom + (wide ? 24 : 8), window.innerHeight * 0.62), left: 0, right: 0 }
}

export function MapView() {
  // Set once the style has loaded; everything map-side keys off this.
  const [map, setMap] = useState<MapLibreMap | null>(null)
  const [failed, setFailed] = useState(false)

  const mode = usePlayhead((s) => s.mode)
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const cameraMode = usePlayhead((s) => s.cameraMode)
  const sheet = usePlayhead((s) => s.sheet)
  const select = usePlayhead((s) => s.select)
  const setLive = usePlayhead((s) => s.setLive)

  const pollSeconds = useSettings((s) => s.pollSeconds)
  const labels = useSettings((s) => s.labels)
  const dataBlocks = useSettings((s) => s.dataBlocks)
  const hideGround = useSettings((s) => s.hideGround)
  const trailLength = useSettings((s) => s.trailLength)
  const trails = useSettings((s) => s.trails)
  const shadows = useSettings((s) => s.shadows)
  const approachPaths = useSettings((s) => s.approachPaths)
  const weatherRadar = useSettings((s) => s.weatherRadar)
  const reduceMotion = useSettings((s) => s.reduceMotion)
  const mapTheme = useSettings((s) => s.mapTheme)

  const airport = useMemo(() => getAirport(airportIcao), [airportIcao])
  const isUs = airport.group === 'US'
  const theme = effectiveTheme(mapTheme, isUs)
  const ends = useMemo(() => runwayEnds(airportIcao), [airportIcao])

  // ---- live traffic polling --------------------------------------------
  const query = useQuery({
    queryKey: ['aircraft', airportIcao],
    queryFn: () => getAircraft(airportIcao),
    refetchInterval: pollSeconds * 1000,
    enabled: mode === 'live',
    retry: 1,
  })

  // A new airport starts a new session: stale positions, history and event memory go.
  useEffect(() => resetLiveSession, [airportIcao])

  const { data, dataUpdatedAt, isError, isPending } = query
  useEffect(() => {
    if (mode !== 'live') return
    if (isError) {
      setLive('error', undefined, null)
    } else if (data) {
      const now = dataUpdatedAt || Date.now()
      liveBuffer.push(data.aircraft)
      liveRecorder.push(data.aircraft, now)
      const events = detectEvents(eventState, data.aircraft, ends, airport.elevationFt, now)
      if (events.length) {
        liveRecorder.addEvents(events)
        usePlayhead.getState().addEvents(events)
      }
      setLive('ok', data.aircraft.length, data.provider)
    } else if (isPending) {
      setLive('loading')
    }
  }, [data, dataUpdatedAt, isError, isPending, mode, ends, airport.elevationFt, setLive])

  // ---- camera ---------------------------------------------------------------
  const duration = useCallback((ms: number) => (reduceMotion ? 0 : ms), [reduceMotion])

  const goHome = useCallback(
    (ms = 1100) => {
      if (!map) return
      map.fitBounds(airport.bounds, { padding: 36, maxZoom: 14.4, duration: duration(ms), easing: CAMERA_EASE, essential: true, bearing: 0 })
    },
    [map, airport, duration],
  )

  // Keep the camera's idea of "centre" clear of the floating chrome.
  useEffect(() => {
    if (!map) return
    const apply = () => {
      const want = chromePadding()
      const have = map.getPadding()
      // Setting padding stops any camera move in flight, so only do it for a real change,
      // and re-frame afterwards if the app is the one steering.
      if (Math.abs((have.top ?? 0) - want.top) < 2 && Math.abs((have.bottom ?? 0) - want.bottom) < 2) return
      map.setPadding(want)
      const s = usePlayhead.getState()
      if (s.cameraMode === 'auto' && !s.selectedIcao && !focus.id) focus.homeAt = performance.now()
    }
    apply()
    const stack = document.getElementById('bottom-stack')
    const ro = stack ? new ResizeObserver(apply) : null
    if (stack) ro?.observe(stack)
    window.addEventListener('resize', apply)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', apply)
    }
  }, [map, sheet])

  // Airport change (and first load): frame the whole airfield.
  useEffect(() => {
    resetFocus()
    goHome()
  }, [goHome])

  // Handing the map back to the app re-frames whatever it would be looking at.
  useEffect(() => {
    if (cameraMode === 'auto') resetFocus(performance.now())
  }, [cameraMode])

  // The user taking the map: stop following, stop auto-framing.
  useEffect(() => {
    if (!map) return
    const takeOver = (e: { originalEvent?: unknown }) => {
      if (!e.originalEvent) return
      const s = usePlayhead.getState()
      if (s.following) s.setFollowing(false)
      if (s.cameraMode !== 'manual') s.setCameraMode('manual')
    }
    // Zooming or turning the map while locked onto an aircraft keeps the lock.
    const adjust = (e: { originalEvent?: unknown }) => {
      if (!e.originalEvent || usePlayhead.getState().following) return
      if (usePlayhead.getState().cameraMode !== 'manual') usePlayhead.getState().setCameraMode('manual')
    }
    map.on('dragstart', takeOver)
    map.on('zoomstart', adjust)
    map.on('rotatestart', adjust)
    return () => {
      map.off('dragstart', takeOver)
      map.off('zoomstart', adjust)
      map.off('rotatestart', adjust)
    }
  }, [map])

  // Live radio steers the automatic camera onto whoever is being talked to.
  const radioCamera = useRadioCamera(map, airport, goHome, reduceMotion)

  const onFrame = useCallback(
    (list: LiveAircraft[], dt: number) => {
      if (!map || radioCamera(list, dt)) return
      const s = usePlayhead.getState()
      const now = performance.now()
      const f = focus

      // Who should the camera be on? A locked selection wins; otherwise, in
      // automatic mode, whoever is being talked about.
      const talking = (s.activeCallsign ?? (s.mode === 'live' ? s.caption?.icao24 : null))?.toLowerCase() ?? null
      const wanted = s.following && s.selectedIcao ? s.selectedIcao : s.cameraMode === 'auto' && !s.selectedIcao ? talking : null
      const target = wanted ? list.find((a) => a.icao24 === wanted) : undefined

      if (target) {
        f.homeAt = 0
        if (f.id !== target.icao24) {
          f.id = target.icao24
          f.settleAt = now + duration(900)
          map.easeTo({
            center: [target.lon, target.lat],
            zoom: Math.min(FOCUS_ZOOM_MAX, Math.max(map.getZoom(), airport.zoom + FOCUS_ZOOM_BOOST)),
            duration: duration(900),
            easing: CAMERA_EASE,
            essential: true,
          })
        } else if (now >= f.settleAt && !map.isZooming() && !map.isRotating()) {
          // Critically damped chase: close a fixed fraction of the gap each frame.
          const c = map.getCenter()
          const k = reduceMotion ? 1 : 1 - Math.exp(-dt / FOLLOW_TAU_MS)
          const lng = c.lng + (target.lon - c.lng) * k
          const lat = c.lat + (target.lat - c.lat) * k
          if (Math.abs(lng - c.lng) > 1e-7 || Math.abs(lat - c.lat) > 1e-7) map.jumpTo({ center: [lng, lat] })
        }
        return
      }

      if (f.id) {
        // Lost the target: wait a beat, then drift back to the airfield.
        f.id = null
        f.homeAt = now + UNFOCUS_DELAY_MS
      }
      if (f.homeAt && now >= f.homeAt) {
        f.homeAt = 0
        if (s.cameraMode === 'auto' && !s.selectedIcao) goHome(1300)
      }
    },
    [map, airport, duration, reduceMotion, goHome, radioCamera],
  )

  // ---- theme and toggles -------------------------------------------------------
  // The style is built once for the starting theme; later changes repaint in place.
  const [style] = useState(() => buildStyle(theme))

  useEffect(() => {
    if (!map) return
    applyTheme(map, theme)
    applyGroundCover(map, theme, airport.arid)
  }, [map, theme, airport.arid])

  useEffect(() => {
    if (!map) return
    const show = (id: string, on: boolean) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    show(LAYER.buildings, themeHasVectorBase(theme))
    show(LAYER.approach, approachPaths)
    show(LAYER.approachTick, approachPaths)
    show(LAYER.trails, trails)
    show(LAYER.shadow, shadows)
    show(LAYER.radar, weatherRadar)
  }, [map, theme, approachPaths, trails, shadows, weatherRadar])

  // Radar mosaics are republished every five minutes.
  useEffect(() => {
    if (!map || !weatherRadar) return
    const refresh = () => (map.getSource('radar') as RasterTileSource | undefined)?.setTiles([radarTiles(Math.floor(Date.now() / 300_000))])
    refresh()
    const id = window.setInterval(refresh, 300_000)
    return () => window.clearInterval(id)
  }, [map, weatherRadar])

  useEffect(() => {
    mapHandle.current = map
    mapHandle.home = map ? () => goHome(900) : null
    return () => {
      mapHandle.current = null
      mapHandle.home = null
    }
  }, [map, goHome])

  // Initial camera only; later moves are animated above.
  const [initialView] = useState(() => ({ longitude: airport.center[0], latitude: airport.center[1], zoom: airport.zoom - 0.6, pitch: 0, bearing: 0 }))

  if (failed) {
    return (
      <div className="absolute inset-0 grid place-items-center bg-atc-map p-8 text-center">
        <div className="max-w-xs">
          <p className="text-base font-semibold">The map couldn’t start</p>
          <p className="mt-2 text-sm text-atc-muted">This browser has WebGL turned off or unavailable. Turn on hardware acceleration, or try another browser.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 bg-atc-map">
      <Suspense fallback={<MapSkeleton />}>
        <MapGL
          mapStyle={style}
          initialViewState={initialView}
          style={{ width: '100%', height: '100%' }}
          attributionControl={{ compact: true, customAttribution: TRAFFIC_ATTRIBUTION }}
          // A flat, top-down map only: no tilting by gesture, keyboard or accident.
          maxPitch={0}
          pitchWithRotate={false}
          touchPitch={false}
          minZoom={7}
          maxZoom={19}
          onLoad={(e) => {
            // The compact attribution starts expanded; begin collapsed so it doesn't sit on the map.
            const attrib = e.target.getContainer().querySelector('.maplibregl-ctrl-attrib')
            attrib?.classList.remove('maplibregl-compact-show')
            attrib?.removeAttribute('open')
            setMap(e.target)
          }}
          onError={(e) => {
            // Tile hiccups are routine; only a missing WebGL context is fatal.
            if (/webgl/i.test(String(e.error?.message ?? ''))) setFailed(true)
            else if (import.meta.env.DEV) console.warn('[map]', e.error?.message ?? e)
          }}
        >
          <AirportDiagramLayer map={map} airportIcao={airportIcao} />
          <AircraftLayer
            map={map}
            liveBuffer={liveBuffer}
            labels={labels}
            dataBlocks={dataBlocks}
            hideGround={hideGround}
            trailLength={trailLength}
            trails={trails}
            shadows={shadows}
            reduceMotion={reduceMotion}
            elevationFt={airport.elevationFt}
            onSelect={select}
            onFrame={onFrame}
          />
        </MapGL>
      </Suspense>
      {!map && <MapSkeleton />}
    </div>
  )
}

/** Shown until the map has drawn its first frame: the airfield colours with a slow sweep. */
function MapSkeleton() {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden bg-atc-map">
      <div className="absolute inset-0 animate-sweep bg-[conic-gradient(from_0deg_at_50%_50%,transparent_0deg,rgba(124,92,252,0.16)_40deg,transparent_60deg)]" />
      <p className="relative text-sm font-medium text-white/50">Loading the airfield…</p>
    </div>
  )
}
