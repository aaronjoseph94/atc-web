import { describe, expect, it } from 'vitest'
import {
  aircraftTypeName,
  compassDirection,
  describeCallsign,
  digitsFromWords,
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

describe('digitsFromWords', () => {
  it('reads runways, frequencies and altitudes through punctuation', () => {
    expect(digitsFromWords('runway two eight right, cleared for takeoff.')).toBe('runway 28R cleared for takeoff')
    expect(digitsFromWords('contact departure one two five point zero')).toBe('contact departure 125.0')
    expect(digitsFromWords('climb and maintain two thousand')).toBe('climb and maintain 2000')
    expect(digitsFromWords('maintain two thousand five hundred')).toBe('maintain 2500')
    expect(digitsFromWords('descend and maintain one zero thousand')).toBe('descend and maintain 10000')
  })
})

describe('explainTransmission', () => {
  it('finds the runway whether it comes before or after the instruction', () => {
    expect(explainTransmission({ text: 'American five forty, runway two eight right, line up and wait.' })).toBe(
      'Move onto runway 28R and wait there for takeoff clearance.',
    )
    expect(explainTransmission({ speaker: 'Pilot', text: 'Cleared to land two two left, Delta four eighteen.' })).toContain('22L')
  })

  it('explains a go-around and an altitude in thousands', () => {
    expect(explainTransmission({ text: 'Speedbird one seven three heavy, go around. Traffic still on the runway.' })).toMatch(/Abort the landing/)
    expect(explainTransmission({ text: 'climb and maintain two thousand' })).toBe('Climb to 2,000 ft.')
  })

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

describe('flightPhase low over the field', () => {
  it('calls a level aircraft just above the runway landing, not flying level', () => {
    expect(flightPhase({ onGround: false, speedKt: 135, altitudeFt: 40, verticalRateFpm: -64 })).toBe('final')
    expect(flightPhase({ onGround: false, speedKt: 140, altitudeFt: 300, verticalRateFpm: 0 })).toBe('final')
    expect(flightPhase({ onGround: false, speedKt: 150, altitudeFt: 200, verticalRateFpm: 128 })).toBe('takeoff')
  })
  it('leaves hovering helicopters and higher level flight alone', () => {
    expect(flightPhase({ onGround: false, speedKt: 20, altitudeFt: 300, verticalRateFpm: 0, category: 'A7' })).toBe('level')
    expect(flightPhase({ onGround: false, speedKt: 250, altitudeFt: 3000, verticalRateFpm: 0 })).toBe('level')
  })
})
