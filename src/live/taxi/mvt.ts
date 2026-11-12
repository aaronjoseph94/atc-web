/**
 * Just enough of a Mapbox Vector Tile reader to pull the taxiway lines out of
 * the map's own tiles.
 *
 * The router needs the whole taxiway network around the aircraft, not only
 * what happens to be on screen (which is all `querySourceFeatures` offers),
 * so the z14 tiles around the airport are read directly. They are the same
 * URLs the map loads, so they usually come straight from the browser cache.
 * The format is a small protobuf schema; this decodes the parts we use.
 */
import type { LngLat } from '../../map/geo'
import type { TaxiLine } from './graph'

class Reader {
  pos = 0
  readonly buf: Uint8Array
  readonly end: number
  constructor(buf: Uint8Array) {
    this.buf = buf
    this.end = buf.length
  }
  varint(): number {
    let result = 0
    let shift = 0
    for (;;) {
      const b = this.buf[this.pos++]
      // Plain arithmetic rather than bit shifts: values can pass 32 bits.
      result += (b & 0x7f) * 2 ** shift
      if (b < 0x80) return result
      shift += 7
      if (shift > 63) throw new Error('bad varint')
    }
  }
  bytes(): Uint8Array {
    const len = this.varint()
    const out = this.buf.subarray(this.pos, this.pos + len)
    this.pos += len
    return out
  }
  skip(wire: number) {
    if (wire === 0) this.varint()
    else if (wire === 1) this.pos += 8
    else if (wire === 2) this.pos += this.varint()
    else if (wire === 5) this.pos += 4
    else throw new Error(`wire type ${wire}`)
  }
}

const zigzag = (n: number) => (n % 2 === 1 ? -(n + 1) / 2 : n / 2)
const utf8 = new TextDecoder()

type Value = string | number | boolean | null

function readValue(buf: Uint8Array): Value {
  const r = new Reader(buf)
  let v: Value = null
  while (r.pos < r.end) {
    const tag = r.varint()
    const field = tag >> 3
    const wire = tag & 7
    if (field === 1) v = utf8.decode(r.bytes())
    else if (field === 2) {
      v = new DataView(buf.buffer, buf.byteOffset + r.pos, 4).getFloat32(0, true)
      r.pos += 4
    } else if (field === 3) {
      v = new DataView(buf.buffer, buf.byteOffset + r.pos, 8).getFloat64(0, true)
      r.pos += 8
    } else if (field === 4 || field === 5) v = r.varint()
    else if (field === 6) v = zigzag(r.varint())
    else if (field === 7) v = r.varint() !== 0
    else r.skip(wire)
  }
  return v
}

function packed(buf: Uint8Array): number[] {
  const r = new Reader(buf)
  const out: number[] = []
  while (r.pos < r.end) out.push(r.varint())
  return out
}

export type MvtFeature = { type: number; props: Record<string, Value>; geometry: [number, number][][] }
export type MvtLayer = { name: string; extent: number; features: MvtFeature[] }

/** Decode the commands of a feature into rings/lines of tile coordinates. */
function decodeGeometry(cmds: number[]): [number, number][][] {
  const lines: [number, number][][] = []
  let x = 0
  let y = 0
  let cur: [number, number][] | null = null
  for (let i = 0; i < cmds.length; ) {
    const cmd = cmds[i] & 7
    const count = cmds[i] >> 3
    i++
    if (cmd === 7) {
      if (cur && cur.length) cur.push([cur[0][0], cur[0][1]])
      continue
    }
    for (let k = 0; k < count; k++) {
      x += zigzag(cmds[i++])
      y += zigzag(cmds[i++])
      if (cmd === 1) {
        cur = [[x, y]]
        lines.push(cur)
      } else cur?.push([x, y])
    }
  }
  return lines
}

