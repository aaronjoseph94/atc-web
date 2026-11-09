/**
 * Recolours the free OpenFreeMap "dark" basemap at runtime so it reads as a
 * navy aviation chart (dark blue land, deep blue water, green airfield
 * infield, muted roads) instead of neutral graphite.
 *
 * Only `paint` properties are touched, so tile/data loading is unaffected.
 */
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { MapTheme } from '../settings/settingsStore'

/** Fill layer we add so airfield grounds show as a green infield. */
export const AERODROME_LAYER = 'atc-aerodrome'

type Palette = {
  background: string
  water: string
  land: string
  park: string
  building: string
  aerodrome: string
  apron: string
  runway: string
  runwayCasing: string
  taxiway: string
  road: string
  roadCasing: string
  motorway: string
  rail: string
  boundary: string
  label: string
  waterLabel: string
}

const NAVY: Palette = {
  background: '#0B1220',
  water: '#0E1A33',
  land: '#0D1526',
  park: '#10261F',
  building: '#111A2C',
  aerodrome: '#12301F',
  apron: '#101829',
  runway: '#243352',
  runwayCasing: '#33476E',
  taxiway: '#1B2740',
  road: '#172238',
  roadCasing: '#1F2C47',
  motorway: '#1E2B47',
  rail: '#1A2438',
  boundary: '#2A3550',
  label: '#6F7D99',
  waterLabel: '#3C5A86',
}

/** Graphite keeps the stock OpenFreeMap colours; only the infield is added. */
const GRAPHITE: Partial<Palette> = { aerodrome: '#1D2A1F' }

/** Apply the chosen theme. Safe to call repeatedly (e.g. when the setting changes). */
export function applyMapTheme(map: MapLibreMap, theme: MapTheme) {
  ensureAerodromeLayer(map)
  const p = theme === 'navy' ? NAVY : GRAPHITE

  if (theme === 'graphite') {
    // Reload the stock palette by re-reading the style from the server would
    // flash; instead we only restyle the layers we own.
    map.setPaintProperty(AERODROME_LAYER, 'fill-color', p.aerodrome!)
    return
  }

  const pal = p as Palette
  type PaintProp = Parameters<MapLibreMap['setPaintProperty']>[1]
  for (const layer of map.getStyle().layers) {
    const id = layer.id
    const set = (prop: PaintProp, value: string) => {
      try {
        map.setPaintProperty(id, prop, value)
      } catch {
        /* layer may lack this property — ignore */
      }
    }

    if (id === 'background') set('background-color', pal.background)
    else if (id === AERODROME_LAYER) set('fill-color', pal.aerodrome)
    else if (id === 'water') set('fill-color', pal.water)
    else if (id === 'waterway') set('line-color', pal.water)
    else if (id === 'water_name') set('text-color', pal.waterLabel)
    else if (id.startsWith('landcover') || id === 'landuse_park') set('fill-color', pal.park)
    else if (id === 'landuse_residential') set('fill-color', pal.land)
    else if (id === 'building') set('fill-color', pal.building)
    else if (id === 'aeroway-area') set('fill-color', pal.apron)
    else if (id === 'aeroway-runway') set('line-color', pal.runway)
    else if (id === 'aeroway-runway-casing') set('line-color', pal.runwayCasing)
    else if (id === 'aeroway-taxiway') set('line-color', pal.taxiway)
    else if (id.endsWith('_casing')) set('line-color', pal.roadCasing)
    else if (id === 'highway_motorway_inner') set('line-color', pal.motorway)
    else if (id.startsWith('highway_') && layer.type === 'line') set('line-color', pal.road)
    else if (id.startsWith('road_') && layer.type !== 'symbol') {
      set(layer.type === 'fill' ? 'fill-color' : 'line-color', pal.land)
    } else if (id.startsWith('railway')) set('line-color', pal.rail)
    else if (id.startsWith('boundary')) set('line-color', pal.boundary)
    else if (layer.type === 'symbol') set('text-color', pal.label)
  }
}

/**
 * OpenMapTiles exposes airport grounds as `aeroway` polygons with
 * `class=aerodrome`; the stock style doesn't draw them. Insert a fill just
 * below the paved apron layer so runways/taxiways render on top.
 */
function ensureAerodromeLayer(map: MapLibreMap) {
  if (map.getLayer(AERODROME_LAYER)) return
  const before = map.getLayer('aeroway-area') ? 'aeroway-area' : undefined
  map.addLayer(
    {
      id: AERODROME_LAYER,
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'aeroway',
      filter: ['==', ['get', 'class'], 'aerodrome'],
      paint: { 'fill-color': NAVY.aerodrome, 'fill-opacity': 0.9 },
    },
    before,
  )
}
