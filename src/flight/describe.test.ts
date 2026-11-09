import { describe, expect, it } from 'vitest'
import {
  aircraftTypeName,
  compassDirection,
  describeCallsign,
  explainTransmission,
  flightPhase,
  friendlyFlightName,
  summarizeExchange,
} from './describe'

describe('flightPhase', () => {
  it('treats a still aircraft on the ground as parked', () => {
    expect(flightPhase({ onGround: true, speedKt: 0, altitudeFt: 0, verticalRateFpm: 0 })).toBe('parked')
  })

  it('treats a slow ground aircraft as taxiing', () => {
    expect(flightPhase({ onGround: true, speedKt: 18, altitudeFt: 0, verticalRateFpm: null })).toBe('taxiing')
  })

  it('treats a low climb as takeoff', () => {
    expect(flightPhase({ onGround: false, speedKt: 160, altitudeFt: 900, verticalRateFpm: 1800 })).toBe('takeoff')
  })

  it('treats a high descent as descending', () => {
    expect(flightPhase({ onGround: false, speedKt: 280, altitudeFt: 12000, verticalRateFpm: -900 })).toBe('descending')
  })
})

describe('plain language helpers', () => {
  it('turns headings into compass words', () => {
    expect(compassDirection(280)).toBe('west')
    expect(compassDirection(0)).toBe('north')
  })

  it('names airlines and aircraft types', () => {
    expect(describeCallsign('UAL2099')).toEqual({ airline: 'United', flightNumber: '2099' })
    expect(friendlyFlightName('N123AB')).toBe('N123AB')
    expect(aircraftTypeName('B738')).toBe('Boeing 737-800')
  })
})

describe('explainTransmission', () => {
  it('translates a takeoff clearance', () => {
    const s = explainTransmission({
      speaker: 'Tower',
      text: 'United twenty ninety-nine heavy runway two eight right cleared for takeoff',
    })
    expect(s).toContain('take off')
    expect(s).toContain('28R')
    expect(s?.startsWith('The controller')).toBe(true)
  })

  it('translates a pilot readback', () => {
    const s = explainTransmission({ speaker: 'Pilot', text: 'hold short runway two seven center' })
    expect(s).toContain('27C')
    expect(s).toContain('pilot')
  })

  it('summarizes an exchange and notes the confirmation', () => {
    const s = summarizeExchange([
      { speaker: 'Tower', text: 'cleared for takeoff runway two eight right' },
      { speaker: 'Pilot', text: 'cleared for takeoff two eight right' },
    ])
    expect(s).toContain('28R')
    expect(s).toContain('confirmed')
  })
})
