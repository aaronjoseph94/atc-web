/**
 * Weather, wind and depth over the map, plus the generated surface detail.
 *
 * Over the map (under the app's chrome, never catching taps): cloud shadows,
 * rain, snow, wind lines and windsocks on two canvases (`overlay.ts`), and,
 * as plain CSS gradients that cost nothing per frame, the haze of low
 * visibility, the cool cast of rain and a soft vignette with a lighter top.
 *
 * In the map itself: the touchdown-zone tyre marks, the stand lead-in lines
 * and painted gate numbers (worked out from the tiles after each camera move,
 * the way the hold bars are), and the pattern images the water sheen and
 * pavement grain are drawn with. Their layers are in `mapStyle.ts`.
 */
import type { Feature, FeatureCollection } from 'geojson'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getAirport } from '../../api/airports'
import { usePlayhead } from '../../playback/playheadStore'
import { useSettings } from '../../settings/settingsStore'
import { useReducedMotion } from '../../ui/motion'
import { useWeather } from '../../station/StationBar'
import { runwayEnds, standMarkings, tyreMarks } from '../airportDiagram'
import type { LngLat } from '../geo'
import { nightFactor, sunElevation } from '../lighting/sun'
import { ATMO_SRC, effectiveTheme } from '../mapStyle'
import { AtmosphereOverlay, type OverlayState } from './overlay'
import { isJetBridge, standPose } from './stands'
import { addPavementGrain, addWaterSheen, WaterSheen } from './textures'
import { screenWashes } from './washes'
import { weatherFx } from './weatherFx'
import { windsockSites } from './windsocks'

/** Stand markings are worked out from this zoom (they show from 15.6). */
const STAND_MIN_ZOOM = 15.2
const MAX_STANDS = 1500

function setData(map: MapLibreMap, id: string, data: FeatureCollection) {
  ;(map.getSource(id) as GeoJSONSource | undefined)?.setData(data)
}

/** How dark it is at the airport (0 day … 1 night), following the lighting setting; checked every half minute. */
function readNight(lighting: string, center: LngLat): number {
  if (lighting !== 'auto') return lighting === 'night' ? 1 : 0
  const s = usePlayhead.getState()
  const t = s.mode === 'playback' && s.clip?.startedAt != null ? s.clip.startedAt + s.tMs : Date.now()
  return Math.round(nightFactor(sunElevation(t, center[1], center[0])) * 20) / 20
}

function useNight(center: LngLat): number {
  const lighting = useSettings((s) => s.lighting)
  const [night, setNight] = useState(() => readNight(lighting, center))
  useEffect(() => {
    const update = () => setNight(readNight(lighting, center))
    update()
    if (lighting !== 'auto') return
    const id = window.setInterval(update, 30_000)
    return () => window.clearInterval(id)
  }, [lighting, center])
  return night
}

