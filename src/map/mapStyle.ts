/**
 * The whole map style, authored here instead of recolouring a stock one.
 *
 * Base data: OpenFreeMap vector tiles (OpenMapTiles schema, OpenStreetMap
 * data). Free raster layers sit underneath for the alternative looks:
 * USGS orthoimagery (public domain) and the FAA's VFR charts.
 *
 * Every theme produces the same layers with the same ids, so switching
 * theme is just a matter of pushing new paint values (`applyTheme`); no
 * style reload, no flash, and the aircraft layers stay put.
 */
import type { LayerSpecification, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'
import type { MapTheme } from '../settings/settingsStore'

/** Ids other modules need to reference. */
export const SRC = {
  surface: 'apt-surface',
  paint: 'apt-paint',
  designators: 'apt-designators',
  ends: 'apt-ends',
  approach: 'apt-approach',
  hold: 'apt-hold',
  aircraft: 'aircraft',
  shadows: 'aircraft-shadows',
  trails: 'aircraft-trails',
  events: 'aircraft-events',
} as const

export const LAYER = {
  buildings3d: 'building-3d',
  buildings: 'building',
  radar: 'weather-radar',
  runwayChip: 'apt-runway-chip',
  approach: 'apt-approach',
  approachTick: 'apt-approach-tick',
  trails: 'ac-trails',
  trailGlow: 'ac-trail-glow',
  trail: 'ac-trail',
  shadow: 'ac-shadow',
  ping: 'ac-ping',
  halo: 'ac-halo',
  hit: 'ac-hit',
  aircraft: 'ac-icon',
  label: 'ac-label',
  event: 'ac-event',
} as const

type Palette = {
  bg: string
  water: string
  land: string
  wood: string
  grass: string
  infield: string
  apron: string
  taxiway: string
  runway: string
  runwayConcrete: string
  paint: string
  taxiLine: string
  building: string
  buildingEdge: string
  buildingTop: string
  roadMinor: string
  roadMajor: string
  motorway: string
  roadCase: string
  rail: string
  boundary: string
  label: string
  labelHalo: string
  waterLabel: string
  approach: string
  /** Aircraft silhouettes and their outline. */
  plane: string
  planeEdge: string
  /** Raster underlay: which one shows, if any. */
  raster: 'none' | 'satellite' | 'chart'
  /** Hide the vector base (land, water, roads) because a raster replaces it. */
  hideBase: boolean
  /** Hide generated pavement and paint because the imagery already shows the real thing. */
  hidePaint: boolean
}

const NAVY: Palette = {
  bg: '#0B1322',
  water: '#091B36',
  land: '#0E1729',
  wood: '#0F2327',
  grass: '#102B28',
  infield: '#1C5643',
  apron: '#1B2540',
  taxiway: '#222E4B',
  runway: '#283250',
  runwayConcrete: '#2F3A59',
  paint: '#F2F5FA',
  taxiLine: '#F5C518',
  building: '#151F36',
  buildingEdge: '#263352',
  buildingTop: '#1E2A47',
  roadMinor: '#16213A',
  roadMajor: '#1C2946',
  motorway: '#223152',
  roadCase: '#0C1526',
  rail: '#1A2540',
  boundary: '#2B3858',
  label: '#7E8CAB',
  labelHalo: '#0B1322',
  waterLabel: '#3F5E91',
  approach: '#8FA3CC',
  plane: '#FFFFFF',
  planeEdge: 'rgba(5,10,22,0.75)',
  raster: 'none',
  hideBase: false,
  hidePaint: false,
}

const GRAPHITE: Palette = {
  ...NAVY,
  bg: '#101214',
  water: '#0A1016',
  land: '#141719',
  wood: '#141B18',
  grass: '#16201B',
  infield: '#21392C',
  apron: '#1F2327',
  taxiway: '#282D32',
  runway: '#30363C',
  runwayConcrete: '#3A4047',
  building: '#1A1D21',
  buildingEdge: '#2B3036',
  buildingTop: '#24282D',
  roadMinor: '#1B1E22',
  roadMajor: '#23272C',
  motorway: '#2B3036',
  roadCase: '#0C0E10',
  rail: '#202428',
  boundary: '#33383E',
  label: '#858B93',
  labelHalo: '#101214',
  waterLabel: '#4A5A6B',
  approach: '#9AA1AA',
}

const SATELLITE: Palette = {
  ...NAVY,
  bg: '#05080E',
  label: '#F4F6FA',
  labelHalo: 'rgba(0,0,0,0.75)',
  waterLabel: '#CFE2FF',
  roadMinor: 'rgba(255,255,255,0.10)',
  roadMajor: 'rgba(255,255,255,0.22)',
  motorway: 'rgba(255,214,102,0.45)',
  roadCase: 'rgba(0,0,0,0)',
  boundary: 'rgba(255,255,255,0.35)',
  approach: '#FFFFFF',
  planeEdge: 'rgba(0,0,0,0.9)',
  raster: 'satellite',
  hideBase: true,
  hidePaint: true,
}

const CHART: Palette = {
  ...NAVY,
  bg: '#E9E2CF',
  label: '#1B2540',
  labelHalo: 'rgba(255,255,255,0.85)',
  approach: '#3B2A8C',
  plane: '#14203B',
  planeEdge: 'rgba(255,255,255,0.95)',
  raster: 'chart',
  hideBase: true,
  hidePaint: false,
}

const PALETTES: Record<MapTheme, Palette> = { navy: NAVY, graphite: GRAPHITE, satellite: SATELLITE, chart: CHART }

/** Display metadata for the theme picker. */
export const MAP_THEMES: { id: MapTheme; label: string; hint: string; usOnly: boolean; swatch: [string, string, string] }[] = [
  { id: 'navy', label: 'Night', hint: 'Navy airfield chart', usOnly: false, swatch: ['#0E1729', '#1C5643', '#283250'] },
  { id: 'graphite', label: 'Graphite', hint: 'Neutral dark', usOnly: false, swatch: ['#141719', '#21392C', '#30363C'] },
  { id: 'satellite', label: 'Satellite', hint: 'USGS aerial photos', usOnly: true, swatch: ['#3A4A3C', '#6E7A63', '#9AA08F'] },
  { id: 'chart', label: 'FAA chart', hint: 'VFR sectional', usOnly: true, swatch: ['#E9E2CF', '#8FB7D9', '#C7B8E0'] },
]

/** Themes backed by US-government rasters have nothing to show elsewhere. */
export function effectiveTheme(theme: MapTheme, isUs: boolean): MapTheme {
  const meta = MAP_THEMES.find((t) => t.id === theme)
  return meta?.usOnly && !isUs ? 'navy' : theme
}

const FONT = ['Noto Sans Regular']
const FONT_BOLD = ['Noto Sans Bold']

/** Line width that tracks a real-world width in metres (doubles every zoom level). */
function metres(m: number, lat = 40): unknown[] {
  // Pixels at z10, then ×2 per zoom: with 512 px tiles one pixel is 76.44 m at the equator at z10.
  const px10 = m / (76.437 * Math.cos((lat * Math.PI) / 180))
  return ['interpolate', ['exponential', 2], ['zoom'], 10, px10, 22, px10 * 4096]
}

const vis = (show: boolean) => ({ visibility: show ? ('visible' as const) : ('none' as const) })
const empty = { type: 'FeatureCollection' as const, features: [] }

function layers(p: Palette): LayerSpecification[] {
  const base = !p.hideBase
  const paint = !p.hidePaint
  const sat = p.raster === 'satellite'
  const chart = p.raster === 'chart'
  // On imagery and charts the overlay roads would fight the picture underneath.
  const roads = base || sat

  const list: unknown[] = [
    { id: 'bg', type: 'background', paint: { 'background-color': p.bg } },

    // ---- free raster underlays --------------------------------------------
    { id: 'raster-satellite', type: 'raster', source: 'usgs', layout: vis(sat), paint: { 'raster-opacity': 1, 'raster-saturation': -0.15, 'raster-brightness-max': 0.82, 'raster-fade-duration': 200 } },
    { id: 'raster-chart-sectional', type: 'raster', source: 'faa-sectional', layout: vis(chart), paint: { 'raster-opacity': 1, 'raster-fade-duration': 200 } },
    { id: 'raster-chart-terminal', type: 'raster', source: 'faa-terminal', layout: vis(chart), paint: { 'raster-opacity': 1, 'raster-fade-duration': 200 } },

    // ---- land and water ---------------------------------------------------
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', layout: vis(base), paint: { 'fill-color': p.water } },
    { id: 'landuse-residential', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['residential', 'commercial', 'industrial', 'retail']]], layout: vis(base), paint: { 'fill-color': p.land } },
    { id: 'landcover-wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'wood'], layout: vis(base), paint: { 'fill-color': p.wood } },
    { id: 'landcover-grass', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['grass', 'farmland', 'wetland']]], layout: vis(base), paint: { 'fill-color': p.grass } },
    { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', layout: vis(base), paint: { 'line-color': p.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 3] } },

    // ---- airfield (OpenStreetMap geometry) ----------------------------------
    { id: 'aero-infield', type: 'fill', source: 'omt', 'source-layer': 'aeroway', filter: ['==', ['get', 'class'], 'aerodrome'], layout: vis(base), paint: { 'fill-color': p.infield, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.55, 12, 1] } },
    { id: 'aero-apron', type: 'fill', source: 'omt', 'source-layer': 'aeroway', filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'class'], 'apron']], layout: vis(base), paint: { 'fill-color': p.apron } },
    { id: 'aero-taxiway', type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 11, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'taxiway']], layout: { ...vis(base), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': p.taxiway, 'line-width': metres(34) } },
    { id: 'aero-runway-area', type: 'fill', source: 'omt', 'source-layer': 'aeroway', filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'class'], 'runway']], layout: vis(base), paint: { 'fill-color': p.runway } },
    // Other airports in view (and far zooms) only get this plain stroke.
    { id: 'aero-runway-line', type: 'line', source: 'omt', 'source-layer': 'aeroway', filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'runway']], layout: { ...vis(base), 'line-cap': 'butt' }, paint: { 'line-color': p.runway, 'line-width': metres(46) } },

    // ---- buildings ----------------------------------------------------------
    { id: LAYER.buildings, type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 12, layout: vis(base), paint: { 'fill-color': p.building, 'fill-outline-color': p.buildingEdge } },

    // ---- roads --------------------------------------------------------------
    { id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12, filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'tertiary']]], layout: { ...vis(roads), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': p.roadMinor, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 0.5, 16, 4] } },
    { id: 'road-major-case', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 9, filter: ['in', ['get', 'class'], ['literal', ['secondary', 'primary', 'trunk']]], layout: { ...vis(base), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': p.roadCase, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 9, 1.2, 16, 9] } },
    { id: 'road-major', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 9, filter: ['in', ['get', 'class'], ['literal', ['secondary', 'primary', 'trunk']]], layout: { ...vis(roads), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': p.roadMajor, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 9, 0.6, 16, 6] } },
    { id: 'road-motorway-case', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 6, filter: ['==', ['get', 'class'], 'motorway'], layout: { ...vis(base), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': p.roadCase, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 6, 1.4, 16, 12] } },
    { id: 'road-motorway', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 6, filter: ['==', ['get', 'class'], 'motorway'], layout: { ...vis(roads), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': p.motorway, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 6, 0.7, 16, 8] } },
    { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12, filter: ['==', ['get', 'class'], 'rail'], layout: vis(base), paint: { 'line-color': p.rail, 'line-width': 1, 'line-dasharray': [4, 2] } },
    { id: 'boundary', type: 'line', source: 'omt', 'source-layer': 'boundary', filter: ['in', ['get', 'admin_level'], ['literal', [2, 4]]], layout: vis(roads), paint: { 'line-color': p.boundary, 'line-width': 1, 'line-dasharray': [3, 2] } },

    // Precipitation radar, drawn over the ground but under the airfield paint and aircraft.
    { id: LAYER.radar, type: 'raster', source: 'radar', layout: vis(false), paint: { 'raster-opacity': chart ? 0.5 : 0.62, 'raster-fade-duration': 300 } },

    // ---- extended centrelines (generated) -------------------------------------
    { id: LAYER.approach, type: 'line', source: SRC.approach, filter: ['==', ['get', 'kind'], 'centreline'], minzoom: 9, paint: { 'line-color': p.approach, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.12, 12, 0.28, 15, 0.16], 'line-width': 1, 'line-dasharray': [6, 5] } },
    { id: LAYER.approachTick, type: 'line', source: SRC.approach, filter: ['==', ['get', 'kind'], 'tick'], minzoom: 10.5, paint: { 'line-color': p.approach, 'line-opacity': 0.32, 'line-width': 1 } },

    // ---- runway pavement and paint (generated from OurAirports) ----------------
    { id: 'apt-surface', type: 'fill', source: SRC.surface, minzoom: 10, layout: vis(paint), paint: { 'fill-color': ['match', ['get', 'surface'], 'concrete', p.runwayConcrete, p.runway] } },
    { id: 'aero-taxi-centre', type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 13.2, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'taxiway']], layout: { ...vis(paint), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': p.taxiLine, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 13.2, 0, 14, 0.8], 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 13, 0.6, 16, 1.2, 19, 4] } },
    { id: 'apt-hold', type: 'line', source: SRC.hold, minzoom: 14, layout: vis(paint), paint: { 'line-color': p.taxiLine, 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 14, 0.8, 17, 2, 20, 8], 'line-dasharray': ['case', ['==', ['get', 'dashed'], 1], ['literal', [1.6, 1.2]], ['literal', [1, 0]]] } },
    { id: 'apt-paint', type: 'fill', source: SRC.paint, minzoom: 12.5, layout: vis(paint), paint: { 'fill-color': p.paint, 'fill-antialias': true, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 13.5, ['match', ['get', 'kind'], 'edge', 0.55, 'centre', 0.85, 0.92]] } },
    {
      id: 'apt-designator',
      type: 'symbol',
      source: SRC.designators,
      minzoom: 13.6,
      layout: {
        ...vis(paint),
        'text-field': ['get', 'text'],
        'text-font': FONT_BOLD,
        // Em size in metres → pixels: the factor is baked in per feature (`px10`).
        'text-size': ['interpolate', ['exponential', 2], ['zoom'], 10, ['get', 'px10'], 22, ['*', ['get', 'px10'], 4096]],
        'text-rotate': ['get', 'rot'],
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'map',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-padding': 0,
      },
      paint: { 'text-color': p.paint, 'text-opacity': ['interpolate', ['linear'], ['zoom'], 13.6, 0, 14.2, 0.95] },
    },

    // ---- 3D buildings (only when the map is tilted) ------------------------------
    { id: LAYER.buildings3d, type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 13, layout: vis(false), paint: { 'fill-extrusion-color': p.buildingTop, 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.92, 'fill-extrusion-vertical-gradient': true } },

    // ---- labels ----------------------------------------------------------------
    { id: 'water-name', type: 'symbol', source: 'omt', 'source-layer': 'water_name', layout: { ...vis(base), 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']], 'text-font': ['Noto Sans Italic'], 'text-size': 12, 'text-letter-spacing': 0.08, 'symbol-placement': 'point' }, paint: { 'text-color': p.waterLabel, 'text-halo-color': p.labelHalo, 'text-halo-width': 1 } },
    { id: 'road-name', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 13.5, filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]], layout: { ...vis(roads), 'text-field': ['coalesce', ['get', 'ref'], ['get', 'name']], 'text-font': FONT, 'text-size': 10, 'symbol-placement': 'line', 'symbol-spacing': 500 }, paint: { 'text-color': p.label, 'text-opacity': 0.7, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.2 } },
    { id: 'place-minor', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 10.5, maxzoom: 14.5, filter: ['in', ['get', 'class'], ['literal', ['suburb', 'village', 'town', 'neighbourhood']]], layout: { ...vis(!chart), 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']], 'text-font': FONT, 'text-size': 11, 'text-letter-spacing': 0.04, 'text-max-width': 7 }, paint: { 'text-color': p.label, 'text-opacity': 0.75, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.2 } },
    { id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place', maxzoom: 13, filter: ['==', ['get', 'class'], 'city'], layout: { ...vis(!chart), 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']], 'text-font': FONT_BOLD, 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 12, 15], 'text-max-width': 7 }, paint: { 'text-color': p.label, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.4 } },

    // Gate numbers and taxiway location signs straight from OpenStreetMap.
    { id: 'aero-gate', type: 'symbol', source: 'omt', 'source-layer': 'aeroway', minzoom: 15.3, filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'class'], 'gate'], ['has', 'ref']], layout: { 'text-field': ['get', 'ref'], 'text-font': FONT_BOLD, 'text-size': ['interpolate', ['linear'], ['zoom'], 15.3, 9, 18, 13], 'text-padding': 4 }, paint: { 'text-color': p.label, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.4 } },
    {
      id: 'aero-taxi-sign',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'aeroway',
      minzoom: 14.4,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'taxiway'], ['has', 'ref']],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 14, 340, 17, 620],
        'text-field': ['get', 'ref'],
        'text-font': FONT_BOLD,
        'text-size': ['interpolate', ['linear'], ['zoom'], 14, 8.5, 17, 12],
        'text-rotation-alignment': 'viewport',
        'text-pitch-alignment': 'viewport',
        'icon-image': 'sign-taxiway',
        'icon-text-fit': 'both',
        'icon-text-fit-padding': [1, 4, 1, 4],
        'icon-rotation-alignment': 'viewport',
        'icon-pitch-alignment': 'viewport',
        'text-padding': 14,
        'text-max-angle': 90,
      },
      paint: { 'text-color': '#F5C518' },
    },
    { id: 'aero-other', type: 'symbol', source: 'omt', 'source-layer': 'aerodrome_label', minzoom: 8, maxzoom: 11, layout: { ...vis(!chart), 'text-field': ['coalesce', ['get', 'iata'], ['get', 'name_en'], ['get', 'name']], 'text-font': FONT_BOLD, 'text-size': 11, 'text-letter-spacing': 0.06, 'text-padding': 8 }, paint: { 'text-color': p.label, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.4 } },
    {
      id: LAYER.runwayChip,
      type: 'symbol',
      source: SRC.ends,
      minzoom: 10.8,
      layout: {
        'text-field': ['get', 'ident'],
        'text-font': FONT_BOLD,
        'text-size': ['interpolate', ['linear'], ['zoom'], 10.8, 8, 12.5, 10, 14.5, 12],
        'text-letter-spacing': 0.04,
        'icon-image': 'sign-runway',
        'icon-text-fit': 'both',
        'icon-text-fit-padding': [1, 4, 1, 4],
        'text-allow-overlap': true,
        'icon-allow-overlap': true,
        'text-ignore-placement': true,
        'icon-ignore-placement': true,
      },
      paint: { 'text-color': '#FFFFFF' },
    },

    // ---- aircraft ----------------------------------------------------------------
    // Faint wake behind every airborne aircraft; the selected one gets the bright trail.
    { id: LAYER.trails, type: 'line', source: SRC.trails, filter: ['==', ['get', 'sel'], 0], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 14, 1.6], 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(160,178,220,0)', 1, chart ? 'rgba(27,37,64,0.55)' : 'rgba(160,178,220,0.42)'] } },
    { id: LAYER.trailGlow, type: 'line', source: SRC.trails, filter: ['==', ['get', 'sel'], 1], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#7C5CFC', 'line-width': 11, 'line-opacity': 0.22, 'line-blur': 6 } },
    { id: LAYER.trail, type: 'line', source: SRC.trails, filter: ['==', ['get', 'sel'], 1], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.2, 15, 3.4], 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(124,92,252,0.02)', 0.5, 'rgba(124,92,252,0.5)', 1, 'rgba(168,140,255,1)'] } },
    { id: LAYER.shadow, type: 'symbol', source: SRC.shadows, layout: { 'icon-image': ['get', 'icon'], 'icon-size': iconScale(['get', 'scale']), 'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-color': '#000000', 'icon-opacity': ['*', chart ? 0.22 : 0.34, ['get', 'o']], 'icon-halo-color': 'rgba(0,0,0,0.35)', 'icon-halo-width': 1.2, 'icon-halo-blur': 1.2 } },
    { id: LAYER.event, type: 'circle', source: SRC.events, paint: { 'circle-radius': ['get', 'r'], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2, 'circle-stroke-opacity': ['get', 'o'], 'circle-pitch-alignment': 'map' } },
    { id: LAYER.ping, type: 'circle', source: SRC.aircraft, filter: ['==', ['get', 'tx'], 1], paint: { 'circle-radius': 20, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#F5C518', 'circle-stroke-width': 2, 'circle-stroke-opacity': 0, 'circle-pitch-alignment': 'map' } },
    { id: LAYER.halo, type: 'circle', source: SRC.aircraft, filter: ['==', ['get', 'hi'], 1], paint: { 'circle-radius': 16, 'circle-color': '#7C5CFC', 'circle-opacity': 0.3, 'circle-blur': 0.85, 'circle-pitch-alignment': 'map' } },
    // Invisible, generous hit target so small icons are easy to tap.
    { id: LAYER.hit, type: 'circle', source: SRC.aircraft, paint: { 'circle-radius': 18, 'circle-opacity': 0 } },
    {
      id: LAYER.aircraft,
      type: 'symbol',
      source: SRC.aircraft,
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': iconScale(['*', ['get', 'scale'], ['case', ['==', ['get', 'hi'], 1], 1.25, 1]]),
        'icon-rotate': ['get', 'heading'],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'symbol-sort-key': ['get', 'z'],
      },
      paint: {
        'icon-color': ['case', ['==', ['get', 'hi'], 1], '#F5C518', ['==', ['get', 'alert'], 1], '#FF5A5F', p.plane],
        'icon-opacity': ['*', ['get', 'o'], ['case', ['==', ['get', 'hi'], 1], 1, ['match', ['get', 'state'], 0, 0.62, 1, 0.94, 1]]],
        'icon-halo-color': ['case', ['==', ['get', 'hi'], 1], '#5B3DF5', p.planeEdge],
        'icon-halo-width': ['case', ['==', ['get', 'hi'], 1], 2.4, 1],
        'icon-halo-blur': ['case', ['==', ['get', 'hi'], 1], 1, 0.4],
      },
    },
    {
      id: LAYER.label,
      type: 'symbol',
      source: SRC.aircraft,
      filter: ['==', ['get', 'lbl'], 1],
      layout: {
        'text-field': ['format', ['get', 'callsign'], {}, ['get', 'sub'], { 'font-scale': 0.82, 'text-color': ['case', ['==', ['get', 'hi'], 1], 'rgba(20,16,4,0.72)', 'rgba(255,255,255,0.62)'] }],
        'text-font': FONT_BOLD,
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 15, 11.5],
        'text-letter-spacing': 0.03,
        'text-line-height': 1.15,
        'text-justify': 'left',
        // Fixed anchor and no collision pass: positions update every frame, and
        // collision-driven placement would make the tags hop between anchors.
        'text-anchor': 'bottom-left',
        'text-offset': ['interpolate', ['linear'], ['zoom'], 10, ['literal', [0.9, -0.7]], 15, ['literal', [1.3, -1]], 17, ['literal', [2.8, -2.2]]],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-image': ['case', ['==', ['get', 'hi'], 1], 'tag-active', 'tag'],
        'icon-text-fit': 'both',
        'icon-text-fit-padding': [3, 6, 3, 6],
        'symbol-sort-key': ['get', 'z'],
      },
      paint: { 'text-color': ['case', ['==', ['get', 'hi'], 1], '#141004', '#FFFFFF'], 'text-opacity': ['get', 'o'], 'icon-opacity': ['get', 'o'] },
    },
  ]
  return list as LayerSpecification[]
}

