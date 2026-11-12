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
import { ATC_COLORS } from '../ui/speaker'
import { NOISE_IMAGE, SHEEN_IMAGE } from './atmosphere/textures'
import { LIGHT_BAND_ZOOMS } from './fx/sprites'
import { differs, formatColor, mixColor, nightShade, parseColor } from './lighting/color'
import { WAVE_SOFTNESS } from './talkWaves'

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
  /** Blinking lights and exhaust shimmer, apart from the aircraft so a strobe flash doesn't re-send every tag and airframe. */
  fx: 'aircraft-fx',
  /**
   * Parked aircraft (not highlighted): their artwork, fins and tags. They don't move, so this source
   * is re-sent only when one of them changes, not every time something taxies past; the aircraft
   * source still carries a bare point for each of them for the tap target.
   */
  parked: 'aircraft-parked',
  parkedShadows: 'aircraft-shadows-parked',
  events: 'aircraft-events',
  procAll: 'proc-all',
  procNet: 'proc-net',
  procFinal: 'proc-final',
  procHi: 'proc-hi',
  runwayUse: 'apt-runway-use',
  gateUse: 'apt-gate-use',
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
  halo: 'ac-halo',
  haloOuter: 'ac-halo-outer',
  // The aircraft on the radio: a steady glow and soft rings in the speaker's colour (see `talkWaves.ts`).
  talkGlow: 'ac-talk-glow',
  hit: 'ac-hit',
  aircraft: 'ac-icon',
  label: 'ac-label',
  event: 'ac-event',
  procHit: 'proc-hit',
  runwayGlow: 'apt-runway-use-glow',
  runwayUseMark: 'apt-runway-use-mark',
  gateBusyDot: 'apt-gate-busy-dot',
  gateBusy: 'apt-gate-busy',
  // Aircraft effects (see `fx/aircraftFx.ts`).
  contrail: 'ac-contrail',
  contrailWide: 'ac-contrail-wide',
  shadowSoft: 'ac-shadow-soft',
  landing: 'ac-landing',
  exhaust: 'ac-exhaust',
  livery: 'ac-livery',
  lights: 'ac-lights',
  // The parked aircraft's copies of the airframe, fin and shadow layers.
  parkedShadow: 'ac-shadow-parked',
  parkedAircraft: 'ac-icon-parked',
  parkedLivery: 'ac-livery-parked',
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
  /** The dashed runway centreline, a hairline brighter than the rest of the paint. */
  centreLine: string
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
  /** Soft navy aircraft shadows instead of black ones (the neutral and paper themes, where black reads as dirty grey). */
  softShadows?: { color: string; opacity: number }
}

const NAVY: Palette = {
  bg: '#1A2238',
  // Near-black navy, as in the reference: coastlines read at a glance.
  water: '#060F27',
  land: '#1C243B',
  wood: '#27453A',
  grass: '#2A4A3B',
  infield: '#33594C',
  far: '#26332F',
  farLand: '#2F3749',
  // Sampled from the reference: pavement a shade apart from runway to apron, slate shoulders.
  apron: '#161C31',
  taxiway: '#161B2F',
  shoulder: '#2D3A50',
  pad: '#2D3A50',
  runway: '#10182F',
  runwayConcrete: '#121A31',
  // Threshold stripes and numbers; end bars, side stripes and aiming blocks; touchdown bars.
  paint: '#C2C2C8',
  paintMid: '#9699A3',
  paintDim: '#7A7E8A',
  paintFaint: '#6F7790',
  centreLine: '#EEF2FA',
  taxiLine: '#8C7B2F',
  // Terminals read as slate-grey blocks against the navy ramps (sampled #333647 / #333C4D).
  building: '#323648',
  buildingEdge: '#40455A',
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
  pad: '#33383E',
  runway: '#141618',
  runwayConcrete: '#17191C',
  paint: '#C8CBD0',
  paintMid: '#A6A9AF',
  paintDim: '#8A8D93',
  paintFaint: '#6C6F75',
  centreLine: '#E8EAEE',
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
  softShadows: { color: '#0C1533', opacity: 0.34 },
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
  softShadows: { color: '#1B2A55', opacity: 0.17 },
  hideBase: true,
  hidePaint: false,
}

const PALETTES: Record<MapTheme, Palette> = { navy: NAVY, graphite: GRAPHITE, satellite: SATELLITE, chart: CHART }

/** Display metadata for the theme picker. */
export const MAP_THEMES: { id: MapTheme; label: string; hint: string; usOnly: boolean; swatch: [string, string, string] }[] = [
  { id: 'navy', label: 'Navy', hint: 'Navy airfield chart', usOnly: false, swatch: ['#161B2F', '#33594C', '#10182F'] },
  { id: 'graphite', label: 'Graphite', hint: 'Neutral dark', usOnly: false, swatch: ['#1B1D20', '#34493C', '#141618'] },
  { id: 'satellite', label: 'Satellite', hint: 'USGS aerial photos', usOnly: true, swatch: ['#3A4A3C', '#6E7A63', '#9AA08F'] },
  { id: 'chart', label: 'FAA chart', hint: 'VFR sectional', usOnly: true, swatch: ['#E9E2CF', '#8FB7D9', '#C7B8E0'] },
]

/** Themes backed by US-government rasters have nothing to show elsewhere. */
export function effectiveTheme(_theme: MapTheme, _isUs: boolean): MapTheme {
  // The owner chose one look for the app: the navy airfield chart. The other
  // styles stay defined (tests, and an easy way back) but are never drawn.
  return 'navy'
}

/** Transparent square the runway keep-out layer is made of, and its size in pixels. */
export const KEEPOUT_IMAGE = 'runway-keepout'
export const KEEPOUT_PX = 8

/** Runway-in-use colours: arrivals green, departures blue, both cyan (as in iOS's system palette). */
export const RUNWAY_USE_COLOR = { arrivals: '#34C759', departures: '#3D9BFF', both: '#5AC8FA' } as const

const FONT = ['Noto Sans Regular']
const FONT_BOLD = ['Noto Sans Bold']

/**
 * Line width that tracks a real-world width in metres (doubles every zoom
 * level), worked out at 40°N. `m` may be an expression, so generated features
 * can carry their own width and latitude factor (`k`, see `widthScale`).
 * `minPx` keeps small marks visible when zoomed out; `topZoom` is the last stop.
 */
function metres(m: number | unknown[], minPx = 0, topZoom = 22): unknown[] {
  // Pixels at z10, then ×2 per zoom: with 512 px tiles one pixel is 76.44 m at the equator at z10.
  const px10 = 1 / (76.437 * Math.cos((40 * Math.PI) / 180))
  const stops = [10, 13, 14, 15, 16, topZoom].flatMap((z) => {
    const f = px10 * 2 ** (z - 10)
    const v = typeof m === 'number' ? m * f : ['*', m, f]
    return [z, minPx ? (typeof v === 'number' ? Math.max(minPx, v) : ['max', minPx, v]) : v]
  })
  return ['interpolate', ['exponential', 2], ['zoom'], ...stops]
}

/** A generated feature's own real-world width (`w`, metres, default `fallback`), true to its latitude. */
const ownWidth = (fallback: number): unknown[] => ['*', ['coalesce', ['get', 'w'], fallback], ['coalesce', ['get', 'k'], 1]]

const vis = (show: boolean) => ({ visibility: show ? ('visible' as const) : ('none' as const) })
const empty = { type: 'FeatureCollection' as const, features: [] }

