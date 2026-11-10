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

  it('writes the designator as a number plus a side letter, aligned with the runway', () => {
    const texts = ord.designators.features.map((f) => f.properties?.text)
    expect(texts).toContain('28')
    expect(texts).toContain('R')
    const number = ord.designators.features.find((f) => f.properties?.text === '28')!
    // 28R is flown heading roughly west.
    expect(number.properties?.rot).toBeGreaterThan(260)
    expect(number.properties?.rot).toBeLessThan(280)
    expect(number.properties?.em).toBeGreaterThan(15)
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

  it('sizes threshold stripes to the FAA standard', () => {
    const stripe = ord.paint.features.find((f) => f.properties?.kind === 'threshold')!
    const ring = stripe.geometry.coordinates[0] as [number, number][]
    expect(distanceM(ring[0], ring[1]) / M_PER_FT).toBeCloseTo(150, 0)
    expect(distanceM(ring[1], ring[2]) / M_PER_FT).toBeCloseTo(5.75, 1)
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
    expect(pad.features.map((f) => f.properties?.kind)).toEqual(['pad', 'chevron', 'chevron', 'chevron'])
    // The pad lies wholly before the pavement: its probe point is 200 ft short of the runway end.
    const end = runwayEnds('ORD').find((e) => e.ident === '10L')!
    expect(relativeToRunway(end, pad.probe).along).toBeCloseTo(-200 * M_PER_FT, 0)
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
