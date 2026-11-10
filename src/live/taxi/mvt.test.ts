import { describe, expect, it } from 'vitest'
import { clipLine, decodeTile, lngLatToTile, taxiwaysInTile, tileToLngLat } from './mvt'

// A minimal protobuf writer, enough to build a vector tile by hand.
const varint = (n: number): number[] => {
  const out: number[] = []
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80)
    n = Math.floor(n / 0x80)
  }
  out.push(n)
  return out
}
const key = (field: number, wire: number) => varint(field * 8 + wire)
const bytes = (field: number, b: number[]) => [...key(field, 2), ...varint(b.length), ...b]
const str = (field: number, s: string) => bytes(field, [...new TextEncoder().encode(s)])
const zz = (n: number) => (n < 0 ? -2 * n - 1 : 2 * n)
const packed = (field: number, ns: number[]) => bytes(field, ns.flatMap(varint))

/** A line as MoveTo + LineTo commands. */
function lineGeom(pts: [number, number][]): number[] {
  const out = [(1 & 7) | (1 << 3), zz(pts[0][0]), zz(pts[0][1]), (2 & 7) | ((pts.length - 1) << 3)]
  for (let i = 1; i < pts.length; i++) out.push(zz(pts[i][0] - pts[i - 1][0]), zz(pts[i][1] - pts[i - 1][1]))
  return out
}

function tile(): Uint8Array {
  const feature = (tags: number[], type: number, geom: number[]) => bytes(2, [...packed(2, tags), ...key(3, 0), ...varint(type), ...packed(4, geom)])
  const layer = [
    ...key(15, 0),
    ...varint(2),
    ...str(1, 'aeroway'),
    // class=taxiway ref=K4, a line that runs off the tile's right edge.
    ...feature([0, 0, 1, 1], 2, lineGeom([[100, 100], [5000, 100]])),
    // class=runway: ignored.
    ...feature([0, 2], 2, lineGeom([[0, 0], [10, 10]])),
    ...str(3, 'class'),
    ...str(3, 'ref'),
    ...bytes(4, str(1, 'taxiway')),
    ...bytes(4, str(1, 'K4')),
    ...bytes(4, str(1, 'runway')),
    ...key(5, 0),
    ...varint(4096),
  ]
  const other = [...str(1, 'water'), ...key(5, 0), ...varint(4096)]
  return new Uint8Array([...bytes(3, other), ...bytes(3, layer)])
}

describe('decodeTile', () => {
  it('reads layers, properties and line geometry', () => {
    const layers = decodeTile(tile())
    expect(layers.map((l) => l.name)).toEqual(['water', 'aeroway'])
    const aero = layers[1]
    expect(aero.extent).toBe(4096)
    expect(aero.features[0].props).toEqual({ class: 'taxiway', ref: 'K4' })
    expect(aero.features[0].geometry).toEqual([
      [
        [100, 100],
        [5000, 100],
      ],
    ])
  })

  it('keeps only the layers asked for', () => {
    expect(decodeTile(tile(), ['aeroway']).map((l) => l.name)).toEqual(['aeroway'])
  })

  it('turns taxiways into clipped lng/lat lines', () => {
    const [x, y] = lngLatToTile(14, -73.78, 40.64)
    const lines = taxiwaysInTile(decodeTile(tile()), 14, x, y)
    expect(lines).toHaveLength(1)
    expect(lines[0].ref).toBe('K4')
    const end = lines[0].coords[1]
    // Clipped at the tile's right edge.
    expect(end[0]).toBeCloseTo(tileToLngLat(14, x, y, 4096, 100, 4096)[0], 9)
  })
})

describe('clipLine', () => {
  it('splits a line that leaves and re-enters the box', () => {
    const pieces = clipLine(
      [
        [10, 10],
        [200, 10],
        [200, 50],
        [10, 50],
      ],
      100,
    )
    expect(pieces).toEqual([
      [
        [10, 10],
        [100, 10],
      ],
      [
        [100, 50],
        [10, 50],
      ],
    ])
  })
})

describe('tile maths', () => {
  it('round-trips a point through tile coordinates', () => {
    const [x, y] = lngLatToTile(14, -87.9, 41.98)
    const [lon, lat] = tileToLngLat(14, x, y, 0, 0, 4096)
    expect(lon).toBeLessThanOrEqual(-87.9)
    expect(lat).toBeGreaterThanOrEqual(41.98)
  })
})
