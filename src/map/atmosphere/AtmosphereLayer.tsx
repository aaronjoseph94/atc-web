/**
 * Generated surface detail in the map itself: the touchdown-zone tyre marks,
 * the stand lead-in lines and painted gate numbers (worked out from the tiles
 * after each camera move, the way the hold bars are), and the pattern images
 * the water sheen and pavement grain are drawn with. Their layers are in
 * `mapStyle.ts`. Nothing here draws per frame.
 */
import type { Feature, FeatureCollection } from 'geojson'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { useEffect } from 'react'
import { standMarkings, tyreMarks } from '../airportDiagram'
import type { LngLat } from '../geo'
import { ATMO_SRC } from '../mapStyle'
import { isJetBridge, standPose } from './stands'
import { addPavementGrain, SHEEN_IMAGE, surfaceImage, waterSheenFor } from './textures'

/** Stand markings are worked out from this zoom (they show from 15.6). */
const STAND_MIN_ZOOM = 15.2
const MAX_STANDS = 1500

function setData(map: MapLibreMap, id: string, data: FeatureCollection) {
  ;(map.getSource(id) as GeoJSONSource | undefined)?.setData(data)
}

export function AtmosphereLayer({ map, airportIcao }: { map: MapLibreMap | null; airportIcao: string }) {
  // ---- pattern images, once per map ------------------------------------------
  useEffect(() => {
    if (!map) return
    addPavementGrain(map)
    // A still sheen: animating it re-uploads the tile and repaints the whole map several times a second.
    const s = waterSheenFor(map)
    s.animate = false
    s.strength = 0.5
    surfaceImage(map, SHEEN_IMAGE)
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

  return null
}
