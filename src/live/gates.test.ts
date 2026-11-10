import { describe, expect, it } from 'vitest'
import type { Aircraft } from '../api/types'
import { offset, type LngLat } from '../map/geo'
import { describeGate, dominantColour, formatParked, gateFit, matchGates, PARKED_MS, textOn, trackParking, type Gate, type ParkingState } from './gates'

const ORIGIN: LngLat = [-84.4277, 33.6407]
const T0 = 1_700_000_000_000
const MIN = 60_000

const ac = (over: Partial<Aircraft> & { pos?: LngLat } = {}): Aircraft => {
  const pos = over.pos ?? ORIGIN
  return { icao24: 'a1', callsign: 'DAL288', lon: pos[0], lat: pos[1], heading: 0, altitudeFt: 1000, speedKt: 0, onGround: true, type: 'A321', ...over }
}
const gate = (id: string, east: number, north: number, ref = id): Gate => {
  const [lon, lat] = offset(ORIGIN, east, north)
  return { id, ref, lon, lat }
}

describe('trackParking', () => {
  it('counts an aircraft as parked after two minutes standing still', () => {
    const s: ParkingState = new Map()
    expect(trackParking(s, [ac()], T0)).toEqual([])
    expect(trackParking(s, [ac()], T0 + MIN)).toEqual([])
    const parked = trackParking(s, [ac()], T0 + PARKED_MS)
    expect(parked).toHaveLength(1)
    expect(parked[0]).toMatchObject({ since: T0, before: false })
  })

  it('starts over when the aircraft moves or speeds up', () => {
    const s: ParkingState = new Map()
    trackParking(s, [ac()], T0)
    trackParking(s, [ac({ speedKt: 8 })], T0 + MIN)
    expect(trackParking(s, [ac()], T0 + 2.5 * MIN)).toEqual([])
    trackParking(s, [ac({ pos: offset(ORIGIN, 40, 0) })], T0 + 3 * MIN)
    expect(trackParking(s, [ac({ pos: offset(ORIGIN, 40, 0) })], T0 + 4.5 * MIN)).toEqual([])
  })

  it('treats a missing speed as standing still, and ignores position jitter', () => {
    const s: ParkingState = new Map()
    trackParking(s, [ac({ speedKt: null })], T0)
    expect(trackParking(s, [ac({ speedKt: null, pos: offset(ORIGIN, 6, -4) })], T0 + PARKED_MS)).toHaveLength(1)
  })

  it('never parks airborne aircraft or ground vehicles', () => {
    const s: ParkingState = new Map()
    trackParking(s, [ac({ onGround: false, speedKt: 0 }), ac({ icao24: 'v', category: 'C1' })], T0)
    expect(trackParking(s, [ac({ onGround: false, speedKt: 0 }), ac({ icao24: 'v', category: 'C1' })], T0 + 3 * MIN)).toEqual([])
  })

  it('marks aircraft already standing at the start of a session', () => {
    const s: ParkingState = new Map()
    trackParking(s, [ac()], T0, true)
    expect(trackParking(s, [ac()], T0 + PARKED_MS)[0].before).toBe(true)
  })

  it('forgets aircraft gone from the feed', () => {
    const s: ParkingState = new Map()
    trackParking(s, [ac()], T0)
    trackParking(s, [], T0 + 2 * MIN)
    expect(s.size).toBe(0)
  })
})

