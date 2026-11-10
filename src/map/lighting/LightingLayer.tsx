/**
 * Day and night on the map. Follows the sun at the airport (or the replay's
 * clock in playback), or holds day or night as the user chose, and fades
 * between them over about two seconds: the ground darkens and drains of
 * colour, and the airfield lights come up.
 *
 * Runway lights are generated once per airport. Taxiway lights and apron
 * floodlights come from the loaded map tiles after each camera move (the
 * way the hold bars do), only while it is dark and only zoomed in.
 */
import type { Feature, FeatureCollection, Point } from 'geojson'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getAirport } from '../../api/airports'
import { usePlayhead } from '../../playback/playheadStore'
import { useSettings } from '../../settings/settingsStore'
import { useReducedMotion } from '../../ui/motion'
import type { LngLat } from '../geo'
import { effectiveTheme, LIGHT_LAYER, LIGHT_MIN_ZOOM, LIGHT_SRC, lightingLayers, lightOpacity, nightPaint, themeHasLights, type NightPaint } from '../mapStyle'
import { addApronGlows, addTaxiwayLights, LightSet, runwayFrames, runwayLights, type GlowFeature, type LightFeature } from './airfieldLights'
import { mixValue } from './color'
import { fadeDone, fadeValue, startFade, type Fade } from './fade'
import { nightFactor, sunElevation } from './sun'

/** Most taxiway lights and apron glows kept for one airport. */
const MAX_TAXI_LIGHTS = 9000
const MAX_GLOWS = 700
/** How often the sun is looked at again in live mode. */
const SUN_CHECK_MS = 20_000

const fc = (features: Feature<Point>[]): FeatureCollection<Point> => ({ type: 'FeatureCollection', features })

function setData(map: MapLibreMap, id: string, features: Feature<Point>[]) {
  ;(map.getSource(id) as GeoJSONSource | undefined)?.setData(fc(features))
}

/** The moment the map should show: the replay's clock when it has one, otherwise now. */
function sceneTime(): number {
  const s = usePlayhead.getState()
  return s.mode === 'playback' && s.clip?.startedAt != null ? s.clip.startedAt + s.tMs : Date.now()
}

/** Night factor (0 day … 1 night) from the sun at `center`, kept current while `enabled`. */
function useSunNight(center: LngLat, enabled: boolean): number {
  const read = () => Math.round(nightFactor(sunElevation(sceneTime(), center[1], center[0])) * 1000) / 1000
  const [value, setValue] = useState(read)
  useEffect(() => {
    if (!enabled) return
    const update = () => setValue(Math.round(nightFactor(sunElevation(sceneTime(), center[1], center[0])) * 1000) / 1000)
    update()
    const id = window.setInterval(update, SUN_CHECK_MS)
    // In playback the replay's own clock decides; scrubbing across dusk fades the map.
    const unsubscribe = usePlayhead.subscribe((s, prev) => {
      if (s.mode !== prev.mode || s.clip !== prev.clip || s.tMs !== prev.tMs) update()
    })
    return () => {
      window.clearInterval(id)
      unsubscribe()
    }
  }, [center, enabled])
  return value
}

/** Pushes a night factor onto the map: blended ground paint, light opacity and visibility. */
class NightPainter {
  plan: NightPaint[] = []
  lights = true
  level = 0
  private applied = -1
  private fade: Fade | null = null
  private raf = 0
  private fresh = true
  private readonly map: MapLibreMap
  constructor(map: MapLibreMap) {
    this.map = map
  }

  setPlan(plan: NightPaint[], lights: boolean) {
    this.plan = plan.filter((e) => this.map.getLayer(e.layer))
    this.lights = lights
    this.paint(this.level, true)
  }

  /** Move to `target`, fading unless `instant`. The first move always jumps: there is nothing on screen to fade from. */
  go(target: number, instant: boolean) {
    cancelAnimationFrame(this.raf)
    const first = this.fresh
    this.fresh = false
    if (instant || first) {
      this.fade = null
      this.paint(target)
      return
    }
    this.fade = startFade(this.level, target, performance.now())
    const step = () => {
      const f = this.fade
      if (!f) return
      const now = performance.now()
      this.paint(fadeValue(f, now))
      if (!fadeDone(f, now)) this.raf = requestAnimationFrame(step)
    }
    step()
  }

  stop() {
    cancelAnimationFrame(this.raf)
    this.fade = null
  }

  private paint(t: number, force = false) {
    this.level = t
    if (!force && t === this.applied) return
    this.applied = t
    const map = this.map
    for (const e of this.plan) map.setPaintProperty(e.layer, e.prop as never, mixValue(e.day, e.night, t) as never)
    // Airfield lights switch on at sunset, so they reach full strength before the sky is fully dark.
    const lit = this.lights ? Math.min(1, t * 1.6) : 0
    for (const id of Object.values(LIGHT_LAYER)) {
      if (!map.getLayer(id)) continue
      const { prop, value } = lightOpacity(id, lit)
      map.setPaintProperty(id, prop as never, value as never)
      map.setLayoutProperty(id, 'visibility', lit > 0.001 ? 'visible' : 'none')
    }
  }
}

