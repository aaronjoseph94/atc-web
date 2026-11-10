import { describe, expect, it } from 'vitest'
import { relativeToRunway, runwayEnds, standMarkings, tyreMarks } from '../airportDiagram'
import { bearingDeg, distanceM, offset, type LngLat } from '../geo'
import { isJetBridge, standPose } from './stands'
import { pavementGrain } from './textures'

describe('surface detail', () => {
  it('lays tyre marks inside each touchdown zone, on the runway', () => {
    const ends = runwayEnds('JFK')
    const marks = tyreMarks('JFK').features
    expect(marks.length).toBeGreaterThan(ends.length * 10)
    for (const m of marks) {
      const [a, b] = m.geometry.coordinates as LngLat[]
      // Every mark lies along some runway centreline, within the main-gear track.
      const fits = ends.some((e) => [a, b].every((p) => {
        const r = relativeToRunway(e, p)
        return r.along > 100 && r.along < 1100 && Math.abs(r.cross) < 8
      }))
      expect(fits).toBe(true)
      expect(m.properties?.o).toBeGreaterThan(0)
      expect(m.properties?.o).toBeLessThanOrEqual(0.6)
    }
    // The same marks on every load.
    expect(tyreMarks('JFK')).toEqual(tyreMarks('JFK'))
  })

  it('draws a stand straight out from the nose, then turning onto the taxilane', () => {
    const nose: LngLat = [-73.78, 40.64]
    const f = standMarkings(nose, 90, 1, 'B27')
    const lead = f.find((x) => x.properties?.kind === 'lead')!
    const pts = (lead.geometry as GeoJSON.LineString).coordinates as LngLat[]
    // Straight out to the east first.
    expect(bearingDeg(pts[0], pts[1])).toBeCloseTo(90, 0)
    // Then a quarter turn to the right (south) of the outward direction.
    const last = pts[pts.length - 1]
    expect(bearingDeg(pts[pts.length - 2], last)).toBeGreaterThan(160)
    expect(last[1]).toBeLessThan(nose[1])
    const num = f.find((x) => x.properties?.kind === 'num')!
    expect(num.properties).toMatchObject({ ref: 'B27', rot: 0 })
    // Text that would read upside down is turned the right way up.
    const west = standMarkings(nose, 270, -1, '7').find((x) => x.properties?.kind === 'num')!
    expect(west.properties?.rot).toBe(0)
    expect(standMarkings(nose, 0, 1, null).some((x) => x.properties?.kind === 'num')).toBe(false)
  })

  it('faces a stand away from the nearest building face', () => {
    // A terminal 200 m wide (east-west) whose south face is 5 m north of the gate.
    const gate: LngLat = [-73.78, 40.64]
    const sw = offset(gate, -150, 5)
    const terminal = [sw, offset(gate, 50, 5), offset(gate, 50, 80), offset(gate, -150, 80), sw]
    const pose = standPose(gate, [terminal])!
    expect(pose.outBearing).toBeCloseTo(180, 0)
    // The nose stops a jet bridge's length off the face.
    expect(distanceM(pose.nose, offset(gate, 0, 5))).toBeCloseTo(9, 0)
    // The bulk of the terminal is to the west, so the lead-in curves east, away from it:
    // looking south, east is to the left.
    expect(pose.turn).toBe(-1)
    // Far from any building there is no stand.
    expect(standPose(offset(gate, 0, -400), [terminal])).toBeNull()
  })

  it('tells jet bridges from road and taxiway bridges by their size', () => {
    const o: LngLat = [-112.0, 33.43]
    const rect = (w: number, l: number) => [o, offset(o, w, 0), offset(o, w, l), offset(o, 0, l), o]
    expect(isJetBridge(rect(4, 30))).toBe(true)
    expect(isJetBridge(rect(3.5, 18))).toBe(true)
    // A taxiway bridge over a road, and a road bridge.
    expect(isJetBridge(rect(90, 60))).toBe(false)
    expect(isJetBridge(rect(14, 200))).toBe(false)
  })

  it('makes a faint, mostly clear pavement grain', () => {
    const d = pavementGrain(32, 3)
    let max = 0
    let sum = 0
    for (let i = 3; i < d.length; i += 4) {
      max = Math.max(max, d[i])
      sum += d[i]
    }
    expect(max).toBeLessThan(24)
    expect(sum / (d.length / 4)).toBeLessThan(6)
  })
})

