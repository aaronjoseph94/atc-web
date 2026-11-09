/**
 * Full-bleed MapLibre map. Owns the live traffic query, the camera, and the
 * playback-position derivation; delegates all per-frame drawing to
 * `AircraftLayer`.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { getAirport } from '../api/airports'
import { getAircraft } from '../api/client'
import type { Aircraft } from '../api/types'
import { positionsAt } from '../playback/interpolate'
import { usePlayhead } from '../playback/playheadStore'
import { useSettings } from '../settings/settingsStore'
import { MAP_STYLE } from '../theme/tokens'
import { AircraftLayer } from './AircraftLayer'
import { LivePositionBuffer } from './livePositions'
import { applyMapTheme } from './mapTheme'
import { RunwayLabels } from './RunwayLabels'

/** Extra zoom applied when the camera closes in on a talking/selected aircraft. */
const FOCUS_ZOOM_BOOST = 1.4
/** Delay before easing back out once nobody is talking or selected. */
const UNFOCUS_DELAY_MS = 1400

// Lazy so the ~1 MB MapLibre bundle doesn't block first paint. The worker URL
// must be configured before the first Map is constructed (see maplibreSetup).
// Named MapGL to avoid shadowing the global `Map`.
const MapGL = lazy(async () => {
  await import('./maplibreSetup')
  const m = await import('react-map-gl/maplibre')
  return { default: m.Map }
})

const EMPTY_PLAYBACK = { aircraft: [] as Aircraft[], trail: [] as [number, number][] }

export function MapView() {
  // Set once the style has loaded; everything map-side keys off this.
  const [map, setMap] = useState<MapLibreMap | null>(null)
  const liveBuffer = useMemo(() => new LivePositionBuffer(), [])

  const mode = usePlayhead((s) => s.mode)
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const tMs = usePlayhead((s) => s.tMs)
  const clip = usePlayhead((s) => s.clip)
  const selectedIcao = usePlayhead((s) => s.selectedIcao)
  const activeCallsign = usePlayhead((s) => s.activeCallsign)
  const setSelectedIcao = usePlayhead((s) => s.setSelectedIcao)
  const setSheetOpen = usePlayhead((s) => s.setSheetOpen)
  const setLive = usePlayhead((s) => s.setLive)
  const setToast = usePlayhead((s) => s.setToast)

  const pollSeconds = useSettings((s) => s.pollSeconds)
  const labels = useSettings((s) => s.labels)
  const hideGround = useSettings((s) => s.hideGround)
  const trailLength = useSettings((s) => s.trailLength)
  const reduceMotion = useSettings((s) => s.reduceMotion)
  const mapTheme = useSettings((s) => s.mapTheme)

  const airport = useMemo(() => getAirport(airportIcao), [airportIcao])

  // ---- live traffic polling --------------------------------------------
  const query = useQuery({
    queryKey: ['aircraft', airportIcao],
    queryFn: () => getAircraft(airportIcao),
    refetchInterval: pollSeconds * 1000,
    enabled: mode === 'live',
    retry: 1,
  })

  useEffect(() => {
    if (mode !== 'live') return
    if (query.isError) {
      setLive('error')
      setToast('Live traffic unavailable — playback still works')
    } else if (query.data) {
      liveBuffer.push(query.data)
      setLive('ok', query.data.length)
    } else if (query.isPending) {
      setLive('loading')
    }
  }, [query.data, query.isError, query.isPending, mode, liveBuffer, setLive, setToast])

  // Airport change: drop stale positions and fly the camera.
  useEffect(() => {
    liveBuffer.clear()
    map?.easeTo({
      center: airport.center,
      zoom: airport.zoom,
      padding: { top: 0, left: 0, right: 0, bottom: 0 },
      duration: reduceMotion ? 0 : 1100,
      essential: true,
    })
  }, [airport, map, liveBuffer, reduceMotion])

  // Theme on load and whenever the preference changes.
  useEffect(() => {
    if (map) applyMapTheme(map, mapTheme)
  }, [map, mapTheme])

  // ---- playback positions derived from the shared clock -----------------
  // Camera targeting only — the animation frame samples the clip itself so
  // playback motion stays smooth between audio time updates.
  const playback = useMemo(
    () => (mode === 'playback' ? positionsAt(clip, tMs, activeCallsign, selectedIcao) : EMPTY_PLAYBACK),
    [mode, clip, tMs, activeCallsign, selectedIcao],
  )

  // ---- camera focus: zoom toward whoever is talking or was tapped ---------
  // Positions are read through a ref so this effect only runs when the
  // *target* changes, not on every playhead tick.
  const playbackRef = useRef(playback)
  useEffect(() => {
    playbackRef.current = playback
  })
  const hadFocus = useRef(false)

  useEffect(() => {
    if (!map) return
    const list = mode === 'live' ? liveBuffer.sample() : playbackRef.current.aircraft
    const active = activeCallsign?.replace(/\s/g, '')
    const target =
      (active && list.find((a) => a.callsign.replace(/\s/g, '') === active)) ||
      (selectedIcao && list.find((a) => a.icao24 === selectedIcao)) ||
      null

    if (target) {
      hadFocus.current = true
      // Keep the aircraft clear of the bottom cards on phones.
      const bottomPad = Math.round(Math.min(window.innerHeight * 0.32, 320))
      map.easeTo({
        center: [target.lon, target.lat],
        zoom: Math.max(map.getZoom(), airport.zoom + FOCUS_ZOOM_BOOST),
        padding: { top: 0, left: 0, right: 0, bottom: bottomPad },
        duration: reduceMotion ? 0 : 950,
        essential: true,
      })
      return
    }

    // Nobody focused: after a beat, ease back out to the airport overview.
    if (!hadFocus.current) return
    const id = window.setTimeout(() => {
      hadFocus.current = false
      map.easeTo({
        center: airport.center,
        zoom: airport.zoom,
        padding: { top: 0, left: 0, right: 0, bottom: 0 },
        duration: reduceMotion ? 0 : 1300,
        essential: true,
      })
    }, UNFOCUS_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [map, mode, activeCallsign, selectedIcao, airport, liveBuffer, reduceMotion])

  const onSelect = useCallback(
    (icao: string) => {
      setSelectedIcao(icao)
      setSheetOpen(true)
    },
    [setSelectedIcao, setSheetOpen],
  )

  // Initial camera only; later moves use easeTo above.
  const [initialView] = useState(() => ({
    longitude: airport.center[0],
    latitude: airport.center[1],
    zoom: airport.zoom,
    pitch: 0,
    bearing: 0,
  }))

  return (
    <div className="absolute inset-0 bg-atc-map">
      <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-atc-muted">Loading map…</div>}>
        <MapGL
          mapStyle={MAP_STYLE}
          initialViewState={initialView}
          style={{ width: '100%', height: '100%' }}
          attributionControl={{ compact: true }}
          onLoad={(e) => setMap(e.target)}
          reuseMaps
        >
          <AircraftLayer
            map={map}
            mode={mode}
            liveBuffer={liveBuffer}
            playback={playback}
            selectedIcao={selectedIcao}
            activeCallsign={activeCallsign}
            labels={labels}
            hideGround={hideGround}
            trailLength={trailLength}
            reduceMotion={reduceMotion}
            onSelect={onSelect}
          />
          <RunwayLabels map={map} airportIcao={airportIcao} />
        </MapGL>
      </Suspense>
    </div>
  )
}
