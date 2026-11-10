import { describe, expect, it } from 'vitest'
import { getRunways } from '../api/airportData'
import { buildAirportDiagram, measuredLengthFt, relativeToRunway, runwayEnds } from './airportDiagram'
import { bearingDeg, distanceM, M_PER_FT, offset } from './geo'

describe('geo', () => {
  it('round-trips offsets and bearings', () => {
    const a: [number, number] = [-87.9, 41.98]
    const b = offset(a, 1000, 1000)
    expect(distanceM(a, b)).toBeCloseTo(Math.SQRT2 * 1000, 0)
    expect(bearingDeg(a, b)).toBeCloseTo(45, 1)
  })
})

describe('runway data', () => {
  it('end coordinates describe the published pavement length', () => {
    // If these drift apart the painted markings would no longer sit on the runway.
    for (const code of ['ORD', 'JFK', 'SFO', 'BOS', 'YYZ']) {
      for (const r of getRunways(code)) {
        if (!r.lengthFt) continue
        expect(Math.abs(measuredLengthFt(r) - r.lengthFt) / r.lengthFt, `${code} ${r.le.ident}/${r.he.ident}`).toBeLessThan(0.03)
      }
    }
  })
})

describe('buildAirportDiagram', () => {
  const ord = buildAirportDiagram('ORD')

  it('paints one surface and two labelled ends per runway', () => {
    const runways = getRunways('ORD').length
    expect(ord.surface.features).toHaveLength(runways)
    expect(ord.ends.features).toHaveLength(runways * 2)
    // US runways drop the leading zero.
    const idents = ord.ends.features.map((f) => f.properties?.ident)
    expect(idents).toContain('28R')
    expect(idents).toContain('4L')
    expect(idents).not.toContain('04L')
  })

  it('paints each designator as stencil strokes on the runway, a third of its width tall', () => {
    const ends = runwayEnds('ORD')
    const end = ends.find((e) => e.ident === '28R')!
    // Strokes belonging to 28R: on its centreline band, in its first 150 m.
    const mine = ord.designators.features.filter((f) =>
      (f.geometry.coordinates as [number, number][]).every((c) => {
        const { along, cross } = relativeToRunway(end, c)
        return along > 40 && along < 110 && Math.abs(cross) < end.widthM * 0.25
      }),
    )
    // "R" is two strokes, "2" one, "8" one.
    expect(mine).toHaveLength(4)
    const along = mine.flatMap((f) => (f.geometry.coordinates as [number, number][]).map((c) => relativeToRunway(end, c).along))
    const across = mine.flatMap((f) => (f.geometry.coordinates as [number, number][]).map((c) => relativeToRunway(end, c).cross))
    // Letter then number, stacked along the runway and centred on it.
    expect(Math.max(...along) - Math.min(...along)).toBeCloseTo(end.widthM * (0.26 + 0.12 + 0.3), 0)
    expect(Math.max(...across) + Math.min(...across)).toBeCloseTo(0, 0)
    expect(Math.max(...across) - Math.min(...across)).toBeCloseTo(end.widthM * 0.33, 0)
  })

  it('includes every standard marking on a long precision runway', () => {
    const kinds = new Set(ord.paint.features.map((f) => f.properties?.kind))
    for (const k of ['threshold', 'centre', 'aim', 'tdz', 'edge']) expect(kinds.has(k), k).toBe(true)
  })

  it('keeps all paint on the pavement', () => {
    const ends = runwayEnds('ORD')
    for (const f of ord.paint.features) {
      const [lon, lat] = f.geometry.coordinates[0][0]
      const onSome = ends.some((e) => {
        const { along, cross } = relativeToRunway(e, [lon, lat])
        return along > -5 && along < e.lengthM + 5 && Math.abs(cross) <= e.widthM / 2 + 0.5
      })
      expect(onSome).toBe(true)
    }
  })

  it('fills the threshold with fine stripes 150 ft long, behind a solid bar', () => {
    const end = runwayEnds('ORD').find((e) => e.ident === '28R')!
    const stripes = ord.paint.features.filter((f) => f.properties?.kind === 'threshold' && Math.abs(relativeToRunway(end, f.geometry.coordinates[0][0] as [number, number]).cross) < end.widthM / 2 && relativeToRunway(end, f.geometry.coordinates[0][0] as [number, number]).along < 10 && relativeToRunway(end, f.geometry.coordinates[0][0] as [number, number]).along > 0)
    // A 150 ft runway carries 13 stripes, evenly spread across its width.
    expect(stripes).toHaveLength(13)
    const ring = stripes[0].geometry.coordinates[0] as [number, number][]
    expect(distanceM(ring[0], ring[1]) / M_PER_FT).toBeCloseTo(150, 0)
    expect(distanceM(ring[1], ring[2])).toBeGreaterThan(1.5)
    expect(distanceM(ring[1], ring[2])).toBeLessThan(2.2)
    expect(ord.paint.features.some((f) => f.properties?.kind === 'threshold-bar')).toBe(true)
  })

  it('draws displaced-threshold arrows and a bar where the threshold is displaced', () => {
    const kinds = buildAirportDiagram('BOS').paint.features.map((f) => f.properties?.kind)
    expect(kinds).toContain('threshold-bar')
    expect(kinds).toContain('arrow')
  })

  it('extends a centreline with mile ticks from each end', () => {
    const lines = ord.approach.features.filter((f) => f.properties?.kind === 'centreline')
    expect(lines).toHaveLength(getRunways('ORD').length * 2)
    const [a, b] = lines[0].geometry.coordinates as [number, number][]
    expect(distanceM(a, b) / 1852).toBeCloseTo(8, 0)
  })

  it('offers a blast pad with chevrons before every runway end', () => {
    expect(ord.pads).toHaveLength(getRunways('ORD').length * 2)
    const pad = ord.pads.find((p) => p.ident === '10L')!
    expect(pad.features.map((f) => f.properties?.kind)).toEqual(['pad', 'chevron', 'chevron', 'chevron', 'chevron'])
    // The pad lies wholly before the pavement: its probe point is 250 ft short of the runway end.
    const end = runwayEnds('ORD').find((e) => e.ident === '10L')!
    expect(relativeToRunway(end, pad.probe).along).toBeCloseTo(-250 * M_PER_FT, 0)
  })

  it('returns an empty diagram for an unknown airport', () => {
    expect(buildAirportDiagram('ZZZ').surface.features).toEqual([])
  })
})

describe('relativeToRunway', () => {
  it('measures along and across the landing direction', () => {
    const end = runwayEnds('ORD').find((e) => e.ident === '28R')!
    // One mile out on the approach, 100 m right of the centreline.
    const b = (end.bearing * Math.PI) / 180
    const p = offset(end.threshold, -Math.sin(b) * 1852 + Math.cos(b) * 100, -Math.cos(b) * 1852 - Math.sin(b) * 100)
    const r = relativeToRunway(end, p)
    expect(r.along).toBeCloseTo(-1852, 0)
    expect(r.cross).toBeCloseTo(100, 0)
  })
})
