import { describe, expect, it } from 'vitest'
import { getRunways } from '../api/airportData'
import { AIRPORTS } from '../api/airports'
import { buildAirportDiagram, crossesPad, FAA, HOLD_LINE_PITCH_M, holdBars, ICAO, markingSpec, measuredLengthFt, relativeToRunway, runwayEnds, widthScale, type HoldBar, type RunwayEndGeometry } from './airportDiagram'
import { bearingDeg, distanceM, M_PER_FT, offset, type LngLat } from './geo'

describe('geo', () => {
  it('round-trips offsets and bearings', () => {
    const a: [number, number] = [-87.9, 41.98]
    const b = offset(a, 1000, 1000)
    expect(distanceM(a, b)).toBeCloseTo(Math.SQRT2 * 1000, 0)
    expect(bearingDeg(a, b)).toBeCloseTo(45, 1)
  })
})

describe('runway data', () => {
  it('end coordinates describe the published pavement length at every airport', () => {
    // If these drift apart the painted markings would no longer sit on the runway.
    for (const code of AIRPORTS.map((a) => a.icao)) {
      for (const r of getRunways(code)) {
        if (!r.lengthFt) continue
        expect(Math.abs(measuredLengthFt(r) - r.lengthFt) / r.lengthFt, `${code} ${r.le.ident}/${r.he.ident}`).toBeLessThan(0.03)
      }
    }
  })

  it('leaves out runways that have been decommissioned or closed', () => {
    // Salt Lake City 14/32 was decommissioned in June 2026; Calgary 08/26 is closed.
    expect(getRunways('SLC').map((r) => r.le.ident)).not.toContain('14')
    expect(getRunways('YYC').map((r) => r.le.ident)).not.toContain('08')
  })
})

const centroid = (ring: [number, number][]): [number, number] => [(ring[0][0] + ring[2][0]) / 2, (ring[0][1] + ring[2][1]) / 2]

/** A point `along` metres past a runway's threshold and `cross` metres right of its centreline. */
function at(end: RunwayEndGeometry, along: number, cross: number): LngLat {
  const b = (end.bearing * Math.PI) / 180
  return offset(end.threshold, Math.sin(b) * along + Math.cos(b) * cross, Math.cos(b) * along - Math.sin(b) * cross)
}

