/**
 * Feeds the generated airport diagram into the map: runway pavement, painted
 * markings, designators, sign-style runway labels and extended centrelines.
 *
 * It also paints the runway holding-position bars. Those depend on where the
 * taxiways actually are, which only the map tiles know, so they are worked
 * out from the loaded taxiway geometry after each camera move.
 */
import type { Feature, FeatureCollection, LineString } from 'geojson'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { useEffect } from 'react'
import { buildAirportDiagram, relativeToRunway, runwayEnds, type RunwayEndGeometry } from './airportDiagram'
import { M_PER_FT, metersPerPixel, offset, toLocal, type LngLat } from './geo'
import { SRC } from './mapStyle'

/** Distance from runway centreline to the holding position (FAA standard for large airports). */
const HOLD_OFFSET_M = 280 * M_PER_FT
/** Half-length of each bar; a little over half a taxiway. */
const BAR_HALF_M = 13
/** Gap between the four lines of the marking (exaggerated so they read as separate lines). */
const LINE_GAP_M = 2
const MIN_ZOOM = 13.5

function setData(map: MapLibreMap, id: string, data: FeatureCollection) {
  ;(map.getSource(id) as GeoJSONSource | undefined)?.setData(data)
}

export function AirportDiagramLayer({ map, airportIcao }: { map: MapLibreMap | null; airportIcao: string }) {
  useEffect(() => {
    if (!map) return
    const d = buildAirportDiagram(airportIcao)
    // Designator size is stored in metres; the style needs pixels at zoom 10.
    for (const f of d.designators.features) {
      const p = f.properties as { em: number; lat: number; px10?: number }
      p.px10 = p.em / metersPerPixel(p.lat, 10)
    }
    setData(map, SRC.surface, d.surface)
    setData(map, SRC.paint, d.paint)
    setData(map, SRC.designators, d.designators)
    setData(map, SRC.ends, d.ends)
    setData(map, SRC.approach, d.approach)

    // ---- holding-position bars -------------------------------------------
    // Only one end per runway is needed to describe its centreline.
    const runways = runwayEnds(airportIcao).filter((_, i) => i % 2 === 0)
    const bars = new Map<string, Feature<LineString>[]>()
    // Blast pads: undecided until their outer edge has been on screen once.
    const pending = new Set(d.pads)
    const pads: Feature[] = []
    let timer = 0
    let tries = 0
    const refresh = () => {
      window.clearTimeout(timer)
      if (map.getZoom() < MIN_ZOOM - 1.5) return
      // Tiles for the new view may still be arriving; look again shortly.
      if (!map.isSourceLoaded('omt')) {
        if (tries++ < 12) timer = window.setTimeout(refresh, 400)
        return
      }
      tries = 0
      const taxiways = map.getZoom() < MIN_ZOOM ? [] : map.querySourceFeatures('omt', {
        sourceLayer: 'aeroway',
        filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'taxiway']],
      })
      let added = false
      for (const f of taxiways) {
        const g = f.geometry
        const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []
        for (const part of parts) added = holdBars(part as LngLat[], runways, bars) || added
      }
      if (added) setData(map, SRC.hold, { type: 'FeatureCollection', features: [...bars.values()].flat() })

      // A pad is drawn only if the ground under its outer edge belongs to the
      // airfield; otherwise it would stick out over water, roads or houses.
      if (map.getLayer('aero-infield')) {
        const { width, height } = map.getCanvas().getBoundingClientRect()
        let decided = false
        for (const pad of pending) {
          const px = map.project(pad.probe)
          if (px.x < 0 || px.y < 0 || px.x > width || px.y > height) continue
          pending.delete(pad)
          if (map.queryRenderedFeatures(px, { layers: ['aero-infield'] }).length) {
            pads.push(...pad.features)
            decided = true
          }
        }
        if (decided) setData(map, SRC.pads, { type: 'FeatureCollection', features: pads })
      }
    }
    // The map never goes "idle" while aircraft animate, so settle on the end of each move instead.
    const schedule = () => {
      tries = 0
      window.clearTimeout(timer)
      timer = window.setTimeout(refresh, 350)
    }
    setData(map, SRC.hold, { type: 'FeatureCollection', features: [] })
    setData(map, SRC.pads, { type: 'FeatureCollection', features: [] })
    map.on('moveend', schedule)
    schedule()
    return () => {
      window.clearTimeout(timer)
      map.off('moveend', schedule)
    }
  }, [map, airportIcao])

  return null
}

/**
 * Find where a taxiway crosses a runway's holding line and add the marking
 * there: two solid lines on the taxiway side, two dashed on the runway side.
 * Returns true if anything new was added.
 */
function holdBars(path: LngLat[], runways: RunwayEndGeometry[], bars: Map<string, Feature<LineString>[]>): boolean {
  let added = false
  for (const rw of runways) {
    let prev = relativeToRunway(rw, path[0])
    for (let i = 1; i < path.length; i++) {
      const cur = relativeToRunway(rw, path[i])
      for (const side of [HOLD_OFFSET_M, -HOLD_OFFSET_M]) {
        const a = prev.cross - side
        const b = cur.cross - side
        if (a * b >= 0) continue
        const u = a / (a - b)
        const along = prev.along + (cur.along - prev.along) * u
        if (along < -40 || along > rw.lengthM + 40) continue

        const p: LngLat = [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * u, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * u]
        // Tiles overlap at their edges, so the same crossing turns up more than once.
        const key = `${Math.round(p[0] * 2e4)},${Math.round(p[1] * 2e4)}`
        if (bars.has(key)) continue

        // Unit vector along the taxiway, pointing toward the runway.
        const [e, n] = toLocal(path[i - 1], path[i])
        const len = Math.hypot(e, n) || 1
        const toward = Math.abs(cur.cross) < Math.abs(prev.cross) ? 1 : -1
        const dx = (e / len) * toward
        const dy = (n / len) * toward
        const marks: Feature<LineString>[] = []
        ;[-3, -1, 1, 3].forEach((step, k) => {
          const c = offset(p, dx * step * (LINE_GAP_M / 2), dy * step * (LINE_GAP_M / 2))
          marks.push({
            type: 'Feature',
            // The two lines nearer the runway are dashed.
            properties: { dashed: k >= 2 ? 1 : 0 },
            geometry: { type: 'LineString', coordinates: [offset(c, -dy * BAR_HALF_M, dx * BAR_HALF_M), offset(c, dy * BAR_HALF_M, -dx * BAR_HALF_M)] },
          })
        })
        bars.set(key, marks)
        added = true
      }
      prev = cur
    }
  }
  return added
}
