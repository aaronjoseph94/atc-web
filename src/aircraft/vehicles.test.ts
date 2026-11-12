import { describe, expect, it } from 'vitest'
import { VEHICLE_KINDS, VEHICLE_MAX_LENGTH, VEHICLE_SIZE, vehicleDrawScale, vehicleKind } from './vehicles'

describe('vehicleKind', () => {
  it('draws emergency vehicles as fire engines', () => {
    expect(vehicleKind({ category: 'C1', callsign: 'OPS4' })).toBe('fire')
    expect(vehicleKind({ category: 'C2', callsign: 'FIRE2' })).toBe('fire')
    expect(vehicleKind({ category: 'C2', callsign: 'ARFF 11' })).toBe('fire')
  })

  it('reads tugs and trucks from the callsign', () => {
    expect(vehicleKind({ category: 'C2', callsign: 'TUG12' })).toBe('tug')
    expect(vehicleKind({ category: 'C2', callsign: 'tow 3' })).toBe('tug')
    expect(vehicleKind({ category: 'C2', callsign: 'FUEL7' })).toBe('truck')
    expect(vehicleKind({ category: 'C2', callsign: 'SWEEPER1' })).toBe('truck')
  })

  it('falls back to the operations car', () => {
    expect(vehicleKind({ category: 'C2', callsign: 'OPS1' })).toBe('car')
    expect(vehicleKind({ category: 'C2', callsign: 'C176' })).toBe('car')
    expect(vehicleKind({ category: null, callsign: null })).toBe('car')
    expect(vehicleKind({})).toBe('car')
  })
})

describe('vehicle sizes', () => {
  it('keeps real proportions between kinds, compressed so the car stays readable', () => {
    expect(VEHICLE_MAX_LENGTH).toBe(VEHICLE_SIZE.fire.length)
    expect(vehicleDrawScale('fire')).toBe(1)
    const order = [...VEHICLE_KINDS].sort((a, b) => VEHICLE_SIZE[a].length - VEHICLE_SIZE[b].length)
    for (let i = 1; i < order.length; i++) expect(vehicleDrawScale(order[i])).toBeGreaterThanOrEqual(vehicleDrawScale(order[i - 1]))
    // Smaller than the fire engine, but drawn bigger than true scale would make it.
    expect(vehicleDrawScale('car')).toBeLessThan(0.75)
    expect(vehicleDrawScale('car')).toBeGreaterThan(VEHICLE_SIZE.car.length / VEHICLE_MAX_LENGTH)
    // Every vehicle is longer than it is wide, and plausibly sized.
    for (const k of VEHICLE_KINDS) {
      expect(VEHICLE_SIZE[k].length).toBeGreaterThan(VEHICLE_SIZE[k].width * 2)
      expect(VEHICLE_SIZE[k].width).toBeLessThanOrEqual(3.2)
    }
  })
})
