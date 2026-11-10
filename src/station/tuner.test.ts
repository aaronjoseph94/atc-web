import { describe, expect, it } from 'vitest'
import { getAirport } from '../api/airports'
import type { Station } from '../api/types'
import { settle, tunerStops } from './tuner'

const st = (id: string, f?: number): Station => ({ id, airport: 'KXXX', name: 'X', label: id, position: id, kind: 'TWR', frequencyMhz: f })

describe('tunerStops', () => {
  it('orders channels by frequency, drops ones without and duplicates', () => {
    expect(tunerStops([st('a', 123.9), st('b'), st('c', 119.1), st('d', 123.9)]).map((s) => s.id)).toEqual(['c', 'a'])
  })
  it('gives every busy airport a usable dial', () => {
    for (const icao of ['JFK', 'ORD', 'ATL', 'DEN']) expect(tunerStops(getAirport(icao).stations).length).toBeGreaterThan(2)
  })
})

describe('settle', () => {
  it('snaps to the nearest channel and stays within the dial', () => {
    expect(settle(2, -80, 0, 5)).toBe(3)
    expect(settle(2, 30, 0, 5)).toBe(2)
    expect(settle(0, 500, 0, 5)).toBe(0)
    expect(settle(4, -500, 0, 5)).toBe(4)
  })
  it('carries a flick a little further', () => {
    expect(settle(1, -20, -0.8, 5)).toBe(3)
  })
})
