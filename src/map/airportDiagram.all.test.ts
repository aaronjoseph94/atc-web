import { describe, expect, it } from 'vitest'
import { getRunways } from '../api/airportData'
import { AIRPORTS } from '../api/airports'
import { buildAirportDiagram, relativeToRunway, runwayEnds } from './airportDiagram'
import { distanceM, M_PER_FT } from './geo'

/**
 * Every runway at every airport gets the same markings. These checks run the
 * generator over the whole catalogue, so a short, narrow or displaced runway
 * that breaks an assumption fails here instead of looking wrong on the map.
 */
describe.each(AIRPORTS.map((a) => a.icao))('%s runways', (code) => {
  const d = buildAirportDiagram(code)
  const ends = runwayEnds(code)
  const runways = getRunways(code)

  it('has pavement and two ends for every runway', () => {
    expect(d.surface.features).toHaveLength(runways.length)
    expect(ends).toHaveLength(runways.length * 2)
    expect(d.pads).toHaveLength(runways.length * 2)
  })

  it('gives every end a threshold, stencil numerals and a centreline', () => {
    for (const e of ends) {
      const near = (f: { geometry: { coordinates: unknown } }) => {
        const ring = (f.geometry.coordinates as number[][][])[0] ?? (f.geometry.coordinates as number[][])
        return relativeToRunway(e, ring[0] as [number, number])
      }
      const stripes = d.paint.features.filter((f) => {
        if (f.properties?.kind !== 'threshold') return false
        const r = near(f)
        return r.along >= 0 && r.along < 8 + e.lengthM * 0.01 && Math.abs(r.cross) < e.widthM / 2
      })
      // FAA: 4 stripes on the narrowest runways, up to 16 on a 200 ft runway.
      const wFt = e.widthM / M_PER_FT
      const expected = wFt >= 200 ? 16 : wFt >= 150 ? 12 : wFt >= 100 ? 8 : wFt >= 75 ? 6 : 4
      expect(stripes.length, `${e.ident} threshold stripes`).toBe(expected)
    }
    const chars = ends.reduce((n, e) => n + e.ident.length, 0)
    // Every character of every designator is drawn (the 'R' is two strokes, '2' one, ...).
    expect(d.designators.features.length).toBeGreaterThanOrEqual(chars)
    expect(d.paint.features.filter((f) => f.properties?.kind === 'centre').length).toBeGreaterThanOrEqual(runways.length)
  })

  it('keeps every mark on its pavement', () => {
    for (const f of [...d.paint.features, ...d.designators.features]) {
      const pts = (f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates) as [number, number][]
      for (const p of pts) {
        const onSome = ends.some((e) => {
          const { along, cross } = relativeToRunway(e, p)
          return along > -2 && along < e.lengthM + 2 && Math.abs(cross) <= e.widthM / 2 + 0.6
        })
        expect(onSome, `${code}: point off the pavement`).toBe(true)
      }
    }
  })

  it('fits the numerals before the midpoint, clear of the threshold stripes', () => {
    for (const e of ends) {
      const mine = d.designators.features.filter((f) => {
        const pts = f.geometry.coordinates as [number, number][]
        return pts.every((p) => {
          const r = relativeToRunway(e, p)
          return r.along > 0 && r.along < e.lengthM / 2 && Math.abs(r.cross) < e.widthM / 2
        })
      })
      expect(mine.length, `${e.ident} numerals`).toBeGreaterThanOrEqual(e.ident.length)
      const along = mine.flatMap((f) => (f.geometry.coordinates as [number, number][]).map((p) => relativeToRunway(e, p).along))
      expect(Math.min(...along), `${e.ident} numerals start past the 150 ft stripe block`).toBeGreaterThan(150 * M_PER_FT)
    }
  })
})

describe('runway crossings', () => {
  /** Bearing, folded to 0–180, of the long axis of a thin paint polygon. */
  const axis = (ring: [number, number][]) => {
    const long = distanceM(ring[0], ring[1]) >= distanceM(ring[1], ring[2]) ? [ring[0], ring[1]] : [ring[1], ring[2]]
    const dx = (long[1][0] - long[0][0]) * Math.cos((long[0][1] * Math.PI) / 180)
    const dy = long[1][1] - long[0][1]
    return (((Math.atan2(dx, dy) * 180) / Math.PI) % 180 + 180) % 180
  }
  const centre = (ring: [number, number][]): [number, number] => [(ring[0][0] + ring[2][0]) / 2, (ring[0][1] + ring[2][1]) / 2]

  it.each(['MDW', 'ORD', 'BOS', 'JFK', 'SFO', 'EWR'])('%s: only one runway is marked through each intersection', (code) => {
    const d = buildAirportDiagram(code)
    const rwys = runwayEnds(code).filter((_, i) => i % 2 === 0)
    // Marks that run along the runway (not threshold blocks or numerals).
    const through = d.paint.features.filter((f) => ['centre', 'edge'].includes(String(f.properties?.kind)))
    let crossings = 0
    for (let i = 0; i < rwys.length; i++) {
      for (let j = i + 1; j < rwys.length; j++) {
        // Find where the two centrelines meet by scanning the first runway.
        for (let s = 0; s < rwys[i].lengthM; s += 4) {
          const b = (rwys[i].bearing * Math.PI) / 180
          const p: [number, number] = [rwys[i].threshold[0] + (Math.sin(b) * s) / (111320 * Math.cos((rwys[i].threshold[1] * Math.PI) / 180)), rwys[i].threshold[1] + (Math.cos(b) * s) / 110950]
          const inJ = relativeToRunway(rwys[j], p)
          if (inJ.along < 0 || inJ.along > rwys[j].lengthM || Math.abs(inJ.cross) > 1) continue
          crossings++
          const near = through.filter((f) => distanceM(centre(f.geometry.coordinates[0] as [number, number][]), p) < rwys[j].widthM / 2 + 6)
          const axes = near.map((f) => Math.round(axis(f.geometry.coordinates[0] as [number, number][]) / 5))
          expect(new Set(axes).size, `${code} ${rwys[i].ident} x ${rwys[j].ident}`).toBeLessThanOrEqual(1)
          break
        }
      }
    }
    if (code === 'MDW') expect(crossings).toBeGreaterThan(0)
  })
})