function layers(p: Palette): LayerSpecification[] {
  const base = !p.hideBase
  const paint = !p.hidePaint
  const sat = p.raster === 'satellite'
  const chart = p.raster === 'chart'
  // The reference map shows no streets at all, only the airfield; roads are kept for
  // satellite imagery, where they help to read the photo.
  const roads = sat
  // An aircraft's crisp distance-field shadow (the moving aircraft's, or the parked ones' on their own source).
  const sharpShadow = (id: string, source: string) => ({ id, type: 'symbol', source, layout: { 'icon-image': ['concat', ['get', 'icon'], '-sdf'], 'icon-size': iconScale(['get', 'scale']), 'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-color': p.softShadows?.color ?? '#000000', 'icon-opacity': ['*', p.softShadows?.opacity ?? (chart ? 0.22 : 0.42), ['get', 'o'], ['-', 1, ['coalesce', ['get', 'bl'], 0]]], 'icon-halo-color': p.softShadows ? tone(p.softShadows.color, 'rgba(0,0,0,0)', 0.6) : 'rgba(0,0,0,0.4)', 'icon-halo-width': p.softShadows ? 2.2 : 1.6, 'icon-halo-blur': p.softShadows ? 2.4 : 1.6 } })

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
    { id: 'aero-infield', type: 'fill', source: 'omt', 'source-layer': 'aeroway', filter: ['==', ['get', 'class'], 'aerodrome'], layout: vis(base), paint: { 'fill-color': ['interpolate', ['linear'], ['zoom'], 10.5, p.far, 12.3, p.shoulder], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.55, 12, 1] } },
    { id: 'landcover-wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'wood'], layout: vis(base), paint: { 'fill-color': ['interpolate', ['linear'], ['zoom'], 10.5, p.far, 12.3, p.wood] } },
    { id: 'landcover-grass', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['grass', 'farmland', 'wetland']]], layout: vis(base), paint: { 'fill-color': ['interpolate', ['linear'], ['zoom'], 10.5, p.far, 12.3, p.infield] } },
    { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', layout: vis(base), paint: { 'line-color': p.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 3] } },

    // ---- airfield (OpenStreetMap geometry) ----------------------------------
    // Pavement is drawn twice: a wide, lighter "shoulder" pass first, then the dark
    // pavement on top. What shows of the first pass is the band that rings every
    // grass island, and round joins give the islands their rounded corners.
    { id: 'aero-apron-shoulder', type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 12, filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'class'], 'apron']], layout: { ...vis(base), 'line-join': 'round' }, paint: { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 14, 1], 'line-color': p.shoulder, 'line-width': metres(16) } },
    { id: 'aero-taxiway-shoulder', type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 12, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'taxiway']], layout: { ...vis(base), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 14, 1], 'line-color': p.shoulder, 'line-width': metres(66) } },
    { id: 'aero-runway-shoulder', type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 12, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'runway']], layout: { ...vis(base), 'line-cap': 'butt' }, paint: { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 14, 1], 'line-color': p.shoulder, 'line-width': metres(61) } },
    { id: 'aero-apron', type: 'fill', source: 'omt', 'source-layer': 'aeroway', filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'class'], 'apron']], layout: vis(base), paint: { 'fill-color': p.apron } },
    { id: 'aero-taxiway', type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 11, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'taxiway']], layout: { ...vis(base), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, 0.35, 13.5, 1], 'line-color': p.taxiway, 'line-width': metres(48) } },
    // OpenStreetMap runway outlines often take in the paved shoulders, so they are
    // shoulder-coloured: the runway proper is the stroke and generated surface on top.
    { id: 'aero-runway-area', type: 'fill', source: 'omt', 'source-layer': 'aeroway', filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'class'], 'runway']], layout: vis(base), paint: { 'fill-color': p.shoulder } },
    // Other airports in view (and far zooms) only get this plain stroke.
    { id: 'aero-runway-line', type: 'line', source: 'omt', 'source-layer': 'aeroway', filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'runway']], layout: { ...vis(base), 'line-cap': 'butt' }, paint: { 'line-color': p.runway, 'line-width': metres(46) } },

    // ---- buildings ----------------------------------------------------------
    { id: LAYER.buildings, type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 12, layout: vis(base), paint: { 'fill-color': ['interpolate', ['linear'], ['zoom'], 14, p.building, 16.5, roofTone(p)], 'fill-outline-color': p.buildingEdge, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.25, 14.5, 1] } },

    // ---- roads --------------------------------------------------------------
    { id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 13.5, filter: ['in', ['get', 'class'], ['literal', ['minor', 'tertiary']]], layout: { ...vis(roads), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.3, 14.5, 1], 'line-color': p.roadMinor, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 0.5, 16, 4] } },
    // Service roads across the aprons: thin grey dashes, as painted on real ramps.
    { id: 'road-service', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 14.5, filter: ['==', ['get', 'class'], 'service'], layout: { ...vis(roads), 'line-join': 'round' }, paint: { 'line-color': sat ? 'rgba(255,255,255,0.35)' : '#3B4563', 'line-width': ['interpolate', ['linear'], ['zoom'], 14.5, 0.8, 18, 1.6], 'line-dasharray': [4, 3] } },
    { id: 'road-major-case', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12.5, filter: ['in', ['get', 'class'], ['literal', ['secondary', 'primary', 'trunk']]], layout: { ...vis(roads), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.3, 14.5, 1], 'line-color': p.roadCase, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 9, 1.2, 16, 9] } },
    { id: 'road-major', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12.5, filter: ['in', ['get', 'class'], ['literal', ['secondary', 'primary', 'trunk']]], layout: { ...vis(roads), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.3, 14.5, 1], 'line-color': p.roadMajor, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 9, 0.6, 16, 6] } },
    { id: 'road-motorway-case', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 11.5, filter: ['==', ['get', 'class'], 'motorway'], layout: { ...vis(roads), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.3, 14.5, 1], 'line-color': p.roadCase, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 6, 1.4, 16, 12] } },
    { id: 'road-motorway', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 11.5, filter: ['==', ['get', 'class'], 'motorway'], layout: { ...vis(roads), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.3, 14.5, 1], 'line-color': p.motorway, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 6, 0.7, 16, 8] } },
    { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12, filter: ['==', ['get', 'class'], 'rail'], layout: vis(roads), paint: { 'line-color': p.rail, 'line-width': 1, 'line-dasharray': [4, 2] } },
    { id: 'boundary', type: 'line', source: 'omt', 'source-layer': 'boundary', filter: ['in', ['get', 'admin_level'], ['literal', [2, 4]]], layout: vis(roads), paint: { 'line-color': p.boundary, 'line-width': 1, 'line-dasharray': [3, 2] } },

    // Precipitation radar, drawn over the ground but under the airfield paint and aircraft.
    { id: LAYER.radar, type: 'raster', source: 'radar', layout: vis(false), paint: { 'raster-opacity': chart ? 0.5 : 0.62, 'raster-fade-duration': 300 } },

    // ---- extended centrelines (generated) -------------------------------------
    { id: LAYER.approach, type: 'line', source: SRC.approach, filter: ['==', ['get', 'kind'], 'centreline'], minzoom: 9, paint: { 'line-color': p.approach, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.12, 12, 0.28, 15, 0.16], 'line-width': 1, 'line-dasharray': [6, 5] } },
    { id: LAYER.approachTick, type: 'line', source: SRC.approach, filter: ['==', ['get', 'kind'], 'tick'], minzoom: 10.5, paint: { 'line-color': p.approach, 'line-opacity': 0.32, 'line-width': 1 } },

    // ---- instrument procedures (CIFP; empty unless "Procedures" is on) ----------
    ...procedureLayers(p),

    // ---- runway pavement and paint (generated from the runway data) ----------------
    // A dashed centreline makes runways read as runways long before the paint is legible.
    { id: 'aero-runway-dash', type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 11, maxzoom: 14.2, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'runway']], layout: vis(base), paint: { 'line-color': p.paint, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.35, 13, 0.6, 14.2, 0], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 14, 1.2], 'line-dasharray': [5, 4] } },
    // Taxiway centrelines go under the runway pavement, so they stop at the runway edge as in the reference.
    { id: 'aero-taxi-centre', type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 13.2, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'taxiway']], layout: { ...vis(paint), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': p.taxiLine, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 14.6, 0, 15.4, 0.9], 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 13, 0.6, 16, 1.7, 19, 7] } },
    // Blast pads beyond the runway ends, with their yellow chevrons.
    // Blast pads: the newest reference draws only the chevrons, straight on the grass.
    { id: 'apt-pad', type: 'fill', source: SRC.pads, minzoom: 12.5, filter: ['==', ['get', 'kind'], 'pad'], layout: vis(paint), paint: { 'fill-color': p.pad, 'fill-opacity': 0 } },
    // Yellow at about 70%, so they read olive over the pad as in the reference.
    { id: 'apt-pad-chevron', type: 'line', source: SRC.pads, minzoom: 14, filter: ['==', ['get', 'kind'], 'chevron'], layout: { ...vis(paint), 'line-join': 'miter' }, paint: { 'line-color': p.taxiLine, 'line-opacity': 0.75, 'line-width': metres(ownWidth(1.4), 0.6) } },
    { id: 'apt-surface', type: 'fill', source: SRC.surface, minzoom: 10, layout: vis(paint), paint: { 'fill-color': ['match', ['get', 'surface'], 'concrete', p.runwayConcrete, p.runway] } },
    // Holding-position markings: a dark band carrying two solid and two dashed yellow lines.
    { id: 'apt-hold-band', type: 'line', source: SRC.hold, minzoom: 14, filter: ['==', ['get', 'kind'], 'band'], layout: vis(paint), paint: { 'line-color': '#15140F', 'line-opacity': 0.85, 'line-width': metres(['*', 3.2, ['coalesce', ['get', 'k'], 1]], 3) } },
    { id: 'apt-hold', type: 'line', source: SRC.hold, minzoom: 14, filter: ['==', ['get', 'kind'], 'solid'], layout: vis(paint), paint: { 'line-color': p.taxiLine, 'line-width': metres(['*', 0.36, ['coalesce', ['get', 'k'], 1]], 0.7) } },
    { id: 'apt-hold-dash', type: 'line', source: SRC.hold, minzoom: 14, filter: ['==', ['get', 'kind'], 'dashed'], layout: vis(paint), paint: { 'line-color': p.taxiLine, 'line-width': metres(['*', 0.36, ['coalesce', ['get', 'k'], 1]], 0.7), 'line-dasharray': [2.5, 2.5] } },
    // Greys sampled from the reference: threshold stripes and numbers brightest; the end bars,
    // side stripes, aiming blocks and arrows a mid grey; touchdown bars dimmest.
    { id: 'apt-paint', type: 'fill', source: SRC.paint, minzoom: 12.5, layout: vis(paint), paint: { 'fill-color': ['match', ['get', 'kind'], ['threshold', 'threshold-bar'], p.paint, ['end', 'aim', 'edge', 'arrow'], p.paintMid, p.paintDim], 'fill-antialias': true, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 13.5, 1] } },
    // Runway numbers and letters, as stencil strokes with a real-world width.
    { id: 'apt-designator', type: 'line', source: SRC.designators, minzoom: 13.6, filter: ['==', ['get', 'kind'], 'numeral'], layout: { ...vis(paint), 'line-cap': 'square', 'line-join': 'miter' }, paint: { 'line-color': p.paint, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 13.6, 0, 14.4, 1], 'line-width': metres(ownWidth(1.5)) } },
    // The dashed centreline is a bright hairline at every zoom, as in the reference.
    { id: 'apt-centreline', type: 'line', source: SRC.designators, minzoom: 13.2, filter: ['==', ['get', 'kind'], 'centre'], layout: { ...vis(paint), 'line-cap': 'butt' }, paint: { 'line-color': p.centreLine, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 13.2, 0, 14, 0.85], 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 14, 0.6, 17, 1, 19, 2.4] } },

    // ---- labels ----------------------------------------------------------------
    { id: 'water-name', type: 'symbol', source: 'omt', 'source-layer': 'water_name', layout: { ...vis(base), 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']], 'text-font': ['Noto Sans Italic'], 'text-size': 12, 'text-letter-spacing': 0.08, 'symbol-placement': 'point' }, paint: { 'text-color': p.waterLabel, 'text-halo-color': p.labelHalo, 'text-halo-width': 1 } },
    { id: 'road-name', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 13.5, filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]], layout: { ...vis(roads), 'text-field': ['coalesce', ['get', 'ref'], ['get', 'name']], 'text-font': FONT, 'text-size': 10, 'symbol-placement': 'line', 'symbol-spacing': 500 }, paint: { 'text-color': p.label, 'text-opacity': 0.7, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.2 } },
    { id: 'place-minor', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 10.5, maxzoom: 14.5, filter: ['in', ['get', 'class'], ['literal', ['suburb', 'village', 'town', 'neighbourhood']]], layout: { ...vis(sat), 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']], 'text-font': FONT, 'text-size': 11, 'text-letter-spacing': 0.04, 'text-max-width': 7 }, paint: { 'text-color': p.label, 'text-opacity': sat ? 0.9 : 0.4, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.2 } },
    { id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place', maxzoom: 13, filter: ['==', ['get', 'class'], 'city'], layout: { ...vis(sat), 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']], 'text-font': FONT_BOLD, 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 12, 15], 'text-max-width': 7 }, paint: { 'text-color': p.label, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.4 } },

    // Gate numbers and taxiway location signs straight from OpenStreetMap.
    // Gates: small yellow chips at terminal scale, numbered from about 15.8 (as in the reference's gate views).
    { id: 'aero-gate-dot', type: 'symbol', source: 'omt', 'source-layer': 'aeroway', minzoom: 14.4, maxzoom: 15.8, filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'class'], 'gate']], layout: { 'icon-image': 'gate-chip', 'icon-size': ['interpolate', ['linear'], ['zoom'], 14.4, 0.3, 15.8, 0.5], 'icon-allow-overlap': false, 'icon-padding': 0 }, paint: {} },
    { id: 'aero-gate', type: 'symbol', source: 'omt', 'source-layer': 'aeroway', minzoom: 15.8, filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'class'], 'gate'], ['has', 'ref']], layout: { 'text-field': ['get', 'ref'], 'text-font': FONT_BOLD, 'text-size': ['interpolate', ['linear'], ['zoom'], 15.8, 10.5, 18.5, 14], 'icon-image': 'gate-chip', 'icon-text-fit': 'both', 'icon-text-fit-padding': [2, 4, 2, 4], 'text-padding': 2 }, paint: { 'text-color': '#1C1503' } },
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
        'text-size': ['interpolate', ['linear'], ['zoom'], 14.2, 10, 16, 13, 18, 16.5],
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
    // Invisible blocks along each runway's axis. Symbols are placed top layer first,
    // so these claim the runway before the taxiway letters, which then never land on the paint.
    {
      id: 'apt-runway-keepout',
      type: 'symbol',
      source: SRC.designators,
      minzoom: 14.2,
      filter: ['==', ['get', 'kind'], 'axis'],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': metres(40, 1) as never,
        'icon-image': KEEPOUT_IMAGE,
        // Topped out at z20 (past the map's deepest zoom): MapLibre evaluates icon sizes at the
        // surrounding stops, and the z22 one would pass its 255 limit and fill the console with warnings.
        'icon-size': metres(['/', ownWidth(45), KEEPOUT_PX], 0.1, 20) as never,
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-padding': 0,
      },
      paint: { 'icon-opacity': 0 },
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
        'text-field': runwaySignText(chart),
        'text-font': FONT_BOLD,
        'text-size': ['interpolate', ['linear'], ['zoom'], 11.2, 9, 14, 12],
        'text-letter-spacing': 0.04,
        'text-padding': 2,
      },
      paint: { 'text-color': chart ? '#1B2540' : 'rgba(232,236,245,0.9)', 'text-halo-color': chart ? 'rgba(255,255,255,0.85)' : 'rgba(12,16,34,0.9)', 'text-halo-width': 1.6 },
    },

    // ---- runways in use and occupied gates (fed by RunwayGateLayer) ------------
    // A glow along an active runway's first stretch, kept but hidden: the
    // reference map shows runways in use only by the badge on the runway chip.
    {
      id: LAYER.runwayGlow,
      type: 'line',
      source: SRC.runwayUse,
      minzoom: 11,
      filter: ['==', ['get', 'kind'], 'glow'],
      layout: { 'line-cap': 'butt', visibility: 'none' },
      paint: {
        'line-color': ['match', ['get', 'role'], 'arrivals', RUNWAY_USE_COLOR.arrivals, 'departures', RUNWAY_USE_COLOR.departures, RUNWAY_USE_COLOR.both],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.45, 14, 0.32, 17, 0.26],
        'line-gap-width': metres(ownWidth(45), 1),
        'line-width': ['interpolate', ['exponential', 2], ['zoom'], 11, 2.5, 14, 7, 17, 36],
        'line-blur': ['interpolate', ['exponential', 2], ['zoom'], 11, 2, 14, 6, 17, 30],
      },
    },
    // Occupied gates: the same chips as `aero-gate`, filled with the parked airline's colour.
    // Placed first (top layer), they win the collision and hide the plain chip underneath.
    { id: LAYER.gateBusyDot, type: 'symbol', source: SRC.gateUse, minzoom: 14.4, maxzoom: 15.8, layout: { 'icon-image': ['get', 'chip'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 14.4, 0.36, 15.8, 0.6], 'icon-allow-overlap': false, 'icon-padding': 0 }, paint: {} },
    { id: LAYER.gateBusy, type: 'symbol', source: SRC.gateUse, minzoom: 15.8, filter: ['!=', ['get', 'ref'], ''], layout: { 'text-field': ['get', 'ref'], 'text-font': FONT_BOLD, 'text-size': ['interpolate', ['linear'], ['zoom'], 15.8, 10.5, 18.5, 14], 'icon-image': ['get', 'chip'], 'icon-text-fit': 'both', 'icon-text-fit-padding': [2, 4, 2, 4], 'text-padding': 2 }, paint: { 'text-color': ['get', 'tc'] } },
    // Arrival / departure badge above an active runway's number.
    {
      id: LAYER.runwayUseMark,
      type: 'symbol',
      source: SRC.runwayUse,
      minzoom: 11.2,
      filter: ['==', ['get', 'kind'], 'mark'],
      layout: {
        'icon-image': ['get', 'icon'],
        // Same place at every runway and every zoom: centred just above the runway
        // number (the number sits on the extended centreline beyond the runway end),
        // so the badge never depends on the number's length or the runway's direction.
        'icon-anchor': 'bottom',
        'icon-offset': ['literal', [0, -8]],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 11.2, 0.85, 14, 1],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 11.2, 0.85, 14, 0.95] },
    },

    // ---- aircraft ----------------------------------------------------------------
    // Contrails behind aircraft cruising above ~FL250: a thin bright core that forms a little behind the aircraft, and a wider, softer spread further back.
    { id: LAYER.contrailWide, type: 'line', source: SRC.trails, filter: ['==', ['get', 'sel'], 2], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 8, 2.2, 11, 4.5, 14, 14], 'line-blur': ['interpolate', ['exponential', 2], ['zoom'], 8, 1.6, 11, 3.5, 14, 11], 'line-opacity': ['get', 'co'], 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(236,242,255,0)', 0.3, chart ? 'rgba(90,100,120,0.12)' : 'rgba(236,242,255,0.2)', 0.8, chart ? 'rgba(90,100,120,0.1)' : 'rgba(236,242,255,0.16)', 1, 'rgba(236,242,255,0)'] } },
    { id: LAYER.contrail, type: 'line', source: SRC.trails, filter: ['==', ['get', 'sel'], 2], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 8, 0.9, 11, 1.4, 14, 3.2], 'line-blur': 0.6, 'line-opacity': ['get', 'co'], 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(244,248,255,0)', 0.5, chart ? 'rgba(80,90,110,0.18)' : 'rgba(244,248,255,0.3)', 0.9, chart ? 'rgba(80,90,110,0.3)' : 'rgba(244,248,255,0.62)', 0.975, 'rgba(244,248,255,0.2)', 1, 'rgba(244,248,255,0)'] } },
    // Faint wake behind every airborne aircraft; the selected one gets the bright trail.
    { id: LAYER.trails, type: 'line', source: SRC.trails, filter: ['==', ['get', 'sel'], 0], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 14, 1.6], 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(160,178,220,0)', 1, chart ? 'rgba(27,37,64,0.55)' : 'rgba(160,178,220,0.42)'] } },
    // The selected aircraft's trail is in the selected tag's violet (#5B3DF5), lifted a little toward the aircraft so it reads on navy: one family with the tag and the halo.
    { id: LAYER.trailGlow, type: 'line', source: SRC.trails, filter: ['==', ['get', 'sel'], 1], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#6A4CF8', 'line-width': 11, 'line-opacity': 0.22, 'line-blur': 6 } },
    { id: LAYER.trail, type: 'line', source: SRC.trails, filter: ['==', ['get', 'sel'], 1], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.2, 15, 3.4], 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(98,68,246,0.02)', 0.5, 'rgba(98,68,246,0.52)', 1, 'rgba(146,122,255,1)'] } },
    // The shadow sharpens on the ground and softens with height: a crisp distance-field silhouette cross-fades into a pre-blurred one (`bl`).
    sharpShadow(LAYER.shadow, SRC.shadows),
    { id: LAYER.shadowSoft, type: 'symbol', source: SRC.shadows, filter: ['>', ['coalesce', ['get', 'bl'], 0], 0], layout: { 'icon-image': ['concat', 'fx-blur-', ['get', 'sh']], 'icon-size': iconScale(['*', ['get', 'scale'], 1.06]), 'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-opacity': ['*', chart ? 0.24 : 0.46, ['get', 'o'], ['get', 'bl']] } },
    // Parked aircraft's shadows, from their own source (see SRC.parked); on the ground they are never soft.
    sharpShadow(LAYER.parkedShadow, SRC.parkedShadows),
    // Landing lights thrown ahead of the nose, and heat shimmer behind the engines on the takeoff roll.
    { id: LAYER.landing, type: 'symbol', source: SRC.aircraft, filter: ['>', ['coalesce', ['get', 'll'], 0], 0], layout: { 'icon-image': ['concat', 'fx-land-', ['get', 'sh']], 'icon-size': iconScale(acSize), 'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 10, ['*', ['get', 'o'], ['get', 'll'], chart ? 0 : 0.28], 14, ['*', ['get', 'o'], ['get', 'll'], chart ? 0 : 0.52]] } },
    { id: LAYER.exhaust, type: 'symbol', source: SRC.fx, filter: ['!=', ['coalesce', ['get', 'ex'], ''], ''], layout: { 'icon-image': ['get', 'ex'], 'icon-size': iconScale(acSize), 'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-opacity': ['*', ['get', 'o'], ['get', 'exo']] } },
    { id: LAYER.event, type: 'circle', source: SRC.events, paint: { 'circle-radius': ['get', 'r'], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2, 'circle-stroke-opacity': ['get', 'o'], 'circle-pitch-alignment': 'map' } },
    // Two flat discs, one inside the other, under the selected aircraft. `AircraftLayer` sizes them to the aircraft and lets them breathe.
    { id: LAYER.haloOuter, type: 'circle', source: SRC.aircraft, filter: SELECTED_ONLY, paint: { 'circle-radius': 34, 'circle-color': SELECT_HALO, 'circle-opacity': 0.16, 'circle-blur': 0.2, 'circle-pitch-alignment': 'map' } },
    { id: LAYER.halo, type: 'circle', source: SRC.aircraft, filter: SELECTED_ONLY, paint: { 'circle-radius': 19, 'circle-color': SELECT_HALO, 'circle-opacity': 0.3, 'circle-blur': 0.12, 'circle-pitch-alignment': 'map' } },
    // The aircraft on the radio wears the speaker's colour instead: a faint steady glow and soft rings swelling out of it.
    ...talkLayers(),
    // Invisible, generous hit target so small icons are easy to tap.
    { id: LAYER.hit, type: 'circle', source: SRC.aircraft, paint: { 'circle-radius': 18, 'circle-opacity': 0 } },
    // Parked aircraft first, from their own source, so taxiing and airborne traffic draws over them.
    aircraftLayer(LAYER.parkedAircraft, SRC.parked),
    liveryLayer(LAYER.parkedLivery, SRC.parked),
    // The aircraft source's parked points are only tap targets; their artwork is the layer above.
    aircraftLayer(LAYER.aircraft, SRC.aircraft, ['!=', ['coalesce', ['get', 'ps'], 0], 1]),
    liveryLayer(LAYER.livery, SRC.aircraft),
    // Navigation lights, strobes and beacon: `lt` names the sprite lit this instant; the glow size steps with zoom.
    {
      id: LAYER.lights,
      type: 'symbol',
      source: SRC.fx,
      filter: ['!=', ['coalesce', ['get', 'lt'], ''], ''],
      layout: {
        'icon-image': ['step', ['zoom'], ['concat', ['get', 'lt'], '0'], LIGHT_BAND_ZOOMS[0], ['concat', ['get', 'lt'], '1'], LIGHT_BAND_ZOOMS[1], ['concat', ['get', 'lt'], '2']],
        'icon-size': iconScale(acSize),
        'icon-rotate': ['get', 'heading'],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'symbol-sort-key': ['get', 'z'],
      },
      paint: { 'icon-opacity': ['*', ['get', 'o'], ['get', 'lo'], chart ? 0.5 : 1] },
    },
    // Callsign tags. The whole tag (plate, airline logo, callsign, data block) is one
    // bitmap drawn in the UI font by `tagImages.ts`; `tag` is its image id. The tag
    // floats centred above the aircraft, as in the reference.
    // Tags take part in symbol collision, so the gate chips, gate numbers and taxiway
    // letters under them give way instead of showing through. Symbols are placed top
    // layer first: moving and highlighted aircraft (always shown, never pushed around,
    // as their positions change every frame) claim their space, then parked aircraft's
    // tags, which give way to those and to each other rather than piling up along a pier.
    tagLayer('ac-label-parked', ['all', ['==', ['get', 'lbl'], 1], ['==', ['get', 'state'], 0], ['==', ['get', 'hi'], 0]], false, SRC.parked),
    tagLayer(LAYER.label, ['all', ['==', ['get', 'lbl'], 1], ['any', ['!=', ['get', 'state'], 0], ['==', ['get', 'hi'], 1]]], true),
  ]
  return withAtmosphere(list as LayerSpecification[], p)
}

/**
 * Reduced copies of the aircraft artwork, each used below its zoom (image
 * ids carry the tier's suffix). MapLibre packs every image a symbol tile uses
 * into that tile's atlas and uploads it again whenever the tile's data
 * changes, which for the aircraft is every frame; with full-size artwork
 * that was several megabytes uploaded (and premultiplied in JavaScript) per
 * frame. A copy only needs to be as big as the aircraft is drawn on this
 * screen at its top zoom; the style picks the copy with a `step` on zoom.
 * Layout properties are evaluated at the tile's whole zoom level (a map at
 * 14.9 lays out z14 tiles), so the thresholds are whole numbers and each copy
 * is sized for the very top of its range.
 */
const ART_TIERS = [
  { below: 15, suffix: '~s' },
  { below: 16, suffix: '~m' },
] as const

/** Full-size artwork in pixels (see `mapImages`). */
export const ART_PX = 384
const ART_BOX = 48

export type ArtTier = { below: number; suffix: string }

/** Pixels a tier's copy needs for a class drawn at `scale`: its drawn box at the tier's top zoom, highlighted (a quarter bigger), on a `dpr` screen. */
export function artTierPx(below: number, scale: number, dpr: number): number {
  const need = ART_BOX * iconZoomFactor(below) * scale * 1.25 * Math.max(1, dpr)
  return Math.min(ART_PX, Math.max(32, Math.ceil(need / 16) * 16))
}

/** The tiers worth having on a `dpr` screen: one whose airliner copy would be near full size anyway is left out. */
export function artTiersFor(dpr: number): ArtTier[] {
  return ART_TIERS.filter((t) => artTierPx(t.below, 1, dpr) < 0.8 * ART_PX)
}

let tiersHere: ArtTier[] | null = null
/** This screen's tiers, decided once so the style and the images always agree. */
export function artTiers(): ArtTier[] {
  tiersHere ??= artTiersFor(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)
  return tiersHere
}

/** An aircraft artwork id, switched to the reduced copies on the wider views. */
export function artImage(id: unknown): unknown {
  const tiers = artTiers()
  if (!tiers.length) return id
  const out: unknown[] = ['step', ['zoom'], ['concat', id, tiers[0].suffix]]
  for (let i = 1; i < tiers.length; i++) out.push(tiers[i - 1].below, ['concat', id, tiers[i].suffix])
  out.push(tiers[tiers.length - 1].below, id)
  return out
}

/** The aircraft artwork layer (for the moving aircraft, or the parked ones on their own source). */
function aircraftLayer(id: string, source: string, filter?: unknown[]): LayerSpecification {
  return {
    id,
    type: 'symbol',
    source,
    ...(filter ? { filter } : {}),
    layout: {
      'icon-image': artImage(['case', ['==', ['get', 'hi'], 1], ['concat', ['get', 'icon'], '-hi'], ['get', 'icon']]),
      'icon-size': iconScale(acSize),
      'icon-rotate': ['get', 'heading'],
      'icon-rotation-alignment': 'map',
      'icon-pitch-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'symbol-sort-key': ['get', 'z'],
    },
    // The silhouettes are shaded artwork (white, and yellow when highlighted), not tinted masks.
    paint: {
      // Parked aircraft use a greyer drawing (`-pk`), so they need less fading to sit back.
      'icon-opacity': ['*', ['get', 'o'], ['case', ['==', ['get', 'hi'], 1], 1, ['match', ['get', 'state'], 0, 0.8, 1]]],
    },
  } as unknown as LayerSpecification
}

/** The airline's colour on the fin: a distance-field patch tinted per aircraft, over the white artwork. */
function liveryLayer(id: string, source: string): LayerSpecification {
  return {
    id,
    type: 'symbol',
    source,
    minzoom: 12,
    filter: ['!=', ['coalesce', ['get', 'lv'], ''], ''],
    layout: { 'icon-image': ['concat', 'fx-fin-', ['get', 'sh']], 'icon-size': iconScale(acSize), 'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': ['get', 'z'] },
    paint: { 'icon-color': ['get', 'lv'], 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, ['*', ['get', 'o'], ['match', ['get', 'state'], 0, 0.4, 0.66]]] },
  } as unknown as LayerSpecification
}