/** Decode the named layers of a tile (all of them when `only` is empty). */
export function decodeTile(buf: Uint8Array, only: string[] = []): MvtLayer[] {
  const r = new Reader(buf)
  const layers: MvtLayer[] = []
  while (r.pos < r.end) {
    const tag = r.varint()
    if (tag >> 3 !== 3 || (tag & 7) !== 2) {
      r.skip(tag & 7)
      continue
    }
    const lr = new Reader(r.bytes())
    let name = ''
    let extent = 4096
    const keys: string[] = []
    const values: Value[] = []
    const raw: Uint8Array[] = []
    while (lr.pos < lr.end) {
      const t = lr.varint()
      const field = t >> 3
      if (field === 1) name = utf8.decode(lr.bytes())
      else if (field === 2) raw.push(lr.bytes())
      else if (field === 3) keys.push(utf8.decode(lr.bytes()))
      else if (field === 4) values.push(readValue(lr.bytes()))
      else if (field === 5) extent = lr.varint()
      else lr.skip(t & 7)
    }
    if (only.length && !only.includes(name)) continue
    const features: MvtFeature[] = raw.map((fb) => {
      const fr = new Reader(fb)
      let type = 0
      let tags: number[] = []
      let geom: number[] = []
      while (fr.pos < fr.end) {
        const t = fr.varint()
        const field = t >> 3
        if (field === 2) tags = packed(fr.bytes())
        else if (field === 3) type = fr.varint()
        else if (field === 4) geom = packed(fr.bytes())
        else fr.skip(t & 7)
      }
      const props: Record<string, Value> = {}
      for (let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = values[tags[i + 1]]
      return { type, props, geometry: decodeGeometry(geom) }
    })
    layers.push({ name, extent, features })
  }
  return layers
}

/**
 * Cut a polyline to the box [0, size]², returning the pieces inside. Tiles
 * carry a margin of geometry from their neighbours; clipping it off leaves
 * neighbouring tiles meeting edge to edge, with no doubled-up overlap.
 */
export function clipLine(line: [number, number][], size: number): [number, number][][] {
  const out: [number, number][][] = []
  let cur: [number, number][] = []
  for (let i = 1; i < line.length; i++) {
    const seg = clipSegment(line[i - 1], line[i], size)
    if (!seg) {
      if (cur.length > 1) out.push(cur)
      cur = []
      continue
    }
    const [a, b] = seg
    const last = cur[cur.length - 1]
    if (!last || last[0] !== a[0] || last[1] !== a[1]) {
      if (cur.length > 1) out.push(cur)
      cur = [a]
    }
    cur.push(b)
  }
  if (cur.length > 1) out.push(cur)
  return out
}

/** Liang–Barsky. */
function clipSegment(p: [number, number], q: [number, number], size: number): [[number, number], [number, number]] | null {
  let t0 = 0
  let t1 = 1
  const dx = q[0] - p[0]
  const dy = q[1] - p[1]
  for (const [pk, qk] of [
    [-dx, p[0]],
    [dx, size - p[0]],
    [-dy, p[1]],
    [dy, size - p[1]],
  ]) {
    if (pk === 0) {
      if (qk < 0) return null
      continue
    }
    const r = qk / pk
    if (pk < 0) {
      if (r > t1) return null
      if (r > t0) t0 = r
    } else {
      if (r < t0) return null
      if (r < t1) t1 = r
    }
  }
  if (t1 - t0 < 1e-9) return null
  const at = (t: number): [number, number] => (t === 0 ? p : t === 1 ? q : [p[0] + dx * t, p[1] + dy * t])
  return [at(t0), at(t1)]
}

/** Tile coordinates to longitude/latitude. */
export function tileToLngLat(z: number, x: number, y: number, px: number, py: number, extent: number): LngLat {
  const n = 2 ** z
  const lon = ((x + px / extent) / n) * 360 - 180
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / extent)) / n))) * 180) / Math.PI
  return [lon, lat]
}