/**
 * Icon size by zoom, times a per-feature factor. Below z15 the silhouettes
 * are oversized so they can be seen and tapped; from there up they double with
 * each zoom level and so sit at roughly true scale on taxiways and gates.
 * (MapLibre only allows `zoom` at the top of an expression, so the per-feature
 * factor is multiplied into every stop.)
 */
function iconScale(factor: unknown): unknown[] {
  const stops: [number, number][] = [
    [9, 0.32],
    [12, 0.5],
    [14, 0.74],
    [15, 0.95],
    [16, 1.6],
    [19, 12.8],
  ]
  return ['interpolate', ['exponential', 2], ['zoom'], ...stops.flatMap(([z, v]) => [z, ['*', v, factor]])]
}

const USGS_ATTR = 'Imagery: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noreferrer">USGS The National Map</a>'
const FAA_ATTR = 'Charts: <a href="https://www.faa.gov/air_traffic/flight_info/aeronav/" target="_blank" rel="noreferrer">FAA Aeronautical Information Services</a> (not for navigation)'
const RADAR_ATTR = 'Radar: NOAA NEXRAD via <a href="https://mesonet.agron.iastate.edu/" target="_blank" rel="noreferrer">Iowa Environmental Mesonet</a>'

/**
 * NEXRAD base-reflectivity mosaic (US, public domain data). The mosaic
 * refreshes every five minutes; `stamp` changes the URL so tiles are refetched.
 */