export function AtmosphereLayer({ map, airportIcao }: { map: MapLibreMap | null; airportIcao: string }) {
  const reduceMotion = useReducedMotion()
  const streamlines = useSettings((s) => s.windStreamlines)
  const mapTheme = useSettings((s) => s.mapTheme)
  const airport = useMemo(() => getAirport(airportIcao), [airportIcao])
  const theme = effectiveTheme(mapTheme, airport.group === 'US')
  const { data } = useWeather(airportIcao)
  const fx = useMemo(() => weatherFx(data?.metar), [data?.metar])
  const night = useNight(airport.center)
  const sites = useMemo(() => windsockSites(runwayEnds(airportIcao)), [airportIcao])

  const cloudRef = useRef<HTMLCanvasElement>(null)
  const fxRef = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<AtmosphereOverlay | null>(null)
  const sheen = useRef<WaterSheen | null>(null)

  // ---- pattern images, once per map ------------------------------------------
  useEffect(() => {
    if (!map) return
    addPavementGrain(map)
    const s = new WaterSheen()
    sheen.current = s
    addWaterSheen(map, s)
  }, [map])

  // The sheen is sunlight on water: full on a clear day, faint under cloud, haze or at night; still under reduced motion.
  useEffect(() => {
    const s = sheen.current
    if (!s || !map) return
    s.strength = Math.max(0.12, (1 - 0.7 * fx.cloud) * (1 - 0.6 * fx.fog) * (1 - 0.65 * night))
    const sync = () => {
      s.animate = !reduceMotion && !document.hidden
    }
    sync()
    map.triggerRepaint()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [map, fx, night, reduceMotion])

  // ---- canvas overlay ---------------------------------------------------------
  const overlayState = useMemo<OverlayState>(
    () => ({ fx, night, streamlines, reduceMotion, shadows: theme !== 'chart', center: airport.center, sites }),
    [fx, night, streamlines, reduceMotion, theme, airport.center, sites],
  )
  // Read when the overlay is created, so a new map starts from the current state.
  const latest = useRef(overlayState)

  useEffect(() => {
    latest.current = overlayState
    overlay.current?.update(overlayState)
  }, [overlayState])

  useEffect(() => {
    if (!map || !cloudRef.current || !fxRef.current) return
    const o = new AtmosphereOverlay(map, cloudRef.current, fxRef.current)
    o.update(latest.current)
    overlay.current = o
    // For measuring its frame cost from the browser console in development.
    if (import.meta.env.DEV) Object.assign(window, { __atcAtmosphere: o })
    return () => {
      o.destroy()
      overlay.current = null
    }
  }, [map])

  // ---- tyre marks, jet bridges and stand markings ----------------------------------------------
  useEffect(() => {
    if (!map) return
    setData(map, ATMO_SRC.tyres, tyreMarks(airportIcao))
    setData(map, ATMO_SRC.stands, { type: 'FeatureCollection', features: [] })
    const done: LngLat[] = []
    const bridges = new Set<string>()
    const features: Feature[] = []
    let timer = 0
    const refresh = () => {
      if (map.getZoom() < STAND_MIN_ZOOM || done.length >= MAX_STANDS) return
      if (!map.isSourceLoaded('omt')) {
        timer = window.setTimeout(refresh, 500)
        return
      }
      // Jet bridges: the small, narrow bridge outlines (road and taxiway bridges are mapped the same way).
      let added = false
      for (const b of map.querySourceFeatures('omt', { sourceLayer: 'transportation', filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'class'], 'bridge']] })) {
        const g = b.geometry
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
        for (const poly of polys) {
          const ring = poly[0] as LngLat[]
          const key = `${ring[0][0].toFixed(5)},${ring[0][1].toFixed(5)},${ring.length}`
          if (bridges.has(key) || !isJetBridge(ring)) continue
          bridges.add(key)
          features.push({ type: 'Feature', properties: { kind: 'bridge' }, geometry: { type: 'Polygon', coordinates: [ring] } })
          added = true
        }
      }
      const gates = map.querySourceFeatures('omt', { sourceLayer: 'aeroway', filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'class'], 'gate']] })
      // The same gate turns up in several tiles and zoom levels, a few metres apart.
      const seen = (p: LngLat) => done.some((q) => Math.abs(q[0] - p[0]) < 0.0002 && Math.abs(q[1] - p[1]) < 0.00015)
      const fresh = gates.filter((g) => !seen((g.geometry as GeoJSON.Point).coordinates as LngLat))
      if (!fresh.length) {
        if (added) setData(map, ATMO_SRC.stands, { type: 'FeatureCollection', features })
        return
      }
      // Outer rings of the buildings in view, each with a rough bounding box to skip far ones quickly.
      const rings: { ring: LngLat[]; box: [number, number, number, number] }[] = []
      for (const b of map.querySourceFeatures('omt', { sourceLayer: 'building' })) {
        const g = b.geometry
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
        for (const poly of polys) {
          const ring = poly[0] as LngLat[]
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
          for (const [x, y] of ring) {
            if (x < x0) x0 = x
            if (x > x1) x1 = x
            if (y < y0) y0 = y
            if (y > y1) y1 = y
          }
          rings.push({ ring, box: [x0, y0, x1, y1] })
        }
      }
      // About 100 m, in degrees, for the box test.
      const pad = 0.0013
      for (const g of fresh) {
        const gate = (g.geometry as GeoJSON.Point).coordinates as LngLat
        if (seen(gate)) continue
        done.push(gate)
        const near = rings.filter(({ box }) => gate[0] > box[0] - pad * 1.4 && gate[0] < box[2] + pad * 1.4 && gate[1] > box[1] - pad && gate[1] < box[3] + pad).map((r) => r.ring)
        const pose = standPose(gate, near)
        if (!pose) continue
        const ref = typeof g.properties?.ref === 'string' ? g.properties.ref : null
        features.push(...standMarkings(pose.nose, pose.outBearing, pose.turn, ref))
      }
      setData(map, ATMO_SRC.stands, { type: 'FeatureCollection', features })
    }
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(refresh, 400)
    }
    map.on('moveend', schedule)
    schedule()
    return () => {
      window.clearTimeout(timer)
      map.off('moveend', schedule)
    }
  }, [map, airportIcao])

  // ---- screen-space washes -------------------------------------------------------
  const washes = useMemo(() => screenWashes(theme, fx.fog, fx.rain, night), [theme, fx.fog, fx.rain, night])

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <canvas ref={cloudRef} className="absolute inset-0 h-full w-full" />
      {washes.tint && <div className="absolute inset-0" style={washes.tint} />}
      {washes.fog && <div className="absolute inset-0" style={washes.fog} />}
      <canvas ref={fxRef} className="absolute inset-0 h-full w-full" />
      {washes.vignette && <div className="absolute inset-0" style={washes.vignette} />}
    </div>
  )
}