/** A callsign tag layer; `overlap` lets its tags draw over anything already placed (but still keep later layers' symbols off them). */
/**
 * How far above its aircraft a tag floats, in pixels by zoom, for a light
 * aircraft, an airliner and a heavy. The drawing grows with zoom and with the
 * class, so one distance for all put a 777's tag across its nose while a
 * Cessna's hung well clear. Each sits just off the top of its own aircraft, as
 * the reference does.
 */
export const TAG_OFFSET: [zoom: number, light: number, airliner: number, heavy: number][] = [
  [9, 11, 12, 13.5],
  [14, 14.5, 17.5, 20.5],
  [16, 20, 27, 35],
  [18, 42, 60, 80],
]
/** Drawn-size factors (`scale`) where an aircraft counts as an airliner, and as a heavy. */
export const TAG_SIZE_BANDS = [0.85, 1.2] as const
/** The highlighted aircraft is drawn a quarter bigger; its tag lifts by a little less (it may sit closer to the bigger drawing). */
const TAG_HI_LIFT = 1.18

function tagOffset(): unknown[] {
  const up = (px: number) => ['literal', [0, -Math.round(px * 10) / 10]]
  const pick = (light: number, airliner: number, heavy: number, k: number) => ['step', ['get', 'scale'], up(light * k), TAG_SIZE_BANDS[0], up(airliner * k), TAG_SIZE_BANDS[1], up(heavy * k)]
  return ['interpolate', ['linear'], ['zoom'], ...TAG_OFFSET.flatMap(([z, l, a, h]) => [z, ['case', ['==', ['get', 'hi'], 1], pick(l, a, h, TAG_HI_LIFT), pick(l, a, h, 1)]])]
}

