import { describe, expect, it } from 'vitest'
import { getRunways } from '../../api/airportData'
import { distanceM, metersPerPixel, offset, type LngLat } from '../geo'
import { addApronGlows, addTaxiwayLights, LIGHT, LightSet, MAX_RUNWAY_LIGHTS, runwayFrames, runwayLights, type GlowFeature, type LightFeature } from './airfieldLights'

const at = (f: { geometry: { coordinates: number[] } }) => f.geometry.coordinates as LngLat

describe('runwayFrames', () => {
  it('recovers each runway’s pavement ends from the threshold records', () => {
    const frames = runwayFrames('JFK')
    const runways = getRunways('JFK')
    expect(frames).toHaveLength(runways.length)
    for (const f of frames) {
      const r = runways.find((x) => f.le.ident.startsWith(x.le.ident.replace(/^0/, '')) || x.le.ident === f.le.ident)
      expect(r).toBeTruthy()
      // The frame starts at the low end's pavement corner and ends at the high end's.
      expect(distanceM(f.at(0, 0), [r!.le.lon, r!.le.lat])).toBeLessThan(2)
      expect(distanceM(f.at(f.lengthM, 0), [r!.he.lon, r!.he.lat])).toBeLessThan(2)
    }
  })
})

describe('runwayLights', () => {
  const lights = runwayLights('JFK')
  const colours = (c: string) => lights.filter((l) => l.properties.c === c)

  it('lights every runway in the expected colours, within the cap', () => {
    expect(lights.length).toBeGreaterThan(500)
    expect(lights.length).toBeLessThanOrEqual(MAX_RUNWAY_LIGHTS)
    for (const c of [LIGHT.white, LIGHT.yellow, LIGHT.green, LIGHT.red, LIGHT.approach]) expect(colours(c).length).toBeGreaterThan(0)
    // Taxiway colours never appear in runway lighting.
    expect(colours(LIGHT.taxiBlue)).toHaveLength(0)
  })

  it('puts yellow edge lights only within 600 m of a runway end', () => {
    const frames = runwayFrames('JFK')
    for (const l of colours(LIGHT.yellow)) {
      const p = at(l)
      const nearEnd = frames.some((f) => Math.min(distanceM(p, f.at(0, 0)), distanceM(p, f.at(f.lengthM, 0))) < 600 + f.widthM)
      expect(nearEnd).toBe(true)
    }
  })

  it('runs approach lights out beyond the thresholds, not along the runway', () => {
    const frames = runwayFrames('JFK')
    const approach = colours(LIGHT.approach)
    expect(approach.length).toBeGreaterThan(100)
    // The furthest approach light from any threshold is about 720 m out (FAA), never kilometres.
    for (const l of approach) {
      const p = at(l)
      const d = Math.min(...frames.flatMap((f) => [distanceM(p, f.le.threshold), distanceM(p, f.he.threshold)]))
      expect(d).toBeLessThan(760)
    }
  })

  it('uses the longer ICAO approach system in Canada', () => {
    const frames = runwayFrames('YYC')
    const far = runwayLights('YYC')
      .filter((l) => l.properties.c === LIGHT.approach)
      .map((l) => Math.min(...frames.flatMap((f) => [distanceM(at(l), f.le.threshold), distanceM(at(l), f.he.threshold)])))
    expect(Math.max(...far)).toBeGreaterThan(850)
  })

  it('is empty for an unknown airport', () => {
    expect(runwayLights('ZZZ')).toEqual([])
  })
})

describe('taxiway lights', () => {
  const origin: LngLat = [-73.78, 40.64]

  it('lays green centreline lights 30 m apart and blue edge lights either side', () => {
    const path = [origin, offset(origin, 600, 0)]
    const set = new LightSet<LightFeature>(origin, 1000)
    addTaxiwayLights(set, origin, [path], [], [])
    const green = set.features.filter((f) => f.properties.c === LIGHT.taxiGreen)
    const blue = set.features.filter((f) => f.properties.c === LIGHT.taxiBlue)
    expect(green).toHaveLength(21)
    expect(blue).toHaveLength(22)
    expect(distanceM(at(green[0]), at(green[1]))).toBeCloseTo(30, 0)
  })

  it('does not double lights when the same taxiway arrives again from another tile', () => {
    const path = [origin, offset(origin, 600, 0)]
    const set = new LightSet<LightFeature>(origin, 1000)
    addTaxiwayLights(set, origin, [path], [], [])
    const n = set.features.length
    // The same line clipped differently: starts 12 m further along.
    addTaxiwayLights(set, origin, [[offset(origin, 12, 0), offset(origin, 600, 0)]], [], [])
    expect(set.features.length).toBe(n)
  })

  it('keeps edge lights off a crossing taxiway and off aprons', () => {
    const a = [offset(origin, -300, 0), offset(origin, 300, 0)]
    const b = [offset(origin, 0, -300), offset(origin, 0, 300)]
    const set = new LightSet<LightFeature>(origin, 1000)
    addTaxiwayLights(set, origin, [a, b], [], [])
    for (const f of set.features.filter((x) => x.properties.c === LIGHT.taxiBlue)) {
      const [lon, lat] = at(f)
      const onA = Math.abs(lat - origin[1]) * 111_000 < 15
      const onB = Math.abs(lon - origin[0]) * 84_000 < 15
      expect(onA || onB).toBe(false)
    }
    const apron = [[offset(origin, -400, -400), offset(origin, 400, -400), offset(origin, 400, 400), offset(origin, -400, 400), offset(origin, -400, -400)]]
    const lit = new LightSet<LightFeature>(origin, 1000)
    addTaxiwayLights(lit, origin, [a], [], [apron])
    expect(lit.features.some((f) => f.properties.c === LIGHT.taxiBlue)).toBe(false)
    expect(lit.features.some((f) => f.properties.c === LIGHT.taxiGreen)).toBe(true)
  })

  it('puts no taxiway light on a runway', () => {
    const frames = runwayFrames('JFK')
    const r = frames[0]
    // A taxiway straight across the middle of the runway.
    const path = [r.at(r.lengthM / 2, -200), r.at(r.lengthM / 2, 200)]
    const set = new LightSet<LightFeature>(origin, 1000)
    addTaxiwayLights(set, origin, [path], frames, [])
    for (const f of set.features) expect(Math.abs(distanceM(at(f), r.at(r.lengthM / 2, 0)))).toBeGreaterThan(r.widthM / 2)
  })

  it('stops at the cap', () => {
    const set = new LightSet<LightFeature>(origin, 10)
    addTaxiwayLights(set, origin, [[origin, offset(origin, 3000, 0)]], [], [])
    expect(set.features).toHaveLength(10)
  })
})

describe('apron glows', () => {
  const origin: LngLat = [-114.01, 51.12]

  it('lights the gates, one pool for gates close together, never doubled', () => {
    const gates = [offset(origin, 100, 280), offset(origin, 110, 285), offset(origin, 300, 280)]
    const set = new LightSet<GlowFeature>(origin, 500)
    addApronGlows(set, origin, gates)
    // Two of the gates are 11 m apart: one pool for both.
    expect(set.features).toHaveLength(2)
    // About 70 m across at zoom 16 at Calgary's latitude: radius r·2^16 px times metres per pixel.
    const px16 = set.features[0].properties.r * 2 ** 16
    expect(px16 * metersPerPixel(origin[1], 16)).toBeCloseTo(70, 0)
    // Seen again (another tile, another pass): nothing new.
    addApronGlows(set, origin, gates)
    expect(set.features).toHaveLength(2)
  })
})