export function LightingLayer({ map, airportIcao }: { map: MapLibreMap | null; airportIcao: string }) {
  const lighting = useSettings((s) => s.lighting)
  const mapTheme = useSettings((s) => s.mapTheme)
  const reduceMotion = useReducedMotion()
  const airport = useMemo(() => getAirport(airportIcao), [airportIcao])
  const theme = effectiveTheme(mapTheme, airport.group === 'US')
  const sun = useSunNight(airport.center, lighting === 'auto')
  const target = lighting === 'night' ? 1 : lighting === 'day' ? 0 : sun

  const painter = useRef<NightPainter | null>(null)
  // Read by the taxiway refresh, which runs outside React.
  const dark = useRef(target > 0)
  // Asks the taxiway refresh to look at the current view.
  const kick = useRef<() => void>(() => {})

  // The light sources and layers, once per map.
  useEffect(() => {
    if (!map) return
    for (const id of Object.values(LIGHT_SRC)) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: fc([]) })
    for (const { layer, before } of lightingLayers()) if (!map.getLayer(layer.id)) map.addLayer(layer, map.getLayer(before) ? before : undefined)
    const p = new NightPainter(map)
    painter.current = p
    return () => {
      p.stop()
      painter.current = null
      for (const { layer } of lightingLayers()) if (map.getLayer(layer.id)) map.removeLayer(layer.id)
      for (const id of Object.values(LIGHT_SRC)) if (map.getSource(id)) map.removeSource(id)
    }
  }, [map])

  // Which paint changes at night depends on the theme and the airport's ground.
  // `MapView` repaints the day theme in its own effect, which React runs after
  // this one, so the night blend is put back on top a moment later.
  useEffect(() => {
    if (!map) return
    const plan = nightPaint(theme, airport.arid)
    let live = true
    queueMicrotask(() => live && painter.current?.setPlan(plan, themeHasLights(theme)))
    return () => {
      live = false
    }
  }, [map, theme, airport.arid])

  // Fade to the wanted level (the painter's first move is instant: the map opens already dark).
  useEffect(() => {
    if (!map) return
    queueMicrotask(() => painter.current?.go(target, reduceMotion))
    // Lights coming on: work out the taxiway lights for the current view.
    const wasDark = dark.current
    dark.current = target > 0
    if (dark.current && !wasDark) kick.current()
  }, [map, target, reduceMotion])

  // Runway lights: generated once per airport.
  useEffect(() => {
    if (!map) return
    setData(map, LIGHT_SRC.runway, runwayLights(airportIcao))
  }, [map, airportIcao])

  // Taxiway lights and apron glows, from the tiles in view, after each camera move.
  const taxi = useRef<{ airport: string; lights: LightSet<LightFeature>; glows: LightSet<GlowFeature> } | null>(null)
  useEffect(() => {
    if (!map) return
    const origin = airport.center
    if (taxi.current?.airport !== airportIcao) taxi.current = { airport: airportIcao, lights: new LightSet(origin, MAX_TAXI_LIGHTS), glows: new LightSet(origin, MAX_GLOWS) }
    // The sources may be new (the map's layers were set up again): give them what is already known.
    setData(map, LIGHT_SRC.taxi, taxi.current.lights.features)
    setData(map, LIGHT_SRC.apron, taxi.current.glows.features)
    const runways = runwayFrames(airportIcao)
    let timer = 0
    let tries = 0
    const refresh = () => {
      window.clearTimeout(timer)
      const acc = taxi.current
      if (!acc || !dark.current || map.getZoom() < LIGHT_MIN_ZOOM) return
      if (acc.lights.full && acc.glows.full) return
      // Tiles for the new view may still be arriving; look again shortly.
      if (!map.isSourceLoaded('omt')) {
        if (tries++ < 12) timer = window.setTimeout(refresh, 400)
        return
      }
      tries = 0
      const features = map.querySourceFeatures('omt', { sourceLayer: 'aeroway', filter: ['in', ['get', 'class'], ['literal', ['taxiway', 'apron', 'gate']]] })
      const paths: LngLat[][] = []
      const aprons: LngLat[][][] = []
      const gates: LngLat[] = []
      for (const f of features) {
        const g = f.geometry
        const cls = f.properties?.class
        if (cls === 'taxiway' && g.type === 'LineString') paths.push(g.coordinates as LngLat[])
        else if (cls === 'taxiway' && g.type === 'MultiLineString') paths.push(...(g.coordinates as LngLat[][]))
        else if (cls === 'apron' && g.type === 'Polygon') aprons.push(g.coordinates as LngLat[][])
        else if (cls === 'apron' && g.type === 'MultiPolygon') aprons.push(...(g.coordinates as LngLat[][][]))
        else if (cls === 'gate' && g.type === 'Point') gates.push(g.coordinates as LngLat)
      }
      const before = acc.lights.features.length + acc.glows.features.length
      addTaxiwayLights(acc.lights, origin, paths, runways, aprons)
      addApronGlows(acc.glows, origin, gates)
      if (acc.lights.features.length + acc.glows.features.length === before) return
      setData(map, LIGHT_SRC.taxi, acc.lights.features)
      setData(map, LIGHT_SRC.apron, acc.glows.features)
    }
    // The map never goes "idle" while aircraft animate, so settle on the end of each move instead.
    const schedule = () => {
      tries = 0
      window.clearTimeout(timer)
      timer = window.setTimeout(refresh, 350)
    }
    map.on('moveend', schedule)
    kick.current = schedule
    schedule()
    return () => {
      window.clearTimeout(timer)
      map.off('moveend', schedule)
      kick.current = () => {}
    }
  }, [map, airportIcao, airport.center])

  return null
}
