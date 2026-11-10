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
  pads: 'apt-pads',
  aircraft: 'aircraft',
  shadows: 'aircraft-shadows',
  trails: 'aircraft-trails',
  events: 'aircraft-events',
} as const

export const LAYER = {
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
  haloOuter: 'ac-halo-outer',
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
  /** Grey-green used for all vegetation and the airfield when zoomed out, so the wide view stays quiet. */
  far: string
  /** Slate used for open land when zoomed out. */
  farLand: string
  apron: string
  taxiway: string
  /** Lighter band around pavement: the shoulder that rings each grass island. */
  shoulder: string
  /** Blast pads beyond the runway ends. */
  pad: string
  runway: string
  runwayConcrete: string
  /** Runway paint, in four strengths from the threshold block down to the side stripes. */
  paint: string
  paintMid: string
  paintDim: string
  paintFaint: string
  taxiLine: string
  building: string
  buildingEdge: string
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
  bg: '#1A2238',
  // Near-black navy, as in the reference: coastlines read at a glance.
  water: '#060F27',
  land: '#1C243B',
  wood: '#27453A',
  grass: '#2A4A3B',
  infield: '#33594A',
  far: '#26332F',
  farLand: '#2F3749',
  apron: '#191C33',
  taxiway: '#191C33',
  shoulder: '#2E3A57',
  pad: '#343D58',
  runway: '#12152E',
  runwayConcrete: '#151932',
  paint: '#C9CCD7',
  paintMid: '#A9AEBF',
  paintDim: '#8D93A8',
  paintFaint: '#6F7790',
  taxiLine: '#9A852E',
  building: '#2A2D3B',
  buildingEdge: '#3A3E4F',
  roadMinor: '#1D2640',
  roadMajor: '#212A45',
  motorway: '#252F4C',
  roadCase: '#161D32',
  rail: '#202844',
  boundary: '#303B5C',
  label: '#8B95AE',
  labelHalo: '#1A2238',
  waterLabel: '#4A6496',
  approach: '#9AA6C4',
  plane: '#FFFFFF',
  planeEdge: 'rgba(5,10,22,0.75)',
  raster: 'none',
  hideBase: false,
  hidePaint: false,
}

