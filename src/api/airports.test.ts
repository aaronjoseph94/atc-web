import { describe, expect, it } from 'vitest'
import { AIRPORTS, DEFAULT_AIRPORT, airportForStation, airportsByGroup, defaultStation, getAirport, getAirportBbox, resolveStation } from './airports'

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

  it('marks the desert airports as arid', () => {
    expect(AIRPORTS.filter((a) => a.arid).map((a) => a.icao).sort()).toEqual(['LAS', 'PHX', 'SLC'])
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

  it('lists one tower per runway where the FAA publishes them', () => {
    const ord = getAirport('ORD')
    const tower = ord.stations.find((s) => s.kind === 'TWR' && s.position.includes('10L-28R'))
    expect(tower).toMatchObject({ frequencyMhz: 132.7, label: 'Tower (Rwy 10L-28R)' })
    expect(ord.stations.find((s) => s.position === 'Center Inbound')).toMatchObject({ kind: 'GND', frequencyMhz: 121.9 })
    expect(new Set(ord.stations.map((s) => s.id)).size).toBe(ord.stations.length)
    // Groups come out in channel-switcher order: towers first.
    expect(ord.stations[0].kind).toBe('TWR')
    expect(defaultStation(ord)?.kind).toBe('TWR')
  })

  it('resolves legacy and unknown station ids', () => {
    const ord = getAirport('ORD')
    expect(resolveStation(ord, 'ord-tower-28r')?.position).toContain('28R')
    expect(resolveStation(ord, 'ord-ground-south')?.kind).toBe('GND')
    expect(resolveStation(ord, 'nonsense')?.kind).toBe('TWR')
    expect(resolveStation(getAirport('JFK'), 'jfk-tower')?.kind).toBe('TWR')
    // The JFK replay scene lands on 22L, which has its own tower frequency.
    expect(resolveStation(getAirport('JFK'), 'jfk-tower-22l')?.position).toContain('22L')
    expect(airportForStation('sfo-tower')?.icao).toBe('SFO')
    expect(airportForStation(ord.stations[3].id)?.icao).toBe('ORD')
  })

  it('still gives airports outside the FAA data a tower and ground', () => {
    const yyz = getAirport('YYZ')
    expect(yyz.stations.some((s) => s.kind === 'TWR')).toBe(true)
    expect(yyz.stations.some((s) => s.kind === 'GND')).toBe(true)
  })

  it('resolves bbox by icao', () => {
    const b = getAirportBbox('lga')
    expect(b.lamin).toBeLessThan(40.78)
    expect(b.lamax).toBeGreaterThan(40.77)
  })
})

describe('Calgary positions', () => {
  it('names the west and east tower and ground channels', () => {
    const labels = getAirport('YYC').stations.map((s) => `${s.label} ${s.frequencyMhz}`)
    expect(labels).toContain('Tower (West) 118.4')
    expect(labels).toContain('Tower (East) 118.875')
    expect(labels).toContain('Ground (West) 121.9')
    expect(labels).toContain('Ground (East) 125.35')
  })
})
