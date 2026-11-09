import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { MapRef } from 'react-map-gl/maplibre'
import { getAirport } from '../api/airports'
import { getAircraft } from '../api/client'
import type { Aircraft } from '../api/types'
import { interpolateTrack } from '../playback/interpolate'
import { usePlayhead } from '../playback/playheadStore'
import { MAP_STYLE } from '../theme/tokens'
import { AircraftLayer } from './AircraftLayer'
import { LivePositionBuffer } from './livePositions'

// Named MapGL so it does not shadow globalThis.Map
const MapGL = lazy(() =>
  import('react-map-gl/maplibre').then((m) => ({ default: m.Map })),
)

/** Lazy map chunk for AppShell Suspense boundary. */
export function LazyMapView() {
  return <MapView />
}

export function MapView() {
  const mapRef = useRef<MapRef>(null)
  const buffer = useRef(new LivePositionBuffer())
  const [rendered, setRendered] = useState<Aircraft[]>([])
  const [trail, setTrail] = useState<[number, number][]>([])

  const mode = usePlayhead((s) => s.mode)
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const tMs = usePlayhead((s) => s.tMs)
  const clip = usePlayhead((s) => s.clip)
  const selectedIcao = usePlayhead((s) => s.selectedIcao)
  const activeCallsign = usePlayhead((s) => s.activeCallsign)
  const setSelectedIcao = usePlayhead((s) => s.setSelectedIcao)
  const setSheetOpen = usePlayhead((s) => s.setSheetOpen)
  const setToast = usePlayhead((s) => s.setToast)

  const airport = useMemo(() => getAirport(airportIcao), [airportIcao])

  const query = useQuery({
    queryKey: ['aircraft', airportIcao],
    queryFn: () => getAircraft(airportIcao),
    refetchInterval: 8000,
    enabled: mode === 'live',
    retry: 1,
  })

  useEffect(() => {
    if (query.isError) setToast('Live traffic unavailable — playback still works')
  }, [query.isError, setToast])

  useEffect(() => {
    buffer.current = new LivePositionBuffer()
    setRendered([])
    setTrail([])
  }, [airportIcao])

  useEffect(() => {
    if (mode === 'live' && query.data) buffer.current.push(query.data)
  }, [query.data, mode])

  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    map.easeTo({
      center: airport.center,
      zoom: airport.zoom,
      duration: 1100,
      essential: true,
    })
  }, [airport])

  useEffect(() => {
    if (mode !== 'live') return
    let raf = 0
    const tick = () => {
      setRendered(buffer.current.sample())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [mode, airportIcao])

  useEffect(() => {
    if (mode !== 'playback' || !clip) return
    const list: Aircraft[] = []
    const trailPts: [number, number][] = []
    for (const [cs, samples] of Object.entries(clip.tracks)) {
      const p = interpolateTrack(samples, tMs)
      if (!p) continue
      const icao = cs.toLowerCase()
      list.push({
        icao24: icao,
        callsign: cs,
        lat: p.lat,
        lon: p.lon,
        heading: p.heading,
        altitudeFt: p.altitudeFt ?? null,
        speedKt: p.speedKt ?? null,
        onGround: (p.altitudeFt ?? 0) < 50,
      })
      if (activeCallsign === cs || selectedIcao === icao) {
        for (const s of samples) {
          if (s.tMs <= tMs) trailPts.push([s.lon, s.lat])
        }
        trailPts.push([p.lon, p.lat])
      }
    }
    setRendered(list)
    setTrail(trailPts)
  }, [mode, clip, tMs, activeCallsign, selectedIcao])

  useEffect(() => {
    if (mode === 'live') setTrail([])
  }, [mode])

  const liveTrailRef = useRef(new globalThis.Map<string, [number, number][]>())
  useEffect(() => {
    if (mode !== 'live' || !selectedIcao) {
      if (mode === 'live') setTrail([])
      return
    }
    const ac = rendered.find((a) => a.icao24 === selectedIcao)
    if (!ac) return
    const hist = liveTrailRef.current.get(selectedIcao) ?? []
    const last = hist[hist.length - 1]
    if (!last || last[0] !== ac.lon || last[1] !== ac.lat) {
      hist.push([ac.lon, ac.lat])
      if (hist.length > 48) hist.shift()
      liveTrailRef.current.set(selectedIcao, hist)
    }
    setTrail([...hist])
  }, [rendered, selectedIcao, mode])

  const onSelect = useCallback(
    (icao: string) => {
      setSelectedIcao(icao)
      setSheetOpen(true)
    },
    [setSelectedIcao, setSheetOpen],
  )

  const initialView = useMemo(
    () => ({
      longitude: airport.center[0],
      latitude: airport.center[1],
      zoom: airport.zoom,
      pitch: 0,
      bearing: -8,
    }),
    // Initial only — subsequent moves use easeTo
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return (
    <div className="absolute inset-0 bg-atc-map">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-atc-muted">Loading map…</div>
        }
      >
        <MapGL
          ref={mapRef}
          mapStyle={MAP_STYLE}
          initialViewState={initialView}
          style={{ width: '100%', height: '100%' }}
          attributionControl={{ compact: true }}
          reuseMaps
        >
          <AircraftLayer
            mapRef={mapRef}
            aircraft={rendered}
            selectedIcao={selectedIcao}
            activeCallsign={activeCallsign}
            trail={trail}
            onSelect={onSelect}
          />
        </MapGL>
      </Suspense>
    </div>
  )
}
