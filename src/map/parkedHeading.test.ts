import { describe, expect, it } from 'vitest'
import { offset, type LngLat } from './geo'
import { noseInHeading, wantsGuess } from './parkedHeading'

const origin: LngLat = [-73.78, 40.64]
/** A building as a rectangle of `w`×`h` metres with its south-west corner `e`,`n` metres from the origin. */
const box = (e: number, n: number, w: number, h: number): LngLat[] => [offset(origin, e, n), offset(origin, e + w, n), offset(origin, e + w, n + h), offset(origin, e, n + h), offset(origin, e, n)]

describe('noseInHeading', () => {
  it('points the aircraft at the nearest building face', () => {
    // Terminal 30 m north: nose north.
    expect(noseInHeading(origin, [box(-100, 30, 200, 60)])).toBeCloseTo(0, 0)
    // Terminal 25 m east: nose east.
    expect(noseInHeading(origin, [box(25, -100, 60, 200)])).toBeCloseTo(90, 0)
  })

  it('has no guess without a building close by', () => {
    expect(noseInHeading(origin, [box(400, 400, 50, 50)])).toBeNull()
    expect(noseInHeading(origin, [])).toBeNull()
  })
})

describe('wantsGuess', () => {
  it('only for parked aircraft with no reported heading', () => {
    expect(wantsGuess({ headingKnown: false, onGround: true, speedKt: 0 })).toBe(true)
    expect(wantsGuess({ headingKnown: true, onGround: true, speedKt: 0 })).toBe(false)
    expect(wantsGuess({ headingKnown: false, onGround: true, speedKt: 12 })).toBe(false)
    expect(wantsGuess({ headingKnown: false, onGround: false, speedKt: 0 })).toBe(false)
    expect(wantsGuess({ headingKnown: false, onGround: true, speedKt: 0, category: 'C2' })).toBe(false)
  })
})
