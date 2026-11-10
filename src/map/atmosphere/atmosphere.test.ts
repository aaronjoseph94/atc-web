import { describe, expect, it } from 'vitest'
import type { Metar } from '../../api/types'
import { relativeToRunway, runwayEnds, standMarkings, tyreMarks } from '../airportDiagram'
import { bearingDeg, distanceM, offset, type LngLat } from '../geo'
import { isJetBridge, standPose } from './stands'
import { pavementGrain } from './textures'
import { screenWashes } from './washes'
import { CALM, downwindScreenAngle, gustiness, sockExtension, weatherFx } from './weatherFx'
import { windsockSites } from './windsocks'

const metar = (m: Partial<Metar>): Metar => ({
  raw: 'TEST',
  observedAt: '2026-11-10T12:00:00Z',
  windDirDeg: 270,
  windVariable: false,
  windKt: 10,
  gustKt: null,
  visibilitySm: 10,
  visibilityPlus: true,
  tempC: 10,
  dewpointC: 5,
  altimeterInHg: 30,
  flightCategory: 'VFR',
  clouds: [],
  weather: null,
  ...m,
})

describe('weatherFx', () => {
  it('is calm without a report', () => {
    expect(weatherFx(null)).toEqual(CALM)
  })

  it('shades the ground under broken and overcast decks only', () => {
    expect(weatherFx(metar({ clouds: [{ cover: 'FEW', baseFt: 3000 }] })).cloud).toBe(0)
    expect(weatherFx(metar({ clouds: [{ cover: 'BKN', baseFt: 3000 }] })).cloud).toBeCloseTo(0.6)
    expect(weatherFx(metar({ clouds: [{ cover: 'SCT', baseFt: 2000 }, { cover: 'OVC', baseFt: 8000 }] })).cloud).toBe(1)
    // Cirrus overcast is too thin and high to cast a shadow worth drawing.
    expect(weatherFx(metar({ clouds: [{ cover: 'OVC', baseFt: 25000 }] })).cloud).toBe(0)
  })

  it('reads rain, showers, thunderstorms and snow with their intensity', () => {
    expect(weatherFx(metar({ weather: '-RA' })).rain).toBeCloseTo(0.45)
    expect(weatherFx(metar({ weather: '+SHRA' })).rain).toBe(1)
    expect(weatherFx(metar({ weather: 'TSRA' })).rain).toBeGreaterThanOrEqual(0.85)
    expect(weatherFx(metar({ weather: 'SN BR' })).snow).toBeCloseTo(0.72)
    expect(weatherFx(metar({ weather: 'SN' })).rain).toBe(0)
    // Showers in the vicinity are not over the field.
    expect(weatherFx(metar({ weather: 'VCSH' })).rain).toBe(0)
  })

  it('gives falling rain a cloud deck to fall from', () => {
    expect(weatherFx(metar({ weather: 'RA', clouds: [] })).cloud).toBeGreaterThanOrEqual(0.6)
  })

  it('hazes the map as visibility drops below 3 miles, and in mist or fog', () => {
    expect(weatherFx(metar({ visibilitySm: 10, visibilityPlus: true })).fog).toBe(0)
    const mile = weatherFx(metar({ visibilitySm: 1, visibilityPlus: false })).fog
    const quarter = weatherFx(metar({ visibilitySm: 0.25, visibilityPlus: false })).fog
    expect(mile).toBeGreaterThan(0.3)
    expect(quarter).toBeCloseTo(1)
    expect(weatherFx(metar({ visibilitySm: 5, visibilityPlus: false, weather: 'BR' })).fog).toBeGreaterThan(0.2)
    expect(weatherFx(metar({ visibilitySm: 5, visibilityPlus: false, weather: 'FG' })).fog).toBeGreaterThan(0.6)
  })

  it('keeps the wind direction only when it is steady', () => {
    expect(weatherFx(metar({ windDirDeg: 220, windKt: 12, gustKt: 25 }))).toMatchObject({ windFrom: 220, windKt: 12, gustKt: 25 })
    expect(weatherFx(metar({ windDirDeg: null, windKt: 4, windVariable: true })).windFrom).toBeNull()
    expect(weatherFx(metar({ windDirDeg: null, windKt: 0 })).windFrom).toBeNull()
  })
})

describe('wind', () => {
  it('fills the sock from limp under 3 kt to full at 15 kt', () => {
    expect(sockExtension(0)).toBeLessThan(0.3)
    expect(sockExtension(2.9)).toBeLessThan(0.31)
    expect(sockExtension(9)).toBeGreaterThan(0.6)
    expect(sockExtension(9)).toBeLessThan(0.7)
    expect(sockExtension(15)).toBe(1)
    expect(sockExtension(40)).toBe(1)
  })

  it('sways more the more it gusts', () => {
    expect(gustiness({ ...CALM, windKt: 10, gustKt: 10 })).toBe(0)
    expect(gustiness({ ...CALM, windKt: 10, gustKt: 25 })).toBe(1)
  })

  it('points downwind on screen, turning with the map', () => {
    const westerly = { ...CALM, windFrom: 270, windKt: 10, gustKt: 10 }
    // From the west, blowing east: to the right on a north-up map, straight up with east at the top.
    expect(downwindScreenAngle(westerly, 0)).toBeCloseTo(Math.PI / 2)
    expect(downwindScreenAngle(westerly, 90)).toBeCloseTo(0)
    expect(downwindScreenAngle(CALM, 0)).toBeNull()
  })

  it('puts a windsock beside each runway touchdown zone, clear of the pavement', () => {
    for (const airport of ['JFK', 'SFO', 'YYC', 'PHX']) {
      const ends = runwayEnds(airport)
      const sites = windsockSites(ends)
      expect(sites.length).toBeGreaterThan(1)
      expect(sites.length).toBeLessThanOrEqual(ends.length)
      for (const s of sites) {
        // Not on any runway.
        for (const e of ends) {
          const { along, cross } = relativeToRunway(e, s)
          const onIt = along > -50 && along < e.lengthM + 50 && Math.abs(cross) < e.widthM / 2 + 20
          expect(onIt).toBe(false)
        }
      }
    }
  })
})

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

describe('screen washes', () => {
  it('has a vignette with a lighter top on the dark themes, none over aerial photos', () => {
    expect(screenWashes('navy', 0, 0, 0).vignette?.background).toMatch(/radial-gradient/)
    expect(screenWashes('satellite', 0, 0, 0).vignette).toBeUndefined()
    expect(screenWashes('chart', 0, 0, 0).vignette?.background).toMatch(/20,32,70/)
  })

  it('adds haze and a rain tint only when the weather calls for them', () => {
    expect(screenWashes('navy', 0, 0, 0).fog).toBeUndefined()
    expect(screenWashes('navy', 0, 0, 0).tint).toBeUndefined()
    expect(screenWashes('navy', 0.8, 0, 0).fog).toBeDefined()
    expect(screenWashes('navy', 0, 0.7, 0).tint).toBeDefined()
  })
})