/** Numeral strokes painted at one end: on its centreline band, between `from` and `to` metres past the threshold. */
function numerals(d: ReturnType<typeof buildAirportDiagram>, end: RunwayEndGeometry, from: number, to: number) {
  return d.designators.features.filter(
    (f) =>
      f.properties?.kind === 'numeral' &&
      (f.geometry.coordinates as [number, number][]).every((c) => {
        const { along, cross } = relativeToRunway(end, c)
        return along > from && along < to && Math.abs(cross) < end.widthM * 0.3
      }),
  )
}

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

  it('paints each designator as 60 ft FAA stencil strokes: letter first, then the number', () => {
    const end = runwayEnds('ORD').find((e) => e.ident === '28R')!
    const mine = numerals(ord, end, 40, 140)
    // "R" is two strokes, "2" one, "8" one.
    expect(mine).toHaveLength(4)
    const along = mine.flatMap((f) => (f.geometry.coordinates as [number, number][]).map((c) => relativeToRunway(end, c).along))
    const across = mine.flatMap((f) => (f.geometry.coordinates as [number, number][]).map((c) => relativeToRunway(end, c).cross))
    // Stroke centrelines sit half a stroke inside each character box.
    const s = FAA.stroke
    expect(Math.min(...along)).toBeCloseTo(FAA.stripeStart + FAA.stripeLength + FAA.designatorGap + s / 2, 1)
    expect(Math.max(...along) - Math.min(...along)).toBeCloseTo(FAA.charHeight * 2 + FAA.letterGap - s, 1)
    // Centred on the runway, two characters wide.
    expect(Math.max(...across) + Math.min(...across)).toBeCloseTo(0, 0)
    expect(Math.max(...across) - Math.min(...across)).toBeCloseTo(FAA.charWidth * 2 + FAA.charGap - s, 1)
    expect(mine.every((f) => f.properties?.w === FAA.stroke)).toBe(true)
  })

  it('paints Canadian runways to ICAO: 30 m stripes, 9 m numbers 12 m beyond them', () => {
    expect(markingSpec('CYYC')).toBe(ICAO)
    expect(markingSpec('KORD')).toBe(FAA)
    const yyc = buildAirportDiagram('YYC')
    const end = runwayEnds('YYC').find((e) => e.ident === '17R')!
    const stripes = yyc.paint.features.filter((f) => {
      if (f.properties?.kind !== 'threshold') return false
      const r = relativeToRunway(end, centroid(f.geometry.coordinates[0] as [number, number][]))
      return r.along > 0 && r.along < 60 && Math.abs(r.cross) < end.widthM / 2
    })
    // A 200 ft (60 m) runway carries 16 stripes, 30 m long.
    expect(stripes).toHaveLength(16)
    const ring = stripes[0].geometry.coordinates[0] as [number, number][]
    expect(distanceM(ring[0], ring[1])).toBeCloseTo(30, 0)
    const mine = numerals(yyc, end, 40, 120)
    const along = mine.flatMap((f) => (f.geometry.coordinates as [number, number][]).map((c) => relativeToRunway(end, c).along))
    expect(Math.min(...along)).toBeCloseTo(6 + 30 + 12 + ICAO.stroke / 2, 1)
    expect(Math.max(...along) - Math.min(...along)).toBeCloseTo(9 * 2 + ICAO.letterGap - ICAO.stroke, 1)
    // A long aiming block either side, 400 m in, 22.5 m apart across the centreline.
    const aim = yyc.paint.features
      .filter((f) => f.properties?.kind === 'aim')
      .map((f) => relativeToRunway(end, centroid(f.geometry.coordinates[0] as [number, number][])))
      .filter((r) => r.along > 0 && r.along < 600 && Math.abs(r.cross) < end.widthM / 2)
    expect(aim).toHaveLength(2)
    expect(aim[0].along).toBeCloseTo(430, 0)
    expect(Math.min(...aim.map((r) => Math.abs(r.cross)))).toBeCloseTo(11.25 + 5, 0)
    // Single touchdown bars, the first pair 150 m in.
    const tdz = yyc.paint.features
      .filter((f) => f.properties?.kind === 'tdz')
      .map((f) => relativeToRunway(end, centroid(f.geometry.coordinates[0] as [number, number][])))
      .filter((r) => r.along > 0 && r.along < 200 && Math.abs(r.cross) < end.widthM / 2)
    expect(tdz).toHaveLength(2)
    expect(tdz[0].along).toBeCloseTo(150 + 22.5 / 2, 0)
  })

  it('includes every standard marking on a long precision runway', () => {
    const kinds = new Set(ord.paint.features.map((f) => f.properties?.kind))
    for (const k of ['end', 'threshold', 'aim', 'tdz', 'edge']) expect(kinds.has(k), k).toBe(true)
    // The centreline is a dashed hairline, drawn with the strokes.
    expect(ord.designators.features.some((f) => f.properties?.kind === 'centre')).toBe(true)
  })

  it('carries a latitude factor so stroke widths stay true away from 40°N', () => {
    expect(widthScale(40)).toBeCloseTo(1, 6)
    expect(widthScale(51.1)).toBeGreaterThan(1.2)
    const yyc = buildAirportDiagram('YYC')
    expect(yyc.designators.features[0].properties?.k).toBeCloseTo(widthScale(51.1), 1)
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

  it('paints the FAA threshold stripes past a grey end bar, split by a centre gap', () => {
    const end = runwayEnds('ORD').find((e) => e.ident === '28R')!
    const stripes = ord.paint.features.filter((f) => {
      if (f.properties?.kind !== 'threshold') return false
      const r = relativeToRunway(end, f.geometry.coordinates[0][0] as [number, number])
      return Math.abs(r.cross) < end.widthM / 2 && r.along < 10 && r.along > 0
    })
    // A 150 ft runway carries 12 stripes, 5.75 ft wide, six either side of the centreline.
    expect(stripes).toHaveLength(12)
    const ring = stripes[0].geometry.coordinates[0] as [number, number][]
    expect(distanceM(ring[0], ring[1]) / M_PER_FT).toBeCloseTo(150, 0)
    expect(distanceM(ring[1], ring[2]) / M_PER_FT).toBeCloseTo(5.75, 1)
    const cross = stripes.map((f) => relativeToRunway(end, centroid(f.geometry.coordinates[0] as [number, number][])).cross)
    expect(cross.filter((c) => c > 0)).toHaveLength(6)
    // Nothing painted within 5.75 ft of the centreline: the gap between the two groups.
    expect(Math.min(...cross.map(Math.abs)) / M_PER_FT).toBeCloseTo(8.625, 1)
    // They start 20 ft in, past the grey bar across the end of the pavement.
    const nearest = Math.min(...stripes.map((f) => relativeToRunway(end, f.geometry.coordinates[0][0] as [number, number]).along))
    expect(nearest / M_PER_FT).toBeCloseTo(20, 0)
    const bar = ord.paint.features.find((f) => f.properties?.kind === 'end' && Math.abs(relativeToRunway(end, centroid(f.geometry.coordinates[0] as [number, number][])).along) < 5)
    expect(bar).toBeDefined()
  })

  it('draws displaced-threshold arrows and a bar where the threshold is displaced', () => {
    const kinds = buildAirportDiagram('BOS').paint.features.map((f) => f.properties?.kind)
    expect(kinds).toContain('threshold-bar')
    expect(kinds).toContain('arrow')
  })

  it('keeps displaced-threshold arrows off a crossing runway that has right of way', () => {
    // Las Vegas 1L's displaced area runs over runway 8L/26R.
    const las = buildAirportDiagram('LAS')
    const ends = runwayEnds('LAS')
    const mine = ends.find((e) => e.ident === '1L')!
    const other = ends.find((e) => e.ident === '8L')!
    const arrows = las.paint.features.filter((f) => {
      if (f.properties?.kind !== 'arrow') return false
      const r = relativeToRunway(mine, centroid(f.geometry.coordinates[0] as [number, number][]))
      return r.along < 0 && Math.abs(r.cross) < mine.widthM / 2
    })
    expect(arrows.length).toBeGreaterThan(0)
    const onOther = arrows.filter((f) =>
      (f.geometry.coordinates[0] as [number, number][]).some((p) => {
        const r = relativeToRunway(other, p)
        return r.along > -300 && r.along < other.lengthM && Math.abs(r.cross) < other.widthM / 2
      }),
    )
    expect(onOther).toEqual([])
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
    // The pad lies wholly before the pavement: its probe points are 250 ft short of the runway end.
    const end = runwayEnds('ORD').find((e) => e.ident === '10L')!
    expect(relativeToRunway(end, pad.probe).along).toBeCloseTo(-250 * M_PER_FT, 0)
    expect(pad.probes).toHaveLength(3)
    for (const p of pad.probes) expect(relativeToRunway(end, p).along).toBeCloseTo(-250 * M_PER_FT, 0)
  })

  it('rejects a blast pad that a taxiway runs through', () => {
    const end = runwayEnds('ORD').find((e) => e.ident === '10L')!
    const pad = ord.pads.find((p) => p.ident === '10L')!
    // A parallel taxiway crossing right behind the runway end...
    expect(crossesPad([at(end, -40, -400), at(end, -40, 400)], pad)).toBe(true)
    // ...but not one 200 m further out, nor one alongside the runway.
    expect(crossesPad([at(end, -300, -400), at(end, -300, 400)], pad)).toBe(false)
    expect(crossesPad([at(end, -100, 180), at(end, 1000, 180)], pad)).toBe(false)
  })

  it('returns an empty diagram for an unknown airport', () => {
    expect(buildAirportDiagram('ZZZ').surface.features).toEqual([])
  })
})