export function lngLatToTile(z: number, lon: number, lat: number): [number, number] {
  const n = 2 ** z
  const x = Math.floor(((lon + 180) / 360) * n)
  const r = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
  return [x, y]
}

/** The taxiway lines in one decoded tile, clipped to the tile and in lng/lat. */
export function taxiwaysInTile(layers: MvtLayer[], z: number, x: number, y: number): TaxiLine[] {
  const out: TaxiLine[] = []
  for (const layer of layers) {
    if (layer.name !== 'aeroway') continue
    for (const f of layer.features) {
      // 2 = LineString.
      if (f.type !== 2 || f.props.class !== 'taxiway') continue
      const ref = typeof f.props.ref === 'string' ? f.props.ref : null
      for (const line of f.geometry)
        for (const piece of clipLine(line, layer.extent)) out.push({ ref, coords: piece.map(([px, py]) => tileToLngLat(z, x, y, px, py, layer.extent)) })
    }
  }
  return out
}

/** A polygon as its rings in lng/lat (outer ring and any holes; tested even-odd). */
export type LngLatPolygon = LngLat[][]

/** Everything an aircraft or a vehicle can move on, as one tile has it. */
export type TilePavement = {
  taxiways: TaxiLine[]
  /** Runway centrelines. */
  runways: TaxiLine[]
  aprons: LngLatPolygon[]
  /** Runway surfaces drawn as areas (not every runway has one). */
  runwayAreas: LngLatPolygon[]
  /** The airport's own grounds. */
  aerodromes: LngLatPolygon[]
}

/**
 * The paved surfaces in one decoded tile, for keeping ground traffic on them
 * (`src/map/motion`). Lines are clipped to the tile so neighbours meet edge
 * to edge; polygons keep the tile's margin, which only makes them overlap.
 */
export function pavementInTile(layers: MvtLayer[], z: number, x: number, y: number): TilePavement {
  const out: TilePavement = { taxiways: [], runways: [], aprons: [], runwayAreas: [], aerodromes: [] }
  for (const layer of layers) {
    if (layer.name !== 'aeroway') continue
    const at = ([px, py]: [number, number]) => tileToLngLat(z, x, y, px, py, layer.extent)
    for (const f of layer.features) {
      const cls = f.props.class
      if (f.type === 2 && (cls === 'taxiway' || cls === 'runway')) {
        const ref = typeof f.props.ref === 'string' ? f.props.ref : null
        for (const line of f.geometry)
          for (const piece of clipLine(line, layer.extent)) {
            if (cls === 'taxiway') out.taxiways.push({ ref, coords: piece.map(at) })
            else out.runways.push({ ref, coords: piece.map(at), kind: 'runway' })
          }
      } else if (f.type === 3 && (cls === 'apron' || cls === 'runway' || cls === 'aerodrome')) {
        const rings = f.geometry.filter((r) => r.length >= 4).map((r) => r.map(at))
        if (!rings.length) continue
        if (cls === 'apron') out.aprons.push(rings)
        else if (cls === 'runway') out.runwayAreas.push(rings)
        else out.aerodromes.push(rings)
      }
    }
  }
  return out
}

/** Service roads in one decoded tile (the roads airside vehicles drive on, among others), clipped to the tile. */
export function serviceRoadsInTile(layers: MvtLayer[], z: number, x: number, y: number): TaxiLine[] {
  const out: TaxiLine[] = []
  for (const layer of layers) {
    if (layer.name !== 'transportation') continue
    for (const f of layer.features) {
      if (f.type !== 2 || f.props.class !== 'service') continue
      // Car parks and private drives are not where a follow-me car goes.
      if (f.props.service === 'parking_aisle' || f.props.service === 'driveway' || f.props.service === 'drive-through') continue
      for (const line of f.geometry)
        for (const piece of clipLine(line, layer.extent)) out.push({ ref: null, kind: 'road', coords: piece.map(([px, py]) => tileToLngLat(z, x, y, px, py, layer.extent)) })
    }
  }
  return out
}
