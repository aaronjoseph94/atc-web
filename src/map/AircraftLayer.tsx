import { useEffect, useRef } from 'react'
import type { MapRef } from 'react-map-gl/maplibre'
import type { Feature, FeatureCollection } from 'geojson'
import type { GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl'
import type { Aircraft } from '../api/types'
import { TOKENS } from '../theme/tokens'
import { ensurePlaneIcon } from './planeIcon'

type Props = {
  mapRef: React.RefObject<MapRef | null>
  aircraft: Aircraft[]
  selectedIcao: string | null
  activeCallsign: string | null
  trail: [number, number][]
  onSelect: (icao: string) => void
}

const SRC = 'aircraft-src'
const TRAIL_SRC = 'trail-src'
const LAYER = 'aircraft-layer'
const LABEL = 'aircraft-label'
const TRAIL_LAYER = 'trail-layer'
const TRAIL_GLOW = 'trail-glow'
const HALO = 'aircraft-halo'
const HIT = 'aircraft-hit'

/** Mutates MapLibre sources — avoids React re-render per rAF frame. */
export function AircraftLayer({
  mapRef,
  aircraft,
  selectedIcao,
  activeCallsign,
  trail,
  onSelect,
}: Props) {
  const ready = useRef(false)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const pulseRef = useRef(0)

  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map) return

    const setup = () => {
      if (ready.current) return
      ensurePlaneIcon(map)
      if (!map.getSource(SRC)) {
        map.addSource(SRC, { type: 'geojson', data: emptyFc() })
        map.addSource(TRAIL_SRC, { type: 'geojson', data: emptyLine(), lineMetrics: true })

        map.addLayer({
          id: TRAIL_GLOW,
          type: 'line',
          source: TRAIL_SRC,
          paint: {
            'line-color': TOKENS.trail,
            'line-width': 8,
            'line-opacity': 0.22,
            'line-blur': 4,
          },
        })
        map.addLayer({
          id: TRAIL_LAYER,
          type: 'line',
          source: TRAIL_SRC,
          paint: {
            'line-color': TOKENS.trail,
            'line-width': 2.5,
            'line-opacity': 0.85,
            'line-gradient': [
              'interpolate',
              ['linear'],
              ['line-progress'],
              0,
              'rgba(124,92,252,0.05)',
              0.55,
              'rgba(124,92,252,0.45)',
              1,
              'rgba(124,92,252,0.95)',
            ],
          },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        })

        // Soft purple halo under selected / transmitting plane
        map.addLayer({
          id: HALO,
          type: 'circle',
          source: SRC,
          filter: ['==', ['get', 'selected'], 1],
          paint: {
            'circle-radius': 16,
            'circle-color': TOKENS.purple,
            'circle-opacity': 0.28,
            'circle-blur': 0.85,
          },
        })

        map.addLayer({
          id: HIT,
          type: 'circle',
          source: SRC,
          paint: { 'circle-radius': 16, 'circle-opacity': 0 },
        })

        map.addLayer({
          id: LAYER,
          type: 'symbol',
          source: SRC,
          layout: {
            'icon-image': 'plane-icon',
            'icon-size': [
              'interpolate',
              ['linear'],
              ['zoom'],
              10,
              0.42,
              12,
              0.62,
              14,
              0.85,
              16,
              1.05,
            ],
            'icon-rotate': ['get', 'heading'],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
          paint: {
            'icon-color': [
              'case',
              ['==', ['get', 'selected'], 1],
              TOKENS.planeSelected,
              TOKENS.plane,
            ],
            'icon-halo-color': [
              'case',
              ['==', ['get', 'selected'], 1],
              TOKENS.purple,
              'rgba(0,0,0,0.35)',
            ],
            'icon-halo-width': ['case', ['==', ['get', 'selected'], 1], 2.2, 0.6],
            'icon-halo-blur': ['case', ['==', ['get', 'selected'], 1], 0.8, 0.2],
            'icon-opacity': 0.98,
          },
        })

        map.addLayer({
          id: LABEL,
          type: 'symbol',
          source: SRC,
          filter: ['==', ['get', 'showLabel'], 1],
          layout: {
            'text-field': ['get', 'callsign'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 11,
            'text-offset': [0, -1.85],
            'text-anchor': 'bottom',
            'text-allow-overlap': true,
          },
          paint: {
            'text-color': '#fff',
            'text-halo-color': TOKENS.labelBg,
            'text-halo-width': 2,
          },
        })
      }
      ready.current = true
    }

    if (map.isStyleLoaded()) setup()
    else map.once('load', setup)

    const click = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0]
      const icao = f?.properties?.icao24
      if (typeof icao === 'string') onSelectRef.current(icao)
    }
    map.on('click', HIT, click)

    // Gentle pulse on selected halo (mutate paint, not React)
    let raf = 0
    const pulse = (t: number) => {
      if (map.getLayer(HALO)) {
        const wave = 0.22 + 0.12 * Math.sin(t / 700)
        map.setPaintProperty(HALO, 'circle-opacity', wave)
        map.setPaintProperty(HALO, 'circle-radius', 14 + 4 * Math.sin(t / 700))
      }
      pulseRef.current = requestAnimationFrame(pulse)
      raf = pulseRef.current
    }
    raf = requestAnimationFrame(pulse)

    return () => {
      map.off('click', HIT, click)
      cancelAnimationFrame(raf)
    }
  }, [mapRef])

  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !ready.current) return
    const src = map.getSource(SRC) as GeoJSONSource | undefined
    if (!src) return

    const zoom = map.getZoom()
    const showAllLabels = zoom >= 13.5

    src.setData({
      type: 'FeatureCollection',
      features: aircraft.map((a) => {
        const selected = a.icao24 === selectedIcao
        const transmitting =
          !!activeCallsign &&
          a.callsign.replace(/\s/g, '') === activeCallsign.replace(/\s/g, '')
        const showLabel = selected || transmitting || showAllLabels ? 1 : 0
        return {
          type: 'Feature',
          properties: {
            icao24: a.icao24,
            callsign: a.callsign,
            heading: a.heading,
            selected: selected || transmitting ? 1 : 0,
            showLabel,
          },
          geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
        }
      }),
    })
  }, [aircraft, selectedIcao, activeCallsign, mapRef])

  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !ready.current) return
    const src = map.getSource(TRAIL_SRC) as GeoJSONSource | undefined
    if (!src) return
    src.setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: trail.length >= 2 ? trail : [],
      },
    })
  }, [trail, mapRef])

  return null
}

function emptyFc(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

function emptyLine(): Feature {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: [] },
  }
}