function tagLayer(id: string, filter: unknown[], overlap: boolean, source: string = SRC.aircraft): LayerSpecification {
  return {
    id,
    type: 'symbol',
    source,
    filter,
    layout: {
      'icon-image': ['get', 'tag'],
      // Fixed anchor: collision-driven anchor changes would make the tags hop around.
      'icon-anchor': 'bottom',
      'icon-offset': tagOffset(),
      'icon-allow-overlap': overlap,
      'icon-ignore-placement': false,
      'icon-padding': 1,
      'symbol-sort-key': ['get', 'z'],
    },
    // Parked aircraft carry a faded tag, as their silhouettes are faded.
    // Tags toward the screen edges are fainter (`eo`), keeping the eye on the middle.
    paint: { 'icon-opacity': ['*', ['get', 'o'], ['coalesce', ['get', 'eo'], 1], ['case', ['==', ['get', 'hi'], 1], 1, ['match', ['get', 'state'], 0, 0.7, 1]]] },
  } as unknown as LayerSpecification
}

/** Drawn size of an aircraft feature relative to the class's base: the highlighted one is a quarter bigger. Effects drawn over or under the aircraft use it too, so they stay registered. */
const acSize: unknown[] = ['*', ['get', 'scale'], ['case', ['==', ['get', 'hi'], 1], 1.25, 1]]

