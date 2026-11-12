/**
 * Reads an airport's pavement (taxiway and runway centrelines, aprons, and on
 * request the airside service roads) out of the map's own z14 vector tiles,
 * for keeping ground traffic on it (`pavement.ts`).
 *
 * These are the tiles the taxi-route feature reads (`src/live/taxi/network.ts`
 * fetches each once and shares the bytes), about 1 MB for a big airport, and
 * the browser's HTTP cache keeps them between visits.
 */
import { runwayEnds } from '../airportDiagram'
import { offset, type LngLat } from '../geo'
import { decodeTile, pavementInTile, serviceRoadsInTile, type LngLatPolygon } from '../../live/taxi/mvt'
import { airportTiles, loadTileBytes, TILE_Z } from '../../live/taxi/network'
import type { PavementData, RunwayStrip } from './pavement'

/** Taxiways and aprons reach about this far beyond the runway ends. */
const MARGIN_M = 700
const MAX_TILES = 36

const cache = new Map<string, Promise<PavementData | null>>()

/** The published runways of an airport as centreline strips, end to end. */
export function runwayStrips(icao: string): RunwayStrip[] {
  const ends = runwayEnds(icao)
  const far = (e: (typeof ends)[number]): LngLat => {
    const b = (e.bearing * Math.PI) / 180
    return offset(e.threshold, Math.sin(b) * e.lengthM, Math.cos(b) * e.lengthM)
  }
  const out: RunwayStrip[] = []
  // The two ends of a runway come as a pair; each one's far point is the other's physical end.
  for (let i = 0; i + 1 < ends.length; i += 2) out.push({ a: far(ends[i + 1]), b: far(ends[i]), widthM: ends[i].widthM })
  return out
}

/** Load (once) the pavement of an airport. Null when the tiles can't be had; a later call tries again. */
export function loadPavement(icao: string): Promise<PavementData | null> {
  let p = cache.get(icao)
  if (!p) {
    p = build(icao).catch(() => {
      cache.delete(icao)
      return null
    })
    cache.set(icao, p)
  }
  return p
}

async function build(icao: string): Promise<PavementData | null> {
  const tiles = airportTiles(icao, MARGIN_M, MAX_TILES)
  const data: PavementData = { taxiways: [], runways: [], aprons: [], strips: runwayStrips(icao) }
  const aerodromes: LngLatPolygon[] = []
  const parts = await Promise.all(
    tiles.map(async ([x, y]) => {
      const buf = await loadTileBytes(x, y)
      return pavementInTile(decodeTile(buf, ['aeroway']), TILE_Z, x, y)
    }),
  )
  for (const part of parts) {
    data.taxiways.push(...part.taxiways)
    data.runways.push(...part.runways)
    data.aprons.push(...part.aprons)
    aerodromes.push(...part.aerodromes)
  }
  if (!data.taxiways.length && !data.runways.length) return null
  // Service roads are in a much bigger layer of the same tiles; it is only decoded if a vehicle ever shows up.
  data.roads = async () => {
    const perTile = await Promise.all(
      tiles.map(async ([x, y]) => serviceRoadsInTile(decodeTile(await loadTileBytes(x, y), ['transportation']), TILE_Z, x, y)),
    )
    // Only roads on the airport's own grounds.
    return perTile.flat().filter((road) => aerodromes.some((poly) => inPolygon(road.coords[0], poly) || inPolygon(road.coords[road.coords.length - 1], poly)))
  }
  return data
}

function inPolygon(p: LngLat, poly: LngLatPolygon): boolean {
  let inside = false
  for (const ring of poly) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]
      const b = ring[j]
      if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
    }
  }
  return inside
}