describe('holdBars', () => {
  it('marks a taxiway where it crosses the holding line: a band, two solid and two dashed lines', () => {
    const end = runwayEnds('ORD').find((e) => e.ident === '28R')!
    const bars: HoldBar[] = []
    // A taxiway running straight in from 200 m to the right, 500 m down the runway.
    expect(holdBars([at(end, 500, 200), at(end, 500, 0)], [end], 85, bars)).toBe(true)
    const marks = bars.flatMap((b) => b.marks)
    expect(marks.map((f) => f.properties?.kind)).toEqual(['band', 'solid', 'solid', 'dashed', 'dashed'])
    const cross = marks.map((f) => relativeToRunway(end, f.geometry.coordinates[0] as LngLat).cross)
    expect(cross[0]).toBeCloseTo(85, 0)
    // The dashed pair is the one nearer the runway.
    expect(Math.max(cross[3], cross[4])).toBeLessThan(Math.min(cross[1], cross[2]))
    expect(Math.abs(cross[1] - cross[2])).toBeCloseTo(HOLD_LINE_PITCH_M, 1)
    // Adding the same crossing again (tiles overlap) changes nothing.
    expect(holdBars([at(end, 500, 200), at(end, 500, 0)], [end], 85, bars)).toBe(false)
  })

  it('gives a junction one bar, on the taxiway line that meets the runway most squarely', () => {
    const end = runwayEnds('ORD').find((e) => e.ident === '28R')!
    const bars: HoldBar[] = []
    // A fillet curving in at 45 degrees, then the straight taxiway beside it.
    expect(holdBars([at(end, 400, 200), at(end, 540, 60)], [end], 85, bars)).toBe(true)
    expect(holdBars([at(end, 500, 200), at(end, 500, 0)], [end], 85, bars)).toBe(true)
    expect(bars).toHaveLength(1)
    expect(bars[0].squareness).toBeCloseTo(1, 2)
    // Another taxiway 300 m further down gets its own bar.
    holdBars([at(end, 800, 200), at(end, 800, 0)], [end], 85, bars)
    expect(bars).toHaveLength(2)
  })
})

describe('relativeToRunway', () => {
  it('measures along and across the landing direction', () => {
    const end = runwayEnds('ORD').find((e) => e.ident === '28R')!
    // One mile out on the approach, 100 m right of the centreline.
    const r = relativeToRunway(end, at(end, -1852, 100))
    expect(r.along).toBeCloseTo(-1852, 0)
    expect(r.cross).toBeCloseTo(100, 0)
  })
})
