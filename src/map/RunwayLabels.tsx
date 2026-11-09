/**
 * Runway designators ("28R", "10L") drawn at each threshold, from the
 * OurAirports snapshot. Helps non-pilots connect "cleared for takeoff 28R"
 * to a specific strip of pavement on the map.
 */
import type { FeatureCollection, Point } from 'geojson'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { useEffect } from 'react'
import { getRunways } from '../api/airportData'

const SRC = 'runway-ends-src'
const LAYER = 'runway-ends-label'

export function RunwayLabels({ map, airportIcao }: { map: MapLibreMap | null; airportIcao: string }) {
  useEffect(() => {
    if (!map) return
    const data = toFeatures(airportIcao)
    const src = map.getSource(SRC) as GeoJSONSource | undefined
    if (src) {
      src.setData(data)
      return
    }
    map.addSource(SRC, { type: 'geojson', data })
    map.addLayer({
      id: LAYER,
      type: 'symbol',
      source: SRC,
      minzoom: 11.5,
      layout: {
        'text-field': ['get', 'ident'],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 11.5, 9, 14, 13],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-letter-spacing': 0.08,
      },
      paint: {
        'text-color': 'rgba(255,255,255,0.78)',
        'text-halo-color': 'rgba(10,14,20,0.85)',
        'text-halo-width': 1.4,
      },
    })
  }, [map, airportIcao])

  return null
}

function toFeatures(iata: string): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: getRunways(iata).flatMap((r) =>
      [r.le, r.he].map((end) => ({
        type: 'Feature' as const,
        properties: { ident: end.ident },
        geometry: { type: 'Point' as const, coordinates: [end.lon, end.lat] },
      })),
    ),
  }
}