describe('gateFit and matchGates', () => {
  const parked = (over: Partial<Aircraft> & { pos?: LngLat } = {}) => ({ aircraft: ac(over), since: T0, before: false })

  it('prefers the gate ahead of the nose over a nearer one behind', () => {
    const ahead = gate('A1', 0, 25)
    const behind = gate('A2', 0, -15)
    expect(gateFit(ac(), behind)).toBeNull()
    const { matches } = matchGates([behind, ahead], [parked()])
    expect(matches[0].gate.id).toBe('A1')
  })

  it('prefers the gate on the nose axis over one off to the side', () => {
    const { matches } = matchGates([gate('B1', 22, 20), gate('B2', 2, 28)], [parked()])
    expect(matches[0].gate.id).toBe('B2')
  })

  it('uses plain distance when the heading is unknown', () => {
    const { matches } = matchGates([gate('C1', 0, -20), gate('C2', 0, 35)], [parked({ headingKnown: false })])
    expect(matches[0].gate.id).toBe('C1')
  })

  it('gives each gate one aircraft and each aircraft one gate', () => {
    const g = [gate('D1', 0, 20), gate('D2', 45, 20)]
    const p = [parked({ icao24: 'x' }), parked({ icao24: 'y', pos: offset(ORIGIN, 45, 0) })]
    const { matches, remote } = matchGates(g, p)
    expect(matches.map((m) => `${m.aircraft.icao24}@${m.gate.id}`).sort()).toEqual(['x@D1', 'y@D2'])
    expect(remote).toEqual([])
  })

  it('leaves aircraft on remote stands unmatched', () => {
    const { matches, remote } = matchGates([gate('E1', 0, 120)], [parked()])
    expect(matches).toEqual([])
    expect(remote).toHaveLength(1)
  })

  it('copes with no gates at all', () => {
    expect(matchGates([], [parked()]).remote).toHaveLength(1)
  })
})

describe('describeGate', () => {
  const match = (over: Partial<Aircraft> = {}, since = T0, before = false) => ({ gate: gate('B22', 0, 20), aircraft: ac(over), since, before, distanceM: 20 })

  it('names the airline, flight, type and how long it has been there', () => {
    expect(describeGate('B22', match(), T0 + 40 * MIN)).toEqual({ title: 'Gate B22', detail: 'Delta DAL288 (A321) · parked 40 min' })
  })

  it('says free when nothing is parked', () => {
    expect(describeGate('B22', null, T0)).toEqual({ title: 'Gate B22', detail: 'Free' })
  })

  it('uses the mainline brand for regional flights', () => {
    expect(describeGate('T1', match({ callsign: 'EDV5155', type: 'CRJ9' }), T0 + 5 * MIN).detail).toBe('Delta EDV5155 (CRJ9) · parked 5 min')
  })

  it('falls back to the registration when the feed only sent the address', () => {
    expect(describeGate('A3', match({ icao24: 'a39e6b', callsign: 'A39E6B', registration: 'N123DL', type: null }), T0 + 3 * MIN).detail).toBe('N123DL · parked 3 min')
  })

  it('marks durations it only knows a lower bound of', () => {
    expect(describeGate('A3', match({}, T0, true), T0 + 12 * MIN).detail).toMatch(/parked 12\+ min$/)
    expect(formatParked(65 * MIN, false)).toBe('1 h 05 min')
  })
})

describe('logo colours', () => {
  const px = (...rgba: number[][]) => rgba.flat()

  it('finds the brand colour of a coloured logo', () => {
    const red = [200, 16, 46, 255]
    const white = [255, 255, 255, 255]
    const c = dominantColour(px(red, red, red, white, white, [0, 0, 0, 0]))
    expect(c).toBe('#c8102e')
  })

  it('takes the commoner of two brand colours rather than mixing them', () => {
    const red = [200, 16, 46, 255]
    const blue = [0, 58, 112, 255]
    expect(dominantColour(px(blue, red, blue, blue))).toBe('#003a70')
  })

  it('gives up on a white or grey logo', () => {
    expect(dominantColour(px([255, 255, 255, 255], [128, 128, 128, 255], [250, 250, 245, 255]))).toBeNull()
    expect(dominantColour([])).toBeNull()
  })

  it('picks readable text for the chip', () => {
    expect(textOn('#FFD200')).toBe('#14161C')
    expect(textOn('#003A70')).toBe('#FFFFFF')
    expect(textOn('#C8102E')).toBe('#FFFFFF')
  })
})