/**
 * Icon size by zoom, times a per-feature factor. Below z15 the silhouettes
 * are oversized so they can be seen and tapped; from there up they double with
 * each zoom level, staying about 1.4× life size so they read clearly on the pavement.
 * (MapLibre only allows `zoom` at the top of an expression, so the per-feature
 * factor is multiplied into every stop.)
 */
const ICON_ZOOM_STOPS: [number, number][] = [
  [9, 0.5],
  [12, 0.64],
  [14, 0.9],
  [15, 1.2],
  [16, 1.8],
  [19, 14.4],
]

function iconScale(factor: unknown): unknown[] {
  return ['interpolate', ['exponential', 2], ['zoom'], ...ICON_ZOOM_STOPS.flatMap(([z, v]) => [z, ['*', v, factor]])]
}

/** The zoom part of `iconScale` worked out in JS (same stops, same base-2 exponential interpolation), for sizing against it per frame. */
export function iconZoomFactor(zoom: number): number {
  const s = ICON_ZOOM_STOPS
  if (zoom <= s[0][0]) return s[0][1]
  for (let i = 1; i < s.length; i++) {
    const [z1, v1] = s[i]
    if (zoom > z1) continue
    const [z0, v0] = s[i - 1]
    const t = (2 ** (zoom - z0) - 1) / (2 ** (z1 - z0) - 1)
    return v0 + (v1 - v0) * t
  }
  return s[s.length - 1][1]
}

const USGS_ATTR = 'Imagery: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noreferrer">USGS The National Map</a>'
const FAA_ATTR = 'Charts: <a href="https://www.faa.gov/air_traffic/flight_info/aeronav/" target="_blank" rel="noreferrer">FAA Aeronautical Information Services</a> (not for navigation)'
const RADAR_ATTR = 'Radar: NOAA NEXRAD via <a href="https://mesonet.agron.iastate.edu/" target="_blank" rel="noreferrer">Iowa Environmental Mesonet</a>'

/** Triangle drawn for procedure fixes (registered by `ProceduresLayer`, signed-distance so it takes any colour). */
export const PROC_FIX_IMAGE = 'proc-fix'

/**
 * Arrivals, departures and approaches from the FAA's CIFP, filled in by
 * `ProceduresLayer`. Thin blue-grey routes that are strongest at the
 * approach-control zooms and fade away over the airfield; finals of the
 * runways in use drawn brighter; the procedure the selected aircraft is
 * flying (or a tapped one) in the selection lilac.
 */
function procedureLayers(p: Palette): LayerSpecification[] {
  const sat = p.raster === 'satellite'
  const chart = p.raster === 'chart'
  const route = chart ? '#33406A' : sat ? '#E4EAFF' : '#8E9CC4'
  const finalOn = chart ? '#141B33' : sat ? '#FFFFFF' : '#DCE4FF'
  const hi = chart ? '#5B3DF5' : '#B9A5FF'
  const label = chart ? '#26304F' : sat ? '#F2F5FF' : '#AEB9D8'
  const altLabel = chart ? '#4A5680' : sat ? '#D5DCF0' : '#8592B6'
  const on = ['==', ['get', 'on'], 1]
  // Strongest where the procedures are what you look at (approach control), quiet over the field.
  const routeOpacity = (k: number) => ['interpolate', ['linear'], ['zoom'], 7, 0.32 * k, 9, 0.55 * k, 10.5, 0.42 * k, 11.5, 0.22 * k, 12.5, 0.12 * k, 14, 0.05 * k]
  const fixText = (minZoom: number) => [
    'step',
    ['zoom'],
    '',
    minZoom,
    ['format', ['get', 'n'], {}],
    minZoom + 0.75,
    ['format', ['get', 'n'], {}, ['case', ['has', 'a'], ['concat', '\n', ['get', 'a']], ''], { 'font-scale': 0.88, 'text-color': altLabel }],
  ]
  const fixLayer = (id: string, filter: unknown[], minzoom: number, textZoom: number): LayerSpecification =>
    ({
      id,
      type: 'symbol',
      source: SRC.procAll,
      minzoom,
      filter,
      layout: {
        'icon-image': PROC_FIX_IMAGE,
        'icon-size': ['interpolate', ['linear'], ['zoom'], minzoom, 0.5, 13, 0.7],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'text-field': fixText(textZoom),
        'text-font': FONT,
        'text-size': 10,
        'text-letter-spacing': 0.05,
        'text-anchor': 'top',
        'text-offset': [0, 0.55],
        'text-optional': true,
        'text-padding': 4,
      },
      paint: {
        'icon-color': route,
        'icon-opacity': ['interpolate', ['linear'], ['zoom'], minzoom, 0, minzoom + 0.6, 0.85, 13.5, 0.7, 15, 0.25],
        'text-color': label,
        'text-opacity': ['interpolate', ['linear'], ['zoom'], textZoom, 0, textZoom + 0.4, 0.9, 13.5, 0.75, 15, 0.3],
        'text-halo-color': p.labelHalo,
        'text-halo-width': 1.2,
      },
    }) as unknown as LayerSpecification
  return [
    { id: 'proc-star', type: 'line', source: SRC.procNet, filter: ['==', ['get', 'k'], 'star'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': route, 'line-opacity': routeOpacity(1), 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 12, 1.2, 15, 1.4] } },
    { id: 'proc-sid', type: 'line', source: SRC.procNet, filter: ['==', ['get', 'k'], 'sid'], layout: { 'line-join': 'round' }, paint: { 'line-color': route, 'line-opacity': routeOpacity(0.75), 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 12, 1.2, 15, 1.4], 'line-dasharray': [3, 2.5] } },
    {
      id: 'proc-final',
      type: 'line',
      source: SRC.procFinal,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['case', on, finalOn, route],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 7, ['case', on, 0.55, 0.3], 10, ['case', on, 0.85, 0.5], 13, ['case', on, 0.7, 0.32], 15, ['case', on, 0.35, 0.12]],
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, ['case', on, 1.3, 0.9], 12, ['case', on, 1.8, 1.2], 15, ['case', on, 2.2, 1.4]],
      },
    },
    { id: 'proc-hi-glow', type: 'line', source: SRC.procHi, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': hi, 'line-opacity': 0.28, 'line-width': 7, 'line-blur': 4 } },
    { id: 'proc-hi', type: 'line', source: SRC.procHi, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': hi, 'line-opacity': 0.95, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.6, 13, 2.4] } },
    { id: 'proc-hi-label', type: 'symbol', source: SRC.procHi, minzoom: 8.5, layout: { 'symbol-placement': 'line', 'symbol-spacing': 420, 'text-field': ['get', 'n'], 'text-font': FONT_BOLD, 'text-size': 11, 'text-letter-spacing': 0.04, 'text-offset': [0, -0.9], 'text-max-angle': 30 }, paint: { 'text-color': hi, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.4 } },
    // Invisible, finger-wide: what a tap on a procedure finds.
    { id: LAYER.procHit, type: 'line', source: SRC.procAll, filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#000000', 'line-opacity': 0, 'line-width': 18 } },
    fixLayer('proc-fix-approach', ['all', ['==', ['get', 'k'], 'fix'], ['has', 'f']], 9.5, 11),
    fixLayer('proc-fix-route', ['all', ['==', ['get', 'k'], 'fix'], ['!', ['has', 'f']]], 10.5, 11.75),
  ] as unknown as LayerSpecification[]
}

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
      [SRC.fx]: { type: 'geojson', data: empty },
      [SRC.parked]: { type: 'geojson', data: empty },
      [SRC.parkedShadows]: { type: 'geojson', data: empty },
      [SRC.trails]: { type: 'geojson', data: empty, lineMetrics: true },
      [SRC.events]: { type: 'geojson', data: empty },
      [SRC.procAll]: { type: 'geojson', data: empty },
      [SRC.procNet]: { type: 'geojson', data: empty },
      [SRC.procFinal]: { type: 'geojson', data: empty },
      [SRC.procHi]: { type: 'geojson', data: empty },
      [SRC.runwayUse]: { type: 'geojson', data: empty },
      [SRC.gateUse]: { type: 'geojson', data: empty },
      ...atmosphereSources(),
    },
    layers: layers(PALETTES[theme]),
  }
}

