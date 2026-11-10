/**
 * Feeds the generated airport diagram into the map: runway pavement, painted
 * markings, designators, sign-style runway labels and extended centrelines.
 *
 * It also paints the runway holding-position markings and decides which
 * blast pads to draw. Both depend on where the taxiways actually are, which
 * only the map tiles know, so they are worked out from the loaded tile
 * geometry after each camera move.
 */
import type { Feature, FeatureCollection } from 'geojson'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { useEffect } from 'react'
import { icaoCode } from '../api/airportData'
import { buildAirportDiagram, crossesPad, HOLD_OFFSET_M, holdBars, markingSpec, runwayEnds, type HoldBar } from './airportDiagram'
import type { LngLat } from './geo'
import { KEEPOUT_IMAGE, KEEPOUT_PX, SRC } from './mapStyle'

const MIN_ZOOM = 13.5

function setData(map: MapLibreMap, id: string, data: FeatureCollection) {
  ;(map.getSource(id) as GeoJSONSource | undefined)?.setData(data)
}

export function AirportDiagramLayer({ map, airportIcao }: { map: MapLibreMap | null; airportIcao: string }) {
  useEffect(() => {
    if (!map) return
    // The see-through squares that keep taxiway letters off the runways.
    if (!map.hasImage(KEEPOUT_IMAGE)) map.addImage(KEEPOUT_IMAGE, { width: KEEPOUT_PX, height: KEEPOUT_PX, data: new Uint8Array(KEEPOUT_PX * KEEPOUT_PX * 4) })
    const d = buildAirportDiagram(airportIcao)
    setData(map, SRC.surface, d.surface)
    setData(map, SRC.paint, d.paint)
    setData(map, SRC.designators, d.designators)
    setData(map, SRC.ends, d.ends)
    setData(map, SRC.approach, d.approach)

    // ---- holding-position markings -----------------------------------------
    // Only one end per runway is needed to describe its centreline.
    const runways = runwayEnds(airportIcao).filter((_, i) => i % 2 === 0)
    const holdOffset = HOLD_OFFSET_M[markingSpec(icaoCode(airportIcao)).name]
    const bars: HoldBar[] = []
    // Blast pads: undecided until their outer edge has been on screen once.
    const pending = new Set(d.pads)
    const pads: Feature[] = []
    let timer = 0
    let tries = 0
    const refresh = () => {
      window.clearTimeout(timer)
      // Zoomed further out the tiles carry no taxiways, and both markings depend on them.
      if (map.getZoom() < MIN_ZOOM) return
      // Tiles for the new view may still be arriving; look again shortly.
      if (!map.isSourceLoaded('omt')) {
        if (tries++ < 12) timer = window.setTimeout(refresh, 400)
        return
      }
      tries = 0
      const taxiways = map.querySourceFeatures('omt', {
        sourceLayer: 'aeroway',
        filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'taxiway']],
      })
      const paths: LngLat[][] = []
      for (const f of taxiways) {
        const g = f.geometry
        if (g.type === 'LineString') paths.push(g.coordinates as LngLat[])
        else if (g.type === 'MultiLineString') paths.push(...(g.coordinates as LngLat[][]))
      }
      let added = false
      for (const path of paths) added = holdBars(path, runways, holdOffset, bars) || added
      if (added) setData(map, SRC.hold, { type: 'FeatureCollection', features: bars.flatMap((b) => b.marks) })

      // A pad is drawn only where the ground under its outer edge belongs to
      // the airfield and no taxiway runs through it; otherwise it would sit on
      // water, a road or a parallel taxiway that passes right behind the runway.
      if (map.getLayer('aero-infield')) {
        const { width, height } = map.getCanvas().getBoundingClientRect()
        const water = map.getLayer('water') ? ['water'] : []
        let decided = false
        for (const pad of pending) {
          const px = pad.probes.map((p) => map.project(p))
          if (px.some((p) => p.x < 0 || p.y < 0 || p.x > width || p.y > height)) continue
          pending.delete(pad)
          const ground = px.every((p) => map.queryRenderedFeatures(p, { layers: ['aero-infield'] }).length > 0 && (!water.length || map.queryRenderedFeatures(p, { layers: water }).length === 0))
          if (ground && !paths.some((path) => crossesPad(path, pad))) {
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
