import { describe, expect, it } from 'vitest'
import { getRunways } from '../api/airportData'
import { offset, type LngLat } from '../map/geo'
import type { ActiveRunways, RunwayUse } from '../live/runwayUse'
import { formatRunwaySize, liveRunwayStatus, runwayAt, surfaceName, type RunwayFacts } from './runwayInfo'

describe('surfaceName', () => {
  it('reads the common codes', () => {
    expect(surfaceName('ASPH')).toBe('Asphalt')
    expect(surfaceName('ASP')).toBe('Asphalt')
    expect(surfaceName('CONC')).toBe('Concrete')
    expect(surfaceName('ASPH-CONC')).toBe('Asphalt and concrete')
    expect(surfaceName('ASP/CONC')).toBe('Asphalt and concrete')
    expect(surfaceName(null)).toBeNull()
    expect(surfaceName('XYZ')).toBe('XYZ')
  })
})

describe('runwayAt', () => {
  const jfk = getRunways('JFK')
  const r = jfk.find((x) => x.le.ident === '04L')!
  const mid: LngLat = [(r.le.lon + r.he.lon) / 2, (r.le.lat + r.he.lat) / 2]

  it('finds the runway under a tap in the middle of it', () => {
    const hit = runwayAt('JFK', mid, 10)
    expect(hit?.name).toBe('4L/22R')
    expect(hit?.lengthFt).toBe(12079)
    expect(hit?.widthFt).toBe(200)
    expect(hit?.surface).toBe('Concrete')
    expect(hit?.ends.map((e) => e.ident)).toEqual(['4L', '22R'])
    expect(hit?.ends[0].headingDeg).toBe(31)
    expect(hit?.ends[1].headingDeg).toBe(211)
  })

  it('misses well off to the side, and honours the slop', () => {
    // 04L/22R runs roughly north-east; 300 m to its north-west is grass.
    const off = offset(mid, -230, 190)
    expect(runwayAt('JFK', off, 10)?.name).not.toBe('4L/22R')
    expect(runwayAt('JFK', offset(mid, -60, 50), 10)?.name).not.toBe('4L/22R')
    expect(runwayAt('JFK', offset(mid, -60, 50), 80)?.name).toBe('4L/22R')
  })

  it('reaches a little past the ends, where the labels sit', () => {
    const beyond = offset([r.le.lon, r.le.lat], -20, -25)
    expect(runwayAt('JFK', beyond, 25)?.name).toBe('4L/22R')
  })

  it('keeps the leading zero outside the US', () => {
    const yyc = runwayAt('YYC', (() => {
      const w = getRunways('YYC')[0]
      return [(w.le.lon + w.he.lon) / 2, (w.le.lat + w.he.lat) / 2] as LngLat
    })(), 10)
    expect(yyc?.name).toMatch(/^\d\d[LRC]?\/\d\d[LRC]?$/)
  })

  it('returns null for an unknown airport', () => {
    expect(runwayAt('ZZZ', mid, 10)).toBeNull()
  })
})

describe('formatRunwaySize', () => {
  it('formats feet and metres', () => {
    expect(formatRunwaySize({ lengthFt: 12079, widthFt: 200 }, false)).toBe('12,079 × 200 ft')
    expect(formatRunwaySize({ lengthFt: 12079, widthFt: 200 }, true)).toBe('3,682 × 61 m')
    expect(formatRunwaySize({ lengthFt: 9000, widthFt: null }, false)).toBe('9,000 ft')
    expect(formatRunwaySize({ lengthFt: null, widthFt: 150 }, false)).toBeNull()
  })
})

describe('liveRunwayStatus', () => {
  const facts = { ends: [{ ident: '4L', headingDeg: 31, displacedFt: 0 }, { ident: '22R', headingDeg: 211, displacedFt: 0 }] as RunwayFacts['ends'] }
  const use = (ident: string, role: RunwayUse['role'], arr = 0, dep = 0): RunwayUse => ({ ident, role, arrivals: arr, departures: dep, arrivalCount: arr, departureCount: dep })
  const traffic = (runways: RunwayUse[]): ActiveRunways => ({ runways, landing: [], departing: [], favoured: [], basis: 'traffic' })

  it('says what the runway is used for and how busy it has been', () => {
    const s = liveRunwayStatus(facts, traffic([use('22R', 'both', 3, 1), use('31L', 'departures', 0, 2)]))
    expect(s).toEqual({ tone: 'active', ends: [{ ident: '22R', role: 'both' }], text: 'In use for landings and departures on 22R (3 arrivals, 1 departure in the last 20 min)' })
  })

  it('says when other runways are in use but this one is not', () => {
    expect(liveRunwayStatus(facts, traffic([use('31L', 'departures', 0, 2)]))?.tone).toBe('idle')
  })

  it('passes on the wind’s guess, labelled as one', () => {
    const wind: ActiveRunways = { runways: [], landing: [], departing: [], favoured: ['22L', '22R'], basis: 'wind' }
    expect(liveRunwayStatus(facts, wind)?.text).toBe('No traffic seen yet; the wind favours 22R')
    expect(liveRunwayStatus({ ends: [facts.ends[0], { ...facts.ends[0], ident: '4R' }] }, wind)).toBeNull()
  })

  it('credits the ATIS when that is all there is', () => {
    const atis: ActiveRunways = { runways: [use('22R', 'arrivals'), use('31L', 'departures')], landing: ['22R'], departing: ['31L'], favoured: [], basis: 'atis' }
    expect(liveRunwayStatus(facts, atis)?.text).toBe('The ATIS has it in use for landings on 22R')
    expect(liveRunwayStatus({ ends: [{ ...facts.ends[0], ident: '13L' }, { ...facts.ends[0], ident: '31R' }] }, atis)?.text).toBe('Not in use, per the ATIS')
  })

  it('says nothing without data', () => {
    expect(liveRunwayStatus(facts, null)).toBeNull()
    expect(liveRunwayStatus(facts, { runways: [], landing: [], departing: [], favoured: [], basis: 'none' })).toBeNull()
  })
})