/** Layer properties the app toggles at runtime; a theme change must not undo them. */
const RUNTIME_VISIBILITY = new Set<string>([LAYER.buildings, LAYER.approach, LAYER.approachTick, LAYER.trails, LAYER.shadow, LAYER.parkedShadow, LAYER.radar])

/** Re-colour the live map for a theme by pushing each layer's paint and visibility. */
export function applyTheme(map: MapLibreMap, theme: MapTheme) {
  for (const layer of layers(PALETTES[theme])) {
    if (!map.getLayer(layer.id)) continue
    const paint = (layer.paint ?? {}) as Record<string, unknown>
    for (const [prop, value] of Object.entries(paint)) {
      // Animated per frame by the aircraft layer; leave those alone.
      if (ANIMATED_LAYERS.has(layer.id)) continue
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
  map.setPaintProperty('landcover-grass', 'fill-color', groundCover(PALETTES[theme], arid) as never)
}

function groundCover(p: Palette, arid: boolean): unknown[] {
  return ['interpolate', ['linear'], ['zoom'], 10.5, p.far, 12.3, arid ? p.shoulder : p.infield]
}

// ---------------------------------------------------------------------------
// Night: the darker ground and the airfield lights (driven by `lighting/LightingLayer`)
// ---------------------------------------------------------------------------

/**
 * How each ground colour changes after dark: [brightness kept, saturation kept].
 * Kept gentle on purpose: the reference look (green grass, slate terminals,
 * navy pavement) must still read at night, with the lights on top.
 */
const NIGHT_SHADE: Partial<Record<keyof Palette, [number, number]>> = {
  bg: [0.902, 0.912],
  water: [0.895, 0.948],
  land: [0.902, 0.912],
  wood: [0.86, 0.843],
  grass: [0.86, 0.843],
  infield: [0.86, 0.843],
  far: [0.881, 0.86],
  farLand: [0.902, 0.912],
  apron: [0.93, 0.93],
  taxiway: [0.93, 0.93],
  shoulder: [0.895, 0.895],
  pad: [0.895, 0.895],
  runway: [0.937, 0.93],
  runwayConcrete: [0.937, 0.93],
  paint: [0.902, 0.93],
  paintMid: [0.902, 0.93],
  paintDim: [0.902, 0.93],
  paintFaint: [0.902, 0.93],
  centreLine: [0.923, 1.0],
  taxiLine: [0.902, 0.93],
  building: [0.902, 0.912],
  buildingEdge: [0.902, 0.912],
  roadMinor: [0.912, 0.912],
  roadMajor: [0.912, 0.912],
  motorway: [0.912, 0.912],
  roadCase: [0.912, 0.912],
  rail: [0.912, 0.912],
  boundary: [0.912, 0.912],
}

function nightPalette(p: Palette): Palette {
  const out = { ...p }
  for (const [key, [dim, sat]] of Object.entries(NIGHT_SHADE) as [keyof Palette, [number, number]][]) {
    const v = out[key]
    if (typeof v === 'string') (out as Record<string, unknown>)[key] = nightShade(v, dim, sat)
  }
  return out
}

/** One paint property that changes between day and night, with both values. */
export type NightPaint = { layer: string; prop: string; day: unknown; night: unknown }

/**
 * Every base-map paint value that differs at night for a theme, worked out by
 * building the style with the day and the night palette and comparing them,
 * so layers added later darken without being listed here. Blend each pair
 * with `mixValue` and push it with `setPaintProperty`.
 */
export function nightPaint(theme: MapTheme, arid: boolean): NightPaint[] {
  const p = PALETTES[theme]
  // A paper chart has no night.
  if (p.raster === 'chart') return []
  const n = nightPalette(p)
  const day = layers(p)
  const night = layers(n)
  const out: NightPaint[] = []
  day.forEach((l, i) => {
    const hidden = (l.layout as { visibility?: string } | undefined)?.visibility === 'none' && !RUNTIME_VISIBILITY.has(l.id)
    if (hidden || ANIMATED_LAYERS.has(l.id)) return
    const a = (l.paint ?? {}) as Record<string, unknown>
    const b = (night[i].paint ?? {}) as Record<string, unknown>
    for (const prop of Object.keys(a)) if (differs(a[prop], b[prop])) out.push({ layer: l.id, prop, day: a[prop], night: b[prop] })
  })
  // The grass colour is set per airport (`applyGroundCover`), not by the theme.
  const grass = out.find((e) => e.layer === 'landcover-grass' && e.prop === 'fill-color')
  if (grass) Object.assign(grass, { day: groundCover(p, arid), night: groundCover(n, arid) })
  // Aerial photos are daylight pictures: darken and drain them instead.
  if (p.raster === 'satellite') {
    out.push({ layer: 'raster-satellite', prop: 'raster-brightness-max', day: 0.82, night: 0.42 })
    out.push({ layer: 'raster-satellite', prop: 'raster-saturation', day: -0.15, night: -0.55 })
  }
  return out
}

/** Does this theme show airfield lights at night? (Not on the paper chart.) */
export function themeHasLights(theme: MapTheme): boolean {
  return PALETTES[theme].raster !== 'chart'
}

export const LIGHT_SRC = { runway: 'lights-runway', taxi: 'lights-taxi', apron: 'lights-apron' } as const

export const LIGHT_LAYER = {
  apronWash: 'lights-apron-wash',
  apron: 'lights-apron-glow',
  taxiBloom: 'lights-taxi-bloom',
  taxiCore: 'lights-taxi-core',
  runwayBloom: 'lights-runway-bloom',
  runwayCore: 'lights-runway-core',
} as const

/**
 * Taxiway lights and floodlights fade in over 12.8–13.6 and are absent below.
 * Runway lights start a little further out, so the overview of the whole
 * airfield already shows its runways drawn in light.
 */
export const LIGHT_MIN_ZOOM = 12.8
const RUNWAY_LIGHT_MIN_ZOOM = 11.8

/** Each light layer's zoom fade (none at the first zoom, full at the second) and opacity at full night. */
const LIGHT_FADE: Record<string, [number, number, number]> = {
  [LIGHT_LAYER.apronWash]: [LIGHT_MIN_ZOOM, 13.6, 0.035],
  [LIGHT_LAYER.apron]: [LIGHT_MIN_ZOOM, 13.6, 0.15],
  // Taxiway lights outline every taxiway, so they come up more slowly than the rest, keeping the wide view calm.
  // All of them sit well below full strength: thousands of points at once glare long before any one of them does.
  [LIGHT_LAYER.taxiBloom]: [LIGHT_MIN_ZOOM, 14.4, 0.24],
  [LIGHT_LAYER.taxiCore]: [LIGHT_MIN_ZOOM, 14.4, 0.68],
  [LIGHT_LAYER.runwayBloom]: [RUNWAY_LIGHT_MIN_ZOOM, 12.8, 0.26],
  [LIGHT_LAYER.runwayCore]: [RUNWAY_LIGHT_MIN_ZOOM, 12.8, 0.8],
}

/** The opacity property of a light layer and its value at night factor `t` (0..1). */
export function lightOpacity(layer: string, t: number): { prop: string; value: unknown[] } {
  const [z0, z1, peak] = LIGHT_FADE[layer] ?? [LIGHT_MIN_ZOOM, 13.6, 1]
  return { prop: layer === LIGHT_LAYER.apronWash ? 'fill-opacity' : 'circle-opacity', value: ['interpolate', ['linear'], ['zoom'], z0, 0, z1, peak * t] }
}

/** Screen size of a light by zoom (times its own size factor `s`): point sources, growing gently. */
function lightRadius(stops: [number, number][]): unknown[] {
  return ['interpolate', ['exponential', 1.6], ['zoom'], ...stops.flatMap(([z, r]) => [z, ['*', r, ['coalesce', ['get', 's'], 1]]])]
}

const CORE_RADIUS: [number, number][] = [
  [12, 0.7],
  [13, 0.85],
  [15, 1.25],
  [17, 2.1],
  [19, 3.8],
]
const BLOOM_RADIUS: [number, number][] = [
  [12, 1.8],
  [13, 2.3],
  [15, 3.6],
  [17, 6.4],
  [19, 11.5],
]

/**
 * The light layers, each with the layer it goes under. They start hidden and
 * transparent; `LightingLayer` adds them at runtime and fades them in. Each
 * light is a soft, wide disc under a small, whiter core, which reads as a
 * gentle bloom without any post-processing.
 */
export function lightingLayers(): { layer: LayerSpecification; before: string }[] {
  const hidden = { visibility: 'none' as const }
  const bloom = (id: string, source: string) =>
    ({ id, type: 'circle', source, minzoom: LIGHT_FADE[id][0], layout: hidden, paint: { 'circle-color': ['get', 'c'], 'circle-radius': lightRadius(BLOOM_RADIUS) as never, 'circle-blur': 1, 'circle-opacity': 0, 'circle-pitch-alignment': 'map' } }) as LayerSpecification
  const core = (id: string, source: string) =>
    ({ id, type: 'circle', source, minzoom: LIGHT_FADE[id][0], layout: hidden, paint: { 'circle-color': ['get', 'k'], 'circle-radius': lightRadius(CORE_RADIUS) as never, 'circle-blur': 0.45, 'circle-opacity': 0, 'circle-pitch-alignment': 'map' } }) as LayerSpecification
  return [
    // A faint warm cast over every apron, the spill of the floodlights, under the apron's own paint and buildings.
    {
      before: LAYER.buildings,
      layer: {
        id: LIGHT_LAYER.apronWash,
        type: 'fill',
        source: 'omt',
        'source-layer': 'aeroway',
        minzoom: LIGHT_MIN_ZOOM,
        filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'class'], 'apron']],
        layout: hidden,
        paint: { 'fill-color': '#FFD6A0', 'fill-opacity': 0 },
      } as LayerSpecification,
    },
    // Floodlight pools by the gates, over the buildings (they light the terminal faces) and under the roads.
    {
      before: 'road-minor',
      layer: {
        id: LIGHT_LAYER.apron,
        type: 'circle',
        source: LIGHT_SRC.apron,
        minzoom: LIGHT_MIN_ZOOM,
        layout: hidden,
        // `r` is the pool's radius in pixels at zoom 0; it doubles with every zoom level, like the ground.
        paint: { 'circle-color': '#FFB45E', 'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 0, ['get', 'r'], 22, ['*', ['get', 'r'], 2 ** 22]], 'circle-blur': 1, 'circle-opacity': 0, 'circle-pitch-alignment': 'map' },
      } as LayerSpecification,
    },
    // Taxiway and runway lights over all the paint, under the labels and aircraft.
    { before: 'water-name', layer: bloom(LIGHT_LAYER.taxiBloom, LIGHT_SRC.taxi) },
    { before: 'water-name', layer: core(LIGHT_LAYER.taxiCore, LIGHT_SRC.taxi) },
    { before: 'water-name', layer: bloom(LIGHT_LAYER.runwayBloom, LIGHT_SRC.runway) },
    { before: 'water-name', layer: core(LIGHT_LAYER.runwayCore, LIGHT_SRC.runway) },
  ]
}