const GRAPHITE: Palette = {
  ...NAVY,
  bg: '#17191C',
  water: '#0F1318',
  land: '#1C1F22',
  wood: '#243029',
  grass: '#26342B',
  infield: '#34493C',
  far: '#262B28',
  farLand: '#2C2F33',
  apron: '#1B1D20',
  taxiway: '#1B1D20',
  shoulder: '#33383E',
  pad: '#3A4046',
  runway: '#141618',
  runwayConcrete: '#17191C',
  paint: '#C8CBD0',
  paintMid: '#A6A9AF',
  paintDim: '#8A8D93',
  paintFaint: '#6C6F75',
  taxiLine: '#8F7F3A',
  building: '#1A1D21',
  buildingEdge: '#2B3036',
  roadMinor: '#1B1E22',
  roadMajor: '#23272C',
  motorway: '#2B3036',
  roadCase: '#0C0E10',
  rail: '#202428',
  boundary: '#33383E',
  label: '#858B93',
  labelHalo: '#17191C',
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
  { id: 'navy', label: 'Night', hint: 'Navy airfield chart', usOnly: false, swatch: ['#191C33', '#33594A', '#12152E'] },
  { id: 'graphite', label: 'Graphite', hint: 'Neutral dark', usOnly: false, swatch: ['#1B1D20', '#34493C', '#141618'] },
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
    // Zoomed out the land is a light slate with darker forest, like a dimmed relief map; closer in it settles to navy.
    { id: 'bg', type: 'background', paint: { 'background-color': base ? ['interpolate', ['linear'], ['zoom'], 10, p.farLand, 12.5, p.bg] : p.bg } },

    // ---- free raster underlays --------------------------------------------
    { id: 'raster-satellite', type: 'raster', source: 'usgs', layout: vis(sat), paint: { 'raster-opacity': 1, 'raster-saturation': -0.15, 'raster-brightness-max': 0.82, 'raster-fade-duration': 200 } },
    { id: 'raster-chart-sectional', type: 'raster', source: 'faa-sectional', layout: vis(chart), paint: { 'raster-opacity': 1, 'raster-fade-duration': 200 } },
    { id: 'raster-chart-terminal', type: 'raster', source: 'faa-terminal', layout: vis(chart), paint: { 'raster-opacity': 1, 'raster-fade-duration': 200 } },

    // ---- land and water ---------------------------------------------------
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', layout: vis(base), paint: { 'fill-color': p.water } },
    { id: 'landuse-residential', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['residential', 'commercial', 'industrial', 'retail']]], layout: vis(base), paint: { 'fill-color': ['interpolate', ['linear'], ['zoom'], 10, p.farLand, 12.5, p.land] } },
    // Airfield ground is slate; only land the map data marks as grass is painted green on top,
    // so a desert field like Phoenix reads as gravel and O'Hare as lawn, as in the reference.
    { id: 'aero-infield', type: 'fill', source: 'omt', 'source-layer': 'aeroway', filter: ['==', ['get', 'class'], 'aerodrome'], layout: vis(base), paint: { 'fill-color': ['interpolate', ['linear'], ['zoom'], 11, p.far, 13.5, p.shoulder], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.55, 12, 1] } },
    { id: 'landcover-wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'wood'], layout: vis(base), paint: { 'fill-color': ['interpolate', ['linear'], ['zoom'], 11, p.far, 13.5, p.wood] } },
    { id: 'landcover-grass', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['grass', 'farmland', 'wetland']]], layout: vis(base), paint: { 'fill-color': ['interpolate', ['linear'], ['zoom'], 11, p.far, 13.5, p.infield] } },
    { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', layout: vis(base), paint: { 'line-color': p.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 3] } },

    // ---- airfield (OpenStreetMap geometry) ----------------------------------
    // Pavement is drawn twice: a wide, lighter "shoulder" pass first, then the dark
    // pavement on top. What shows of the first pass is the band that rings every
    // grass island, and round joins give the islands their rounded corners.
    { id: 'aero-apron-shoulder', type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 12, filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'class'], 'apron']], layout: { ...vis(base), 'line-join': 'round' }, paint: { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.3, 14, 1], 'line-color': p.shoulder, 'line-width': metres(16) } },
    { id: 'aero-taxiway-shoulder', type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 12, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'taxiway']], layout: { ...vis(base), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.3, 14, 1], 'line-color': p.shoulder, 'line-width': metres(54) } },
    { id: 'aero-runway-shoulder', type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 12, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'runway']], layout: { ...vis(base), 'line-cap': 'butt' }, paint: { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.3, 14, 1], 'line-color': p.shoulder, 'line-width': metres(72) } },
    { id: 'aero-apron', type: 'fill', source: 'omt', 'source-layer': 'aeroway', filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'class'], 'apron']], layout: vis(base), paint: { 'fill-color': p.apron } },
    { id: 'aero-taxiway', type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 11, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'taxiway']], layout: { ...vis(base), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, 0.35, 13.5, 1], 'line-color': p.taxiway, 'line-width': metres(38) } },
    { id: 'aero-runway-area', type: 'fill', source: 'omt', 'source-layer': 'aeroway', filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'class'], 'runway']], layout: vis(base), paint: { 'fill-color': p.runway } },
    // Other airports in view (and far zooms) only get this plain stroke.
    { id: 'aero-runway-line', type: 'line', source: 'omt', 'source-layer': 'aeroway', filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'runway']], layout: { ...vis(base), 'line-cap': 'butt' }, paint: { 'line-color': p.runway, 'line-width': metres(46) } },

    // ---- buildings ----------------------------------------------------------
    { id: LAYER.buildings, type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 12, layout: vis(base), paint: { 'fill-color': p.building, 'fill-outline-color': p.buildingEdge, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.25, 14.5, 1] } },

    // ---- roads --------------------------------------------------------------
    { id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 13.5, filter: ['in', ['get', 'class'], ['literal', ['minor', 'tertiary']]], layout: { ...vis(roads), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.3, 14.5, 1], 'line-color': p.roadMinor, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 0.5, 16, 4] } },
    // Service roads across the aprons: thin grey dashes, as painted on real ramps.
    { id: 'road-service', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 14.5, filter: ['==', ['get', 'class'], 'service'], layout: { ...vis(roads), 'line-join': 'round' }, paint: { 'line-color': sat ? 'rgba(255,255,255,0.35)' : '#3B4563', 'line-width': ['interpolate', ['linear'], ['zoom'], 14.5, 0.8, 18, 1.6], 'line-dasharray': [4, 3] } },
    { id: 'road-major-case', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12.5, filter: ['in', ['get', 'class'], ['literal', ['secondary', 'primary', 'trunk']]], layout: { ...vis(base), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.3, 14.5, 1], 'line-color': p.roadCase, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 9, 1.2, 16, 9] } },
    { id: 'road-major', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12.5, filter: ['in', ['get', 'class'], ['literal', ['secondary', 'primary', 'trunk']]], layout: { ...vis(roads), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.3, 14.5, 1], 'line-color': p.roadMajor, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 9, 0.6, 16, 6] } },
    { id: 'road-motorway-case', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 11.5, filter: ['==', ['get', 'class'], 'motorway'], layout: { ...vis(base), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.3, 14.5, 1], 'line-color': p.roadCase, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 6, 1.4, 16, 12] } },
    { id: 'road-motorway', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 11.5, filter: ['==', ['get', 'class'], 'motorway'], layout: { ...vis(roads), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.3, 14.5, 1], 'line-color': p.motorway, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 6, 0.7, 16, 8] } },
    { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12, filter: ['==', ['get', 'class'], 'rail'], layout: vis(base), paint: { 'line-color': p.rail, 'line-width': 1, 'line-dasharray': [4, 2] } },
    { id: 'boundary', type: 'line', source: 'omt', 'source-layer': 'boundary', filter: ['in', ['get', 'admin_level'], ['literal', [2, 4]]], layout: vis(roads), paint: { 'line-color': p.boundary, 'line-width': 1, 'line-dasharray': [3, 2] } },

    // Precipitation radar, drawn over the ground but under the airfield paint and aircraft.
    { id: LAYER.radar, type: 'raster', source: 'radar', layout: vis(false), paint: { 'raster-opacity': chart ? 0.5 : 0.62, 'raster-fade-duration': 300 } },

    // ---- extended centrelines (generated) -------------------------------------
    { id: LAYER.approach, type: 'line', source: SRC.approach, filter: ['==', ['get', 'kind'], 'centreline'], minzoom: 9, paint: { 'line-color': p.approach, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.12, 12, 0.28, 15, 0.16], 'line-width': 1, 'line-dasharray': [6, 5] } },
    { id: LAYER.approachTick, type: 'line', source: SRC.approach, filter: ['==', ['get', 'kind'], 'tick'], minzoom: 10.5, paint: { 'line-color': p.approach, 'line-opacity': 0.32, 'line-width': 1 } },

    // ---- runway pavement and paint (generated from OurAirports) ----------------
    // A dashed centreline makes runways read as runways long before the paint is legible.
    { id: 'aero-runway-dash', type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 11, maxzoom: 14.2, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'runway']], layout: vis(base), paint: { 'line-color': p.paint, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.35, 13, 0.6, 14.2, 0], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 14, 1.2], 'line-dasharray': [5, 4] } },
    // Blast pads beyond the runway ends, with their yellow chevrons.
    { id: 'apt-pad', type: 'fill', source: SRC.pads, minzoom: 12.5, filter: ['==', ['get', 'kind'], 'pad'], layout: vis(paint), paint: { 'fill-color': p.pad } },
    { id: 'apt-pad-chevron', type: 'line', source: SRC.pads, minzoom: 14, filter: ['==', ['get', 'kind'], 'chevron'], layout: { ...vis(paint), 'line-join': 'miter' }, paint: { 'line-color': p.taxiLine, 'line-opacity': 0.85, 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 14, 0.7, 17, 2.4, 20, 14] } },
    { id: 'apt-surface', type: 'fill', source: SRC.surface, minzoom: 10, layout: vis(paint), paint: { 'fill-color': ['match', ['get', 'surface'], 'concrete', p.runwayConcrete, p.runway] } },
    { id: 'aero-taxi-centre', type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 13.2, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'taxiway']], layout: { ...vis(paint), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': p.taxiLine, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 13.2, 0, 14, 0.9], 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 13, 0.6, 16, 1.7, 19, 7] } },
    { id: 'apt-hold', type: 'line', source: SRC.hold, minzoom: 14, layout: vis(paint), paint: { 'line-color': p.taxiLine, 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 14, 1, 17, 2.8, 20, 11], 'line-dasharray': ['case', ['==', ['get', 'dashed'], 1], ['literal', [1.6, 1.2]], ['literal', [1, 0]]] } },
    // Each marking has its own grey: the threshold block brightest, the aiming blocks next,
    // then the touchdown bars, centreline and side stripes receding into the pavement.
    { id: 'apt-paint', type: 'fill', source: SRC.paint, minzoom: 12.5, layout: vis(paint), paint: { 'fill-color': ['match', ['get', 'kind'], 'threshold', p.paint, 'threshold-bar', p.paint, 'aim', p.paintMid, 'edge', p.paintMid, p.paintDim], 'fill-antialias': true, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 13.5, 1] } },
    // Runway numbers and letters, as thin stencil strokes with a real-world width.
    { id: 'apt-designator', type: 'line', source: SRC.designators, minzoom: 13.6, layout: { ...vis(paint), 'line-cap': 'square', 'line-join': 'miter' }, paint: { 'line-color': p.paintMid, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 13.6, 0, 14.4, 1], 'line-width': metres(1.8) } },

    // ---- labels ----------------------------------------------------------------
    { id: 'water-name', type: 'symbol', source: 'omt', 'source-layer': 'water_name', layout: { ...vis(base), 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']], 'text-font': ['Noto Sans Italic'], 'text-size': 12, 'text-letter-spacing': 0.08, 'symbol-placement': 'point' }, paint: { 'text-color': p.waterLabel, 'text-halo-color': p.labelHalo, 'text-halo-width': 1 } },
    { id: 'road-name', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 13.5, filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]], layout: { ...vis(roads), 'text-field': ['coalesce', ['get', 'ref'], ['get', 'name']], 'text-font': FONT, 'text-size': 10, 'symbol-placement': 'line', 'symbol-spacing': 500 }, paint: { 'text-color': p.label, 'text-opacity': 0.7, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.2 } },
    { id: 'place-minor', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 10.5, maxzoom: 14.5, filter: ['in', ['get', 'class'], ['literal', ['suburb', 'village', 'town', 'neighbourhood']]], layout: { ...vis(sat), 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']], 'text-font': FONT, 'text-size': 11, 'text-letter-spacing': 0.04, 'text-max-width': 7 }, paint: { 'text-color': p.label, 'text-opacity': sat ? 0.9 : 0.4, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.2 } },
    { id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place', maxzoom: 13, filter: ['==', ['get', 'class'], 'city'], layout: { ...vis(sat), 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']], 'text-font': FONT_BOLD, 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 12, 15], 'text-max-width': 7 }, paint: { 'text-color': p.label, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.4 } },

    // Gate numbers and taxiway location signs straight from OpenStreetMap.
    // Gates: small yellow chips at terminal scale, numbered once you are close.
    { id: 'aero-gate-dot', type: 'symbol', source: 'omt', 'source-layer': 'aeroway', minzoom: 14.8, maxzoom: 16.6, filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'class'], 'gate']], layout: { 'icon-image': 'gate-chip', 'icon-size': ['interpolate', ['linear'], ['zoom'], 14.8, 0.3, 16.6, 0.5], 'icon-allow-overlap': true }, paint: {} },
    { id: 'aero-gate', type: 'symbol', source: 'omt', 'source-layer': 'aeroway', minzoom: 16.6, filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'class'], 'gate'], ['has', 'ref']], layout: { 'text-field': ['get', 'ref'], 'text-font': FONT_BOLD, 'text-size': ['interpolate', ['linear'], ['zoom'], 16.6, 11, 18.5, 15], 'icon-image': 'gate-chip', 'icon-text-fit': 'both', 'icon-text-fit-padding': [2, 4, 2, 4], 'text-padding': 2 }, paint: { 'text-color': '#1C1503' } },
    // Taxiway letters, laid along the pavement beside the centreline.
    {
      id: 'aero-taxi-sign',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'aeroway',
      minzoom: 14.2,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'taxiway'], ['has', 'ref']],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 14, 280, 17, 560],
        'text-field': ['get', 'ref'],
        'text-font': FONT_BOLD,
        'text-size': ['interpolate', ['linear'], ['zoom'], 14.2, 9.5, 16, 12.5, 18, 16],
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'map',
        'text-keep-upright': true,
        'text-offset': [0, 0.95],
        'text-letter-spacing': 0.04,
        'text-padding': 10,
        'text-max-angle': 35,
      },
      paint: { 'text-color': chart ? '#1B2540' : '#F1F3F8', 'text-halo-color': chart ? 'rgba(255,255,255,0.8)' : sat ? 'rgba(0,0,0,0.7)' : p.taxiway, 'text-halo-width': 1.1 },
    },
    { id: 'aero-other', type: 'symbol', source: 'omt', 'source-layer': 'aerodrome_label', minzoom: 8, maxzoom: 11, layout: { ...vis(sat), 'text-field': ['coalesce', ['get', 'iata'], ['get', 'name_en'], ['get', 'name']], 'text-font': FONT_BOLD, 'text-size': 11, 'text-letter-spacing': 0.06, 'text-padding': 8 }, paint: { 'text-color': p.label, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.4 } },
    // Runway designators at the ends, for the zooms where the painted numbers are too small to read.
    {
      id: LAYER.runwayChip,
      type: 'symbol',
      source: SRC.ends,
      minzoom: 11.2,
      maxzoom: sat ? 24 : 14,
      layout: {
        'text-field': ['get', 'ident'],
        'text-font': FONT_BOLD,
        'text-size': ['interpolate', ['linear'], ['zoom'], 11.2, 9, 14, 12],
        'text-letter-spacing': 0.04,
        'text-padding': 2,
      },
      paint: { 'text-color': chart ? '#1B2540' : 'rgba(232,236,245,0.9)', 'text-halo-color': chart ? 'rgba(255,255,255,0.85)' : 'rgba(12,16,34,0.9)', 'text-halo-width': 1.6 },
    },

    // ---- aircraft ----------------------------------------------------------------
    // Faint wake behind every airborne aircraft; the selected one gets the bright trail.
    { id: LAYER.trails, type: 'line', source: SRC.trails, filter: ['==', ['get', 'sel'], 0], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 14, 1.6], 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(160,178,220,0)', 1, chart ? 'rgba(27,37,64,0.55)' : 'rgba(160,178,220,0.42)'] } },
    { id: LAYER.trailGlow, type: 'line', source: SRC.trails, filter: ['==', ['get', 'sel'], 1], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#7C5CFC', 'line-width': 11, 'line-opacity': 0.22, 'line-blur': 6 } },
    { id: LAYER.trail, type: 'line', source: SRC.trails, filter: ['==', ['get', 'sel'], 1], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.2, 15, 3.4], 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(124,92,252,0.02)', 0.5, 'rgba(124,92,252,0.5)', 1, 'rgba(168,140,255,1)'] } },
    { id: LAYER.shadow, type: 'symbol', source: SRC.shadows, layout: { 'icon-image': ['concat', ['get', 'icon'], '-sdf'], 'icon-size': iconScale(['get', 'scale']), 'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-color': '#000000', 'icon-opacity': ['*', chart ? 0.22 : 0.42, ['get', 'o']], 'icon-halo-color': 'rgba(0,0,0,0.4)', 'icon-halo-width': 1.6, 'icon-halo-blur': 1.6 } },
    { id: LAYER.event, type: 'circle', source: SRC.events, paint: { 'circle-radius': ['get', 'r'], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2, 'circle-stroke-opacity': ['get', 'o'], 'circle-pitch-alignment': 'map' } },
    { id: LAYER.ping, type: 'circle', source: SRC.aircraft, filter: ['==', ['get', 'tx'], 1], paint: { 'circle-radius': 20, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#F5C518', 'circle-stroke-width': 2, 'circle-stroke-opacity': 0, 'circle-pitch-alignment': 'map' } },
    // Two flat discs, one inside the other, under whoever is selected or being talked to.
    { id: LAYER.haloOuter, type: 'circle', source: SRC.aircraft, filter: ['==', ['get', 'hi'], 1], paint: { 'circle-radius': 34, 'circle-color': '#7C5CFC', 'circle-opacity': 0.2, 'circle-pitch-alignment': 'map' } },
    { id: LAYER.halo, type: 'circle', source: SRC.aircraft, filter: ['==', ['get', 'hi'], 1], paint: { 'circle-radius': 19, 'circle-color': '#7C5CFC', 'circle-opacity': 0.34, 'circle-pitch-alignment': 'map' } },
    // Invisible, generous hit target so small icons are easy to tap.
    { id: LAYER.hit, type: 'circle', source: SRC.aircraft, paint: { 'circle-radius': 18, 'circle-opacity': 0 } },
    {
      id: LAYER.aircraft,
      type: 'symbol',
      source: SRC.aircraft,
      layout: {
        'icon-image': ['case', ['==', ['get', 'hi'], 1], ['concat', ['get', 'icon'], '-hi'], ['get', 'icon']],
        'icon-size': iconScale(['*', ['get', 'scale'], ['case', ['==', ['get', 'hi'], 1], 1.25, 1]]),
        'icon-rotate': ['get', 'heading'],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'symbol-sort-key': ['get', 'z'],
      },
      // The silhouettes are shaded artwork (white, and yellow when highlighted), not tinted masks.
      paint: {
        'icon-opacity': ['*', ['get', 'o'], ['case', ['==', ['get', 'hi'], 1], 1, ['match', ['get', 'state'], 0, 0.58, 1]]],
      },
    },
    {
      id: LAYER.label,
      type: 'symbol',
      source: SRC.aircraft,
      filter: ['==', ['get', 'lbl'], 1],
      layout: {
        // The whole tag (plate, airline logo, callsign, data block) is one
        // bitmap drawn in the UI font by `tagImages.ts`; `tag` is its image id.
        'icon-image': ['get', 'tag'],
        // Fixed anchor and no collision pass: positions update every frame, and
        // collision-driven placement would make the tags hop between anchors.
        // The tag floats centred above the aircraft, as in the reference.
        'icon-anchor': 'bottom',
        'icon-offset': ['interpolate', ['linear'], ['zoom'], 9, ['literal', [0, -12]], 14, ['literal', [0, -17.5]], 16, ['literal', [0, -26]], 18, ['literal', [0, -49]]],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'symbol-sort-key': ['get', 'z'],
      },
      // Parked aircraft carry a faded tag, as their silhouettes are faded.
      paint: { 'icon-opacity': ['*', ['get', 'o'], ['case', ['==', ['get', 'hi'], 1], 1, ['match', ['get', 'state'], 0, 0.7, 1]]] },
    },
  ]
  return list as LayerSpecification[]
}

/**
 * Icon size by zoom, times a per-feature factor. Below z15 the silhouettes
 * are oversized so they can be seen and tapped; from there up they double with
 * each zoom level, staying about 1.4× life size so they read clearly on the pavement.
 * (MapLibre only allows `zoom` at the top of an expression, so the per-feature
 * factor is multiplied into every stop.)
 */
function iconScale(factor: unknown): unknown[] {
  const stops: [number, number][] = [
    [9, 0.5],
    [12, 0.64],
    [14, 0.9],
    [15, 1.2],
    [16, 1.8],
    [19, 14.4],
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
      [SRC.pads]: { type: 'geojson', data: empty },
      [SRC.aircraft]: { type: 'geojson', data: empty },
      [SRC.shadows]: { type: 'geojson', data: empty },
      [SRC.trails]: { type: 'geojson', data: empty, lineMetrics: true },
      [SRC.events]: { type: 'geojson', data: empty },
    },
    layers: layers(PALETTES[theme]),
  }
}

