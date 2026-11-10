import { describe, expect, it } from 'vitest'
import type { Aircraft } from '../api/types'
import { sightingInput } from './aiLine'
import { Spotter, ToastGate, toastText } from './spotter'
import { exportUnknowns, noteUnknowns } from './unknowns'

const plane = (icao24: string, type: string | null, callsign: string, over: Partial<Aircraft> = {}): Aircraft => ({
  icao24,
  callsign,
  type,
  lat: 41.98,
  lon: -87.9,
  heading: 270,
  altitudeFt: 3000,
  speedKt: 160,
  onGround: false,
  verticalRateFpm: -700,
  category: 'A5',
  ...over,
})

describe('Spotter', () => {
  it('keeps the notable aircraft, rarest first, and judges each once', () => {
    const s = new Spotter('ORD', 668)
    const first = s.scan([plane('a1', 'B738', 'UAL1'), plane('a2', 'A124', 'ADB3402'), plane('ae0001', 'C17', 'RCH871')], 1000)
    expect(first.added.map((x) => x.icao24)).toEqual(['ae0001', 'a2'])
    expect(first.added[1]).toMatchObject({ name: 'Antonov An-124 Ruslan', direction: 'inbound', airport: 'ORD', rare: true })
    expect(first.added[1].line).toContain('largest cargo')
    // Same snapshot again: nothing new, nothing re-scored.
    expect(s.scan([plane('a2', 'A124', 'ADB3402')], 2000)).toEqual({ added: [], changed: false })
    expect(s.spots).toHaveLength(2)
    expect(s.seenCount('B738')).toBe(1)
  })

  it('waits for a type unless something else already stands out', () => {
    const s = new Spotter('JFK')
    expect(s.scan([plane('b1', null, 'DAL1')], 0).added).toHaveLength(0)
    expect(s.scan([plane('b1', 'A388', 'DAL1')], 1).added).toHaveLength(1)
    // A VIP callsign is notable before the type arrives.
    expect(s.scan([plane('b2', null, 'SAM44')], 2).added[0].military?.vip).toBe(true)
  })

  it('updates direction and last-seen time of known spots', () => {
    const s = new Spotter('ORD', 668)
    s.scan([plane('a2', 'A124', 'ADB3402')], 0)
    const r = s.scan([plane('a2', 'A124', 'ADB3402', { onGround: true, speedKt: 20, altitudeFt: null, verticalRateFpm: null })], 5000)
    expect(r.changed).toBe(true)
    expect(s.spots[0].direction).toBe('ground')
    expect(s.spots[0].firstAt).toBe(0)
  })

  it('skips ground vehicles', () => {
    const s = new Spotter('ORD')
    expect(s.scan([plane('v1', 'C17', 'TUG1', { category: 'C1' })], 0).added).toHaveLength(0)
  })
})

describe('toasts', () => {
  it('reads like the owner asked', () => {
    expect(toastText({ name: 'Antonov An-124 Ruslan', direction: 'inbound', airport: 'ORD', rare: true, military: null })).toBe('Rare: Antonov An-124 Ruslan inbound to ORD')
    expect(toastText({ name: 'Boeing C-17', direction: 'departing', airport: 'JFK', rare: true, military: { by: 'callsign', operator: null, vip: false } })).toBe('Military: Boeing C-17 departing JFK')
  })

  it('paces them and never repeats an aircraft', () => {
    const g = new ToastGate(120_000, 2, 30 * 60_000)
    expect(g.allow('a', 0)).toBe(true)
    expect(g.allow('b', 60_000)).toBe(false)
    expect(g.allow('a', 200_000)).toBe(false)
    expect(g.allow('b', 200_000)).toBe(true)
    expect(g.allow('c', 400_000)).toBe(false) // two in the window already
    expect(g.allow('c', 31 * 60_000)).toBe(true)
  })
})

describe('AI input', () => {
  it('carries only the type, the airport and stable reasons', () => {
    const s = new Spotter('ORD')
    const [spot] = s.scan([plane('a2', 'A124', 'ADB3402', { registration: 'UR-82072' })], 0).added
    const input = sightingInput(spot)!
    expect(input).toEqual({ type: 'A124', name: 'Antonov An-124 Ruslan', airport: 'ORD', airportName: expect.stringContaining('Hare'), airportClass: 'gateway', reasons: ['Rare here'] })
    expect(JSON.stringify(input)).not.toContain('UR-82072')
    expect(JSON.stringify(input)).not.toContain('ADB3402')
  })
})

describe('unknowns', () => {
  it('tallies types without facts and airline codes nobody knows, never registrations', () => {
    let st = { types: {}, prefixes: {} }
    st = noteUnknowns(st, [plane('1', 'B738', 'DAL1'), plane('2', 'XX12', 'QQQ123'), plane('3', 'XX12', 'N123AB'), plane('4', 'C17', 'RCH1')], 5)
    const out = exportUnknowns(st)
    expect(out.types).toEqual([{ code: 'XX12', count: 2 }])
    expect(out.prefixes).toEqual([{ prefix: 'QQQ', count: 1, example: 'QQQ123' }])
    const same = noteUnknowns(st, [plane('5', 'A320', 'UAL5')], 6)
    expect(same).toBe(st)
  })
})