/** The violet under a selected aircraft: the selected tag's family, lifted to read on navy. */
const SELECT_HALO = '#7C5CFC'
/** Selected, and not the one on the radio (which wears the speaker's colour instead). */
const SELECTED_ONLY = ['all', ['==', ['get', 'hi'], 1], ['!=', ['get', 'tx'], 1]]

/** Ring layers of the talking-aircraft effect. */
export const TALK_WAVE_LAYERS = ['ac-talk-wave-1', 'ac-talk-wave-2', 'ac-talk-wave-3'] as const

/** Layers `AircraftLayer` repaints every frame; the day/night blend leaves them alone. */
const ANIMATED_LAYERS = new Set<string>([LAYER.halo, LAYER.haloOuter, LAYER.talkGlow, ...TALK_WAVE_LAYERS])

/**
 * The aircraft on the radio (`tx`): a fully blurred disc for the steady glow,
 * and rings that are all stroke, feathered on both edges by `circle-blur`
 * (see `talkWaves.ts`). `AircraftLayer` animates radius, width and opacity as
 * plain paint numbers and sets the speaker's colour; they start invisible.
 */
function talkLayers(): LayerSpecification[] {
  const tx = ['==', ['get', 'tx'], 1]
  return [
    { id: LAYER.talkGlow, type: 'circle', source: SRC.aircraft, filter: tx, paint: { 'circle-radius': 40, 'circle-color': ATC_COLORS.base, 'circle-opacity': 0, 'circle-blur': 1, 'circle-pitch-alignment': 'map' } },
    ...TALK_WAVE_LAYERS.map((id) => ({ id, type: 'circle', source: SRC.aircraft, filter: tx, paint: { 'circle-radius': 20, 'circle-color': 'rgba(0,0,0,0)', 'circle-opacity': 0, 'circle-blur': WAVE_SOFTNESS, 'circle-stroke-color': ATC_COLORS.base, 'circle-stroke-width': 8, 'circle-stroke-opacity': 0, 'circle-pitch-alignment': 'map' } })),
  ] as unknown as LayerSpecification[]
}

// ---------------------------------------------------------------------------
// Taxi route preview (drawn by `src/live/taxi/TaxiRouteLayer.tsx`)
// ---------------------------------------------------------------------------
// Added at runtime under the aircraft, so `applyTheme` never touches them and
// they read the same on every theme: a purple glow and line in the card's
// colour, marching yellow dashes like the painted taxi lines, and yellow
// hold-short bars with chips.

export const TAXI_SRC = { line: 'taxi-route', marks: 'taxi-route-marks' } as const
export const TAXI_LAYER = {
  glow: 'taxi-route-glow',
  casing: 'taxi-route-casing',
  line: 'taxi-route-line',
  dash: 'taxi-route-dash',
  hit: 'taxi-route-hit',
  holdBand: 'taxi-route-hold-band',
  holdBar: 'taxi-route-hold-bar',
  chip: 'taxi-route-chip',
} as const
/** Chip images the layer component draws: purple for the runway, yellow for hold-short points. */
export const TAXI_CHIP = { runway: 'taxi-chip-runway', hold: 'taxi-chip-hold' } as const

