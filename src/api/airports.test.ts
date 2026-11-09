import { describe, expect, it } from 'vitest'
import { AIRPORTS, DEFAULT_AIRPORT, getAirport, getAirportBbox, airportsByGroup } from './airports'

describe('airports catalog', () => {
  it('defaults to ORD', () => {
    expect(DEFAULT_AIRPORT).toBe('ORD')
    expect(getAirport('unknown').icao).toBe('ORD')
  })

  it('includes required US and Canada codes', () => {
    const codes = new Set(AIRPORTS.map((a) => a.icao))
    for (const c of [
      'ATL', 'LAX', 'DFW', 'DEN', 'ORD', 'JFK', 'MCO', 'LAS', 'CLT', 'MIA',
      'SEA', 'EWR', 'SFO', 'PHX', 'IAH', 'LGA',
      'YYZ', 'YVR', 'YUL', 'YYC', 'YEG',
    ]) {
      expect(codes.has(c)).toBe(true)
    }
  })

  it('groups US vs Canada', () => {
    const g = airportsByGroup()
    expect(g.US.every((a) => a.group === 'US')).toBe(true)
    expect(g.Canada.every((a) => a.group === 'Canada')).toBe(true)
    expect(g.US).toHaveLength(29)
    expect(g.Canada).toHaveLength(8)
  })

  it('positions snapshot-driven airports on their runway complex', () => {
    const bos = getAirport('BOS')
    expect(bos.center[1]).toBeCloseTo(42.36, 1)
    expect(bos.center[0]).toBeCloseTo(-71.01, 1)
    expect(bos.elevationFt).toBe(20)
    expect(bos.stations.find((s) => s.kind === 'TWR')?.frequencyMhz).toBeGreaterThan(118)
  })

  it('each airport has bbox, center, zoom, and ≥1 station', () => {
    for (const a of AIRPORTS) {
      expect(a.bounds[1][0]).toBeGreaterThan(a.bounds[0][0])
      expect(a.bounds[1][1]).toBeGreaterThan(a.bounds[0][1])
      // The camera frame must contain the traffic query centre.
      expect(a.center[0]).toBeGreaterThan(a.bounds[0][0] - 0.05)
      expect(a.center[0]).toBeLessThan(a.bounds[1][0] + 0.05)
      expect(a.bbox.lamax).toBeGreaterThan(a.bbox.lamin)
      expect(a.bbox.lomax).toBeGreaterThan(a.bbox.lomin)
      expect(a.center).toHaveLength(2)
      expect(a.zoom).toBeGreaterThan(8)
      expect(a.stations.length).toBeGreaterThanOrEqual(1)
      expect(a.stations.every((s) => s.airport === a.icao)).toBe(true)
    }
  })

  it('attaches a published tower frequency', () => {
    const tower = getAirport('ORD').stations.find((s) => s.kind === 'TWR')
    expect(tower?.frequencyMhz).toBe(126.9)
    const ground = getAirport('ORD').stations.find((s) => s.kind === 'GND')
    expect(ground?.frequencyMhz).toBe(121.675)
  })

  it('resolves bbox by icao', () => {
    const b = getAirportBbox('lga')
    expect(b.lamin).toBeLessThan(40.78)
    expect(b.lamax).toBeGreaterThan(40.77)
  })
})