export function radarTiles(stamp = 0): string {
  return `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png${stamp ? `?t=${stamp}` : ''}`
}

const OMT_ATTR =
  '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'

/** Complete style for a theme. Used once, at map construction. */
export function buildStyle(theme: MapTheme): StyleSpecification {
  return {
    version: 8,
    name: 'ATC Web',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: OMT_ATTR },
      usgs: {
        type: 'raster',
        tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 16,
        attribution: USGS_ATTR,
      },
      'faa-sectional': {
        type: 'raster',
        tiles: ['https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/VFR_Sectional/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        minzoom: 8,
        maxzoom: 12,
        attribution: FAA_ATTR,
      },
      'faa-terminal': {
        type: 'raster',
        tiles: ['https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/VFR_Terminal/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        minzoom: 10,
        maxzoom: 12,
        attribution: FAA_ATTR,
      },
      radar: {
        type: 'raster',
        tiles: [radarTiles()],
        tileSize: 256,
        maxzoom: 9,
        attribution: RADAR_ATTR,
      },
      [SRC.surface]: { type: 'geojson', data: empty },
      [SRC.paint]: { type: 'geojson', data: empty },
      [SRC.designators]: { type: 'geojson', data: empty },
      [SRC.ends]: { type: 'geojson', data: empty },
      [SRC.approach]: { type: 'geojson', data: empty },
      [SRC.hold]: { type: 'geojson', data: empty },
      [SRC.aircraft]: { type: 'geojson', data: empty },
      [SRC.shadows]: { type: 'geojson', data: empty },
      [SRC.trails]: { type: 'geojson', data: empty, lineMetrics: true },
      [SRC.events]: { type: 'geojson', data: empty },
    },
    layers: layers(PALETTES[theme]),
  }
}