/** Each feature carries `o` (0–1, its route's fade) and, on the line, `beyond` (1 past the first hold). */
export function taxiRouteLayers(): LayerSpecification[] {
  const o = ['coalesce', ['get', 'o'], 1]
  const dim = ['case', ['==', ['get', 'beyond'], 1], 0.45, 1]
  const w = (a: number, b: number, c: number) => ['interpolate', ['exponential', 1.6], ['zoom'], 12, a, 15, b, 18, c]
  return [
    { id: TAXI_LAYER.glow, type: 'line', source: TAXI_SRC.line, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#7C5CFC', 'line-opacity': ['*', 0.7, o, dim], 'line-width': w(10, 20, 48), 'line-blur': ['interpolate', ['linear'], ['zoom'], 12, 5, 16, 10] } },
    { id: TAXI_LAYER.casing, type: 'line', source: TAXI_SRC.line, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#170C4F', 'line-opacity': ['*', 0.9, o], 'line-width': w(3.6, 7, 16) } },
    { id: TAXI_LAYER.line, type: 'line', source: TAXI_SRC.line, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#8B6CFF', 'line-opacity': ['*', o, dim], 'line-width': w(2.4, 4.6, 11) } },
    { id: TAXI_LAYER.dash, type: 'line', source: TAXI_SRC.line, layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': '#FFD23F', 'line-opacity': ['*', 0.95, o, dim], 'line-width': w(1, 1.8, 4.2), 'line-dasharray': [0, 4, 3] } },
    { id: TAXI_LAYER.holdBand, type: 'line', source: TAXI_SRC.marks, filter: ['==', ['get', 'kind'], 'hold'], layout: { 'line-cap': 'butt' }, paint: { 'line-color': '#15140F', 'line-opacity': ['*', 0.9, o], 'line-width': w(4, 7, 16) } },
    { id: TAXI_LAYER.holdBar, type: 'line', source: TAXI_SRC.marks, filter: ['==', ['get', 'kind'], 'hold'], layout: { 'line-cap': 'butt' }, paint: { 'line-color': '#FFD23F', 'line-opacity': o, 'line-width': w(1.6, 2.6, 6) } },
    // Fat and invisible: the route is easy to tap with a finger.
    { id: TAXI_LAYER.hit, type: 'line', source: TAXI_SRC.line, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#000000', 'line-opacity': 0.001, 'line-width': 28 } },
    {
      id: TAXI_LAYER.chip,
      type: 'symbol',
      source: TAXI_SRC.marks,
      filter: ['==', ['get', 'kind'], 'chip'],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': FONT_BOLD,
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 16, 12.5],
        'text-letter-spacing': 0.02,
        'icon-image': ['case', ['==', ['get', 'tone'], 'runway'], TAXI_CHIP.runway, TAXI_CHIP.hold],
        'icon-text-fit': 'both',
        'icon-text-fit-padding': [3, 7, 3, 7],
        // Above the stop, clear of the bar and the line.
        'text-anchor': 'bottom',
        'text-offset': ['literal', [0, -0.9]],
        'icon-allow-overlap': true,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': ['case', ['==', ['get', 'tone'], 'runway'], '#FFFFFF', '#1C1503'], 'text-opacity': o, 'icon-opacity': o },
    },
  ] as LayerSpecification[]
}

// ---------------------------------------------------------------------------
// Atmosphere and surface detail: water sheen, pavement grain, tyre marks,
// hairline edges, roof highlights, jet bridges, stand lead-in lines and painted
// gate numbers. Each layer is slotted in under a named neighbour, so the rest
// of the style never has to list them; colours come from the palette, so
// they darken at night with everything else. Animated and screen-space
// effects (weather, wind, vignette) live in `atmosphere/AtmosphereLayer`.
// ---------------------------------------------------------------------------

export const ATMO_SRC = { tyres: 'atmo-tyres', stands: 'atmo-stands' } as const

export const ATMO_LAYER = {
  sheen: 'atmo-water-sheen',
  grassEdge: 'atmo-grass-edge',
  apronRim: 'atmo-apron-rim',
  taxiwayRim: 'atmo-taxiway-rim',
  runwayRim: 'atmo-runway-rim',
  apronGrain: 'atmo-apron-grain',
  runwayGrain: 'atmo-runway-grain',
  tyres: 'atmo-tyres',
  buildingShade: 'atmo-building-shade',
  leadIn: 'atmo-lead-in',
  stopBar: 'atmo-stop-bar',
  roofEdge: 'atmo-roof-edge',
  jetBridge: 'atmo-jet-bridge',
  jetBridgeWalk: 'atmo-jet-bridge-walk',
  gatePaint: 'atmo-gate-paint',
} as const

/** `a` moved `t` of the way toward `b` (both CSS colours), for tones derived from the palette. */
function tone(a: string, b: string, t: number): string {
  const x = parseColor(a)
  const y = parseColor(b)
  return x && y ? formatColor(mixColor(x, y, t)) : a
}

/** Roofs up close: a touch lighter and cooler than the building colour, as sunlit roofs read from above. */
function roofTone(p: Palette): string {
  return tone(p.building, '#C9D2EA', 0.09)
}

/**
 * Runway designators set like an airfield sign: bold digits, the L/C/R a
 * lighter weight and tone.
 */
function runwaySignText(chart: boolean): unknown[] {
  const id = ['get', 'ident']
  const n = ['length', id]
  const last = ['slice', id, ['-', n, 1]]
  const letter = chart ? 'rgba(27,37,64,0.75)' : 'rgba(196,204,224,0.8)'
  return [
    'case',
    ['all', ['>', n, 1], ['in', last, 'LCR']],
    ['format', ['slice', id, 0, ['-', n, 1]], { 'text-font': ['literal', FONT_BOLD] }, last, { 'text-font': ['literal', FONT], 'font-scale': 0.94, 'text-color': letter }],
    ['format', id, { 'text-font': ['literal', FONT_BOLD] }],
  ]
}

function atmosphereSources(): Record<string, { type: 'geojson'; data: typeof empty }> {
  return { [ATMO_SRC.tyres]: { type: 'geojson', data: empty }, [ATMO_SRC.stands]: { type: 'geojson', data: empty } }
}

const fadeIn = (z0: number, z1: number, to: unknown = 1): unknown[] => ['interpolate', ['linear'], ['zoom'], z0, 0, z1, to]

/** The detail layers, each with the layer it goes under. */
function atmosphereLayers(p: Palette): [string, unknown][] {
  const base = !p.hideBase
  const paint = !p.hidePaint
  const isTaxiway = ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'taxiway']]
  const rim = tone(p.shoulder, '#FFFFFF', 0.14)
  const bridge = tone(p.building, '#FFFFFF', 0.12)
  return [
    // A slow sheen drifting over open water (the pattern image animates itself).
    ['landuse-residential', { id: ATMO_LAYER.sheen, type: 'fill', source: 'omt', 'source-layer': 'water', layout: vis(base), paint: { 'fill-pattern': SHEEN_IMAGE, 'fill-opacity': fadeIn(9, 11) } }],
    // Hairlines: the outer edge of every shoulder band and of the grass, a shade lighter, for crisp islands on retina screens.
    ['waterway', { id: ATMO_LAYER.grassEdge, type: 'line', source: 'omt', 'source-layer': 'landcover', minzoom: 14, filter: ['in', ['get', 'class'], ['literal', ['grass', 'farmland', 'wetland']]], layout: vis(base), paint: { 'line-color': rim, 'line-width': 0.5, 'line-opacity': fadeIn(14, 15, 0.3) } }],
    // Under the shoulders, so only the outermost rim shows where bands meet.
    ['aero-apron-shoulder', { id: ATMO_LAYER.apronRim, type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 14, filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'class'], 'apron']], layout: { ...vis(base), 'line-join': 'round' }, paint: { 'line-color': rim, 'line-width': 0.5, 'line-gap-width': metres(16), 'line-opacity': fadeIn(14, 15, 0.8) } }],
    ['aero-apron-shoulder', { id: ATMO_LAYER.taxiwayRim, type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 14, filter: isTaxiway, layout: { ...vis(base), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': rim, 'line-width': 0.5, 'line-gap-width': metres(66), 'line-opacity': fadeIn(14, 15, 0.8) } }],
    ['aero-apron-shoulder', { id: ATMO_LAYER.runwayRim, type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 14, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'runway']], layout: { ...vis(base), 'line-cap': 'butt' }, paint: { 'line-color': rim, 'line-width': 0.5, 'line-gap-width': metres(61), 'line-opacity': fadeIn(14, 15, 0.8) } }],
    // Concrete and asphalt grain, only up close.
    ['aero-taxiway', { id: ATMO_LAYER.apronGrain, type: 'fill', source: 'omt', 'source-layer': 'aeroway', minzoom: 15, filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'class'], 'apron']], layout: vis(base), paint: { 'fill-pattern': NOISE_IMAGE, 'fill-opacity': fadeIn(15, 16.5) } }],
    ['apt-hold-band', { id: ATMO_LAYER.runwayGrain, type: 'fill', source: SRC.surface, minzoom: 15, layout: vis(paint), paint: { 'fill-pattern': NOISE_IMAGE, 'fill-opacity': fadeIn(15, 16.5) } }],
    // Rubber laid down in the touchdown zones: soft dark streaks along the main-gear tracks.
    [
      'apt-hold-band',
      {
        id: ATMO_LAYER.tyres,
        type: 'line',
        source: ATMO_SRC.tyres,
        minzoom: 13.6,
        layout: { ...vis(paint), 'line-cap': 'round' },
        paint: {
          'line-color': tone(p.runway, '#000000', 0.6),
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 13.6, 0, 15, ['get', 'o']],
          'line-width': metres(ownWidth(1.5)),
          'line-blur': ['interpolate', ['linear'], ['zoom'], 14, ['*', 0.25, ['get', 'w']], 16, ['*', 1, ['get', 'w']], 18, ['*', 4, ['get', 'w']]],
        },
      },
    ],
    // Buildings cast a small soft shadow down and to the right, so they sit up off the apron.
    [LAYER.buildings, { id: ATMO_LAYER.buildingShade, type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14, layout: vis(base), paint: { 'fill-color': tone(p.bg, '#000000', 0.7), 'fill-opacity': fadeIn(14, 15.5, 0.42), 'fill-translate': ['interpolate', ['linear'], ['zoom'], 14, ['literal', [0.8, 1.2]], 17, ['literal', [2.5, 3.5]]], 'fill-translate-anchor': 'viewport', 'fill-antialias': false } }],
    // Stand lead-in lines and stop bars, painted on the apron under the jet bridges.
    [LAYER.buildings, { id: ATMO_LAYER.leadIn, type: 'line', source: ATMO_SRC.stands, minzoom: 15.6, filter: ['==', ['get', 'kind'], 'lead'], layout: { ...vis(paint), 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': p.taxiLine, 'line-opacity': fadeIn(15.6, 16.4, 0.85), 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 15.6, 0.7, 17, 1.2, 19, 4.2] } }],
    [LAYER.buildings, { id: ATMO_LAYER.stopBar, type: 'line', source: ATMO_SRC.stands, minzoom: 16, filter: ['==', ['get', 'kind'], 'stop'], layout: { ...vis(paint), 'line-cap': 'butt' }, paint: { 'line-color': p.taxiLine, 'line-opacity': fadeIn(16, 16.8, 0.85), 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 16, 1, 17, 1.6, 19, 6] } }],
    // A lighter rim along every roof edge, and the jet bridges (picked out of the bridge outlines by size) as their own pale shapes.
    ['road-minor', { id: ATMO_LAYER.roofEdge, type: 'line', source: 'omt', 'source-layer': 'building', minzoom: 14.5, layout: { ...vis(base), 'line-join': 'round' }, paint: { 'line-color': tone(p.building, '#FFFFFF', 0.2), 'line-width': 0.75, 'line-opacity': fadeIn(14.5, 16, 0.75) } }],
    ['road-minor', { id: ATMO_LAYER.jetBridge, type: 'fill', source: ATMO_SRC.stands, minzoom: 15.2, filter: ['==', ['get', 'kind'], 'bridge'], layout: vis(base), paint: { 'fill-color': bridge, 'fill-outline-color': tone(p.building, '#FFFFFF', 0.26), 'fill-opacity': fadeIn(15.2, 15.8) } }],
    ['road-minor', { id: ATMO_LAYER.jetBridgeWalk, type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 15, filter: ['all', ['==', ['get', 'class'], 'path'], ['==', ['get', 'brunnel'], 'bridge']], layout: { ...vis(base), 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': bridge, 'line-width': metres(3.4, 1), 'line-opacity': fadeIn(15, 16) } }],
    // Gate numbers painted on the stand, read along the lead-in line, once the stands are big enough.
    [
      'aero-gate-dot',
      {
        id: ATMO_LAYER.gatePaint,
        type: 'symbol',
        source: ATMO_SRC.stands,
        minzoom: 16.6,
        filter: ['==', ['get', 'kind'], 'num'],
        layout: { ...vis(paint), 'text-field': ['get', 'ref'], 'text-font': FONT_BOLD, 'text-size': ['interpolate', ['exponential', 2], ['zoom'], 16.6, 8, 18, 16, 19, 24], 'text-rotate': ['get', 'rot'], 'text-rotation-alignment': 'map', 'text-pitch-alignment': 'map', 'text-letter-spacing': 0.06, 'text-padding': 1 },
        paint: { 'text-color': p.taxiLine, 'text-opacity': fadeIn(16.6, 17.2, 0.85) },
      },
    ],
  ]
}

/** The style's layers with the detail layers slotted in under their neighbours. */
function withAtmosphere(list: LayerSpecification[], p: Palette): LayerSpecification[] {
  const out = [...list]
  for (const [before, layer] of atmosphereLayers(p)) {
    const i = out.findIndex((l) => l.id === before)
    out.splice(i < 0 ? out.length : i, 0, layer as LayerSpecification)
  }
  return out
}

// ---------------------------------------------------------------------------
// Instruction badges: the latest assignment a controller gave an aircraft
// ("↑5,000", "HDG 270", "→124.75"), as a small chip under it. The chips are
// bitmaps drawn in the UI font by `InstructionBadgeLayer`; `img` is the
// image id, `o` the fade.
// ---------------------------------------------------------------------------

export const INSTR_SRC = 'instruction-badges'
export const INSTR_LAYER = 'instruction-badge'

export function instructionBadgeLayers(): LayerSpecification[] {
  return [
    {
      id: INSTR_LAYER,
      type: 'symbol',
      source: INSTR_SRC,
      layout: {
        'icon-image': ['get', 'img'],
        // Under the aircraft, mirroring the callsign tag above it.
        'icon-anchor': 'top',
        'icon-offset': ['interpolate', ['linear'], ['zoom'], 9, ['literal', [0, 9]], 14, ['literal', [0, 13]], 16, ['literal', [0, 20]], 18, ['literal', [0, 40]]],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': ['coalesce', ['get', 'o'], 1] },
    },
  ] as LayerSpecification[]
}
