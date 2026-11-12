/**
 * The taxiway graph and runway frames for an airport, built once per airport
 * from the z14 map tiles around it.
 */
import { icaoCode } from '../../api/airportData'
import { getAirport } from '../../api/airports'
import { HOLD_OFFSET_M, markingSpec, runwayEnds } from '../../map/airportDiagram'
import { offset, type LngLat } from '../../map/geo'
import { buildGraph, toXY, type TaxiGraph, type TaxiLine } from './graph'
import { decodeTile, lngLatToTile, taxiwaysInTile } from './mvt'
import type { RunwayXY } from './route'

export type TaxiNetwork = { graph: TaxiGraph; runways: RunwayXY[] }

/** The deepest zoom OpenFreeMap serves: full-detail geometry. */
export const TILE_Z = 14
/** Taxiways reach this far beyond the runway ends at the bigger fields. */
const MARGIN_M = 1600
/** Never fetch more tiles than this for one airport. */
const MAX_TILES = 42
const TILEJSON = 'https://tiles.openfreemap.org/planet'

let template: Promise<string> | null = null
const bytes = new Map<string, Promise<Uint8Array>>()
const tiles = new Map<string, Promise<TaxiLine[]>>()
const networks = new Map<string, Promise<TaxiNetwork | null>>()

/** Use the tile URL the map itself loads (so tiles come from the browser cache). */
export function setTileTemplate(url: string | undefined) {
  if (url && !template) template = Promise.resolve(url)
}

function tileTemplate(): Promise<string> {
  template ??= fetch(TILEJSON)
    .then((r) => r.json() as Promise<{ tiles?: string[] }>)
    .then((j) => {
      if (!j.tiles?.[0]) throw new Error('no tiles')
      return j.tiles[0]
    })
    .catch((e) => {
      template = null
      throw e
    })
  return template
}

/**
 * The raw bytes of one z14 tile, fetched once. Shared with the motion model
 * (`src/map/motion/pavementLoader.ts`), which reads the same tiles for the
 * runways, aprons and service roads.
 */
export function loadTileBytes(x: number, y: number): Promise<Uint8Array> {
  const key = `${x}/${y}`
  let p = bytes.get(key)
  if (!p) {
    p = tileTemplate()
      .then((t) => fetch(t.replace('{z}', String(TILE_Z)).replace('{x}', String(x)).replace('{y}', String(y))))
      .then((r) => (r.ok ? r.arrayBuffer() : new ArrayBuffer(0)))
      .then((buf) => new Uint8Array(buf))
      .catch((e) => {
        // Let a later request try again.
        bytes.delete(key)
        throw e
      })
    bytes.set(key, p)
  }
  return p
}

function loadTile(x: number, y: number): Promise<TaxiLine[]> {
  const key = `${x}/${y}`
  let p = tiles.get(key)
  if (!p) {
    p = loadTileBytes(x, y)
      .then((buf) => taxiwaysInTile(decodeTile(buf, ['aeroway']), TILE_Z, x, y))
      .catch(() => {
        // Let a later request try again.
        tiles.delete(key)
        return []
      })
    tiles.set(key, p)
  }
  return p
}

/** The runway ends of an airport in the graph's local frame. */
export function runwayFrames(icao: string, origin: LngLat): RunwayXY[] {
  const holdM = HOLD_OFFSET_M[markingSpec(icaoCode(icao)).name]
  return runwayEnds(icao).map((e) => ({ ident: e.ident, threshold: toXY({ origin }, e.threshold), bearing: e.bearing, lengthM: e.lengthM, widthM: e.widthM, holdM }))
}

/** Build (once) the taxiway network for an airport. */
export function loadNetwork(icao: string): Promise<TaxiNetwork | null> {
  let p = networks.get(icao)
  if (!p) {
    p = build(icao).catch(() => {
      networks.delete(icao)
      return null
    })
    networks.set(icao, p)
  }
  return p
}

/** The z14 tiles covering an airport's runways plus `marginM` around them, nearest the middle first. */
export function airportTiles(icao: string, marginM = MARGIN_M, maxTiles = MAX_TILES): [number, number][] {
  const airport = getAirport(icao)
  const origin = airport.center
  // The box around every runway, plus a margin for the aprons and taxiways beyond.
  const pts: LngLat[] = [origin]
  for (const e of runwayEnds(icao)) {
    pts.push(e.threshold)
    const b = (e.bearing * Math.PI) / 180
    pts.push(offset(e.threshold, Math.sin(b) * e.lengthM, Math.cos(b) * e.lengthM))
  }
  const lons = pts.map((p) => p[0])
  const lats = pts.map((p) => p[1])
  const sw = offset([Math.min(...lons), Math.min(...lats)], -marginM, -marginM)
  const ne = offset([Math.max(...lons), Math.max(...lats)], marginM, marginM)
  const [x0, y1] = lngLatToTile(TILE_Z, sw[0], sw[1])
  const [x1, y0] = lngLatToTile(TILE_Z, ne[0], ne[1])
  const [cx, cy] = lngLatToTile(TILE_Z, origin[0], origin[1])
  const want: [number, number][] = []
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) want.push([x, y])
  // A sprawling field: keep the tiles nearest the middle.
  want.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy))
  return want.slice(0, maxTiles)
}

async function build(icao: string): Promise<TaxiNetwork | null> {
  const origin = getAirport(icao).center
  const lines = (await Promise.all(airportTiles(icao).map(([x, y]) => loadTile(x, y)))).flat()
  if (!lines.length) return null
  return { graph: buildGraph(lines, origin), runways: runwayFrames(icao, origin) }
}