/** Layer properties the app toggles at runtime; a theme change must not undo them. */
const RUNTIME_VISIBILITY = new Set<string>([LAYER.buildings3d, LAYER.buildings, LAYER.approach, LAYER.approachTick, LAYER.trails, LAYER.shadow, LAYER.radar])

/** Re-colour the live map for a theme by pushing each layer's paint and visibility. */
export function applyTheme(map: MapLibreMap, theme: MapTheme) {
  for (const layer of layers(PALETTES[theme])) {
    if (!map.getLayer(layer.id)) continue
    const paint = (layer.paint ?? {}) as Record<string, unknown>
    for (const [prop, value] of Object.entries(paint)) {
      // Animated per frame by the aircraft layer; leave those alone.
      if (layer.id === LAYER.halo || layer.id === LAYER.ping) continue
      map.setPaintProperty(layer.id, prop as never, value as never)
    }
    if (RUNTIME_VISIBILITY.has(layer.id)) continue
    const visibility = (layer.layout as { visibility?: string } | undefined)?.visibility ?? 'visible'
    map.setLayoutProperty(layer.id, 'visibility', visibility as 'visible' | 'none')
  }
}

/** Does this theme draw the vector base map (land, water, flat buildings)? */
export function themeHasVectorBase(theme: MapTheme): boolean {
  return !PALETTES[theme].hideBase
}
