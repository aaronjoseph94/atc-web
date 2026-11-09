/**
 * Draws aircraft, the selected aircraft's trail and a pulsing halo on the
 * MapLibre map.
 *
 * Performance model: this component renders nothing and never causes React
 * re-renders per frame. It owns a single `requestAnimationFrame` loop that
 * samples the `LivePositionBuffer` (live mode) or uses the `playback` prop
 * (playback mode) and writes straight into GeoJSON sources.
 */
import { useEffect, useRef } from 'react'
import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from 'maplibre-gl'
import type { Aircraft } from '../api/types'
import { positionsAt } from '../playback/interpolate'
import { playbackInstant, usePlayhead } from '../playback/playheadStore'
import type { LabelMode } from '../settings/settingsStore'
import { TOKENS } from '../theme/tokens'
import type { LivePositionBuffer } from './livePositions'
import { ensurePlaneIcon } from './planeIcon'

type Props = {
  /** The loaded MapLibre instance (null until the base style has loaded). */
  map: MapLibreMap | null
  mode: 'live' | 'playback'
  liveBuffer: LivePositionBuffer
  /** Pre-computed positions for the current playhead (playback mode only). */
  playback: { aircraft: Aircraft[]; trail: [number, number][] }
  selectedIcao: string | null
  activeCallsign: string | null
  labels: LabelMode
  hideGround: boolean
  trailLength: number
  reduceMotion: boolean
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

/** Zoom at or above which every callsign is labelled in `auto` mode. */
const LABEL_ALL_ZOOM = 13.5

/** Minimum move (degrees) before a new trail point is recorded. */
const TRAIL_MIN_DELTA = 0.00005

export function AircraftLayer({
  map,
  mode,
  liveBuffer,
  playback,
  selectedIcao,
  activeCallsign,
  labels,
  hideGround,
  trailLength,
  reduceMotion,
  onSelect,
}: Props) {
  // Latest props, readable from the rAF loop without re-subscribing.
  // Written in an effect (not during render) per React's ref rules.
  const latest = useRef({ mode, playback, selectedIcao, activeCallsign, labels, hideGround, trailLength, reduceMotion, onSelect })
  useEffect(() => {
    latest.current = { mode, playback, selectedIcao, activeCallsign, labels, hideGround, trailLength, reduceMotion, onSelect }
  })

  /** Live trail history for the selected aircraft (reset on selection/mode change). */
  const trailRef = useRef<TrailState>({ icao: null, mode: 'live', pts: [] })

  // ---- one-time setup: icon, sources, layers, click handler, rAF loop ----
  useEffect(() => {
    if (!map) return

    ensurePlaneIcon(map)
    if (!map.getSource(SRC)) addSourcesAndLayers(map)

    const click = (e: MapLayerMouseEvent) => {
      const icao = e.features?.[0]?.properties?.icao24
      if (typeof icao === 'string') latest.current.onSelect(icao)
    }
    const enter = () => (map.getCanvas().style.cursor = 'pointer')
    const leave = () => (map.getCanvas().style.cursor = '')
    map.on('click', HIT, click)
    map.on('mouseenter', HIT, enter)
    map.on('mouseleave', HIT, leave)

    let raf = 0
    const frame = (t: number) => {
      const L = latest.current
      const aircraftSrc = map.getSource(SRC) as GeoJSONSource | undefined
      const trailSrc = map.getSource(TRAIL_SRC) as GeoJSONSource | undefined
      if (aircraftSrc && trailSrc) {
        // Playback reads the store directly and advances between the audio
        // element's coarse time updates, so icons glide instead of stepping.
        const play = L.mode === 'playback' ? usePlayhead.getState() : null
        const played = play?.clip ? positionsAt(play.clip, playbackInstant(play), play.activeCallsign, play.selectedIcao) : null
        const list = played ? played.aircraft : liveBuffer.sample()
        const visible = L.hideGround ? list.filter((a) => !a.onGround) : list
        aircraftSrc.setData(toFeatureCollection(visible, L.selectedIcao, L.activeCallsign, L.labels, map.getZoom()))

        const trail = played
          ? played.trail
          : updateLiveTrail(trailRef.current, visible, L.selectedIcao, L.trailLength)
        if (L.mode !== trailRef.current.mode) trailRef.current = { icao: null, mode: L.mode, pts: [] }
        trailSrc.setData(toLine(trail))

        // Halo breathes gently; skipped under reduce-motion.
        if (map.getLayer(HALO)) {
          const wave = L.reduceMotion ? 0 : Math.sin(t / 700)
          map.setPaintProperty(HALO, 'circle-opacity', 0.3 + 0.12 * wave)
          map.setPaintProperty(HALO, 'circle-radius', 14 + 4 * wave)
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      map.off('click', HIT, click)
      map.off('mouseenter', HIT, enter)
      map.off('mouseleave', HIT, leave)
    }
  }, [map, liveBuffer])

  return null
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function toFeatureCollection(
  aircraft: Aircraft[],
  selectedIcao: string | null,
  activeCallsign: string | null,
  labels: LabelMode,
  zoom: number,
): FeatureCollection<Point> {
  const active = activeCallsign?.replace(/\s/g, '')
  const labelAll = labels === 'always' || (labels === 'auto' && zoom >= LABEL_ALL_ZOOM)
  return {
    type: 'FeatureCollection',
    features: aircraft.map((a) => {
      const selected = a.icao24 === selectedIcao
      const transmitting = !!active && a.callsign.replace(/\s/g, '') === active
      const highlight = selected || transmitting
      // 0 = parked (ground, not moving), 1 = moving on the ground, 2 = airborne.
      const state = a.onGround ? ((a.speedKt ?? 0) < 5 ? 0 : 1) : 2
      return {
        type: 'Feature',
        properties: {
          icao24: a.icao24,
          callsign: a.callsign,
          heading: a.heading,
          selected: highlight ? 1 : 0,
          showLabel: labels !== 'never' && (highlight || labelAll) ? 1 : 0,
          ground: a.onGround ? 1 : 0,
          state,
        },
        geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
      }
    }),
  }
}

type TrailState = { icao: string | null; mode: 'live' | 'playback'; pts: [number, number][] }

/** Append the selected aircraft's current position to its trail (bounded length). */
function updateLiveTrail(
  state: TrailState,
  aircraft: Aircraft[],
  selectedIcao: string | null,
  maxLen: number,
): [number, number][] {
  if (!selectedIcao) {
    state.icao = null
    state.pts = []
    return state.pts
  }
  if (state.icao !== selectedIcao) {
    state.icao = selectedIcao
    state.pts = []
  }
  const ac = aircraft.find((a) => a.icao24 === selectedIcao)
  if (!ac) return state.pts
  const last = state.pts[state.pts.length - 1]
  if (!last || Math.abs(last[0] - ac.lon) > TRAIL_MIN_DELTA || Math.abs(last[1] - ac.lat) > TRAIL_MIN_DELTA) {
    state.pts.push([ac.lon, ac.lat])
    if (state.pts.length > maxLen) state.pts.splice(0, state.pts.length - maxLen)
  }
  return state.pts
}

function toLine(coords: [number, number][]): Feature<LineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: coords.length >= 2 ? coords : [] },
  }
}

/** Adds the GeoJSON sources and the five layers, bottom to top. */
function addSourcesAndLayers(map: MapLibreMap) {
  map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addSource(TRAIL_SRC, { type: 'geojson', data: toLine([]), lineMetrics: true })

  // Trail: soft glow underneath, gradient core on top (fades toward the tail).
  map.addLayer({
    id: TRAIL_GLOW,
    type: 'line',
    source: TRAIL_SRC,
    paint: { 'line-color': TOKENS.trail, 'line-width': 9, 'line-opacity': 0.2, 'line-blur': 5 },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  })
  map.addLayer({
    id: TRAIL_LAYER,
    type: 'line',
    source: TRAIL_SRC,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-width': 2.5,
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
  })

  // Halo under the selected / transmitting aircraft (animated in the rAF loop).
  map.addLayer({
    id: HALO,
    type: 'circle',
    source: SRC,
    filter: ['==', ['get', 'selected'], 1],
    paint: { 'circle-radius': 15, 'circle-color': TOKENS.purple, 'circle-opacity': 0.26, 'circle-blur': 0.85 },
  })

  // Invisible, generous hit target so small icons are easy to tap.
  map.addLayer({
    id: HIT,
    type: 'circle',
    source: SRC,
    paint: { 'circle-radius': 16, 'circle-opacity': 0 },
  })

  // Aircraft silhouettes: SDF icon tinted yellow when highlighted, dimmer on the ground.
  map.addLayer({
    id: LAYER,
    type: 'symbol',
    source: SRC,
    layout: {
      'icon-image': 'plane-icon',
      // Zoom-scaled base × activity factor: parked aircraft are small and quiet,
      // taxiing ones medium, airborne ones full size; the highlighted one is larger still.
      'icon-size': [
        '*',
        ['interpolate', ['linear'], ['zoom'], 10, 0.28, 12, 0.42, 14, 0.62, 16, 0.8],
        ['match', ['get', 'state'], 0, 0.55, 1, 0.75, 1],
        ['case', ['==', ['get', 'selected'], 1], 1.35, 1],
      ],
      'icon-rotate': ['get', 'heading'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: {
      'icon-color': ['case', ['==', ['get', 'selected'], 1], TOKENS.planeSelected, TOKENS.plane],
      'icon-opacity': [
        'case',
        ['==', ['get', 'selected'], 1],
        1,
        ['match', ['get', 'state'], 0, 0.45, 1, 0.72, 0.96],
      ],
      'icon-halo-color': ['case', ['==', ['get', 'selected'], 1], TOKENS.purple, 'rgba(0,0,0,0.4)'],
      'icon-halo-width': ['case', ['==', ['get', 'selected'], 1], 2.2, 0.6],
      'icon-halo-blur': ['case', ['==', ['get', 'selected'], 1], 0.8, 0.2],
    },
  })

  map.addLayer({
    id: LABEL,
    type: 'symbol',
    source: SRC,
    filter: ['==', ['get', 'showLabel'], 1],
    layout: {
      'text-field': ['get', 'callsign'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 11,
      'text-offset': [0, -1.7],
      'text-anchor': 'bottom',
      'text-allow-overlap': true,
      'text-letter-spacing': 0.04,
    },
    // Thick halo reads as a dark chip behind the callsign; purple for the highlighted aircraft.
    paint: {
      'text-color': '#fff',
      'text-halo-color': ['case', ['==', ['get', 'selected'], 1], 'rgba(92,61,245,0.95)', TOKENS.labelBg],
      'text-halo-width': 3,
    },
  })
}