/** Layer properties the app toggles at runtime; a theme change must not undo them. */
const RUNTIME_VISIBILITY = new Set<string>([LAYER.buildings, LAYER.approach, LAYER.approachTick, LAYER.trails, LAYER.shadow, LAYER.radar])

/** Re-colour the live map for a theme by pushing each layer's paint and visibility. */
export function applyTheme(map: MapLibreMap, theme: MapTheme) {
  for (const layer of layers(PALETTES[theme])) {
    if (!map.getLayer(layer.id)) continue
    const paint = (layer.paint ?? {}) as Record<string, unknown>
    for (const [prop, value] of Object.entries(paint)) {
      // Animated per frame by the aircraft layer; leave those alone.
      if (layer.id === LAYER.halo || layer.id === LAYER.haloOuter || layer.id === LAYER.ping) continue
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

/**
 * Paint grass the way the current airport needs: green, or slate on a desert
 * field where the "grass" in the data is really gravel. Call after `applyTheme`.
 */
export function applyGroundCover(map: MapLibreMap, theme: MapTheme, arid: boolean) {
  if (!map.getLayer('landcover-grass')) return
  const p = PALETTES[theme]
  map.setPaintProperty('landcover-grass', 'fill-color', ['interpolate', ['linear'], ['zoom'], 11, p.far, 13.5, arid ? p.shoulder : p.infield] as never)
}
