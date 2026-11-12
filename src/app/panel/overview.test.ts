import { describe, expect, it } from 'vitest'
import type { Aircraft } from '../../api/types'
import { agoShort, badgeText, countTraffic, sameCounts, trafficGroup, unreadCalls, NO_TRAFFIC } from './overview'

const ac = (p: Partial<Aircraft>): Aircraft => ({ icao24: 'abc123', callsign: 'TST1', lat: 40.64, lon: -73.78, heading: 0, altitudeFt: 0, speedKt: 0, onGround: true, ...p })

describe('trafficGroup', () => {
  it('sorts phases into what a watcher cares about', () => {
    expect(trafficGroup('parked', false)).toBe('Parked')
    expect(trafficGroup('taxiing', false)).toBe('Taxiing')
    expect(trafficGroup('rolling', false)).toBe('Taxiing')
    expect(trafficGroup('final', false)).toBe('Arriving')
    expect(trafficGroup('descending', false)).toBe('Arriving')
    expect(trafficGroup('takeoff', false)).toBe('Departing')
    expect(trafficGroup('climbing', false)).toBe('Departing')
    expect(trafficGroup('cruising', false)).toBe('Passing through')
  })
  it('counts anything lined up on final as arriving, whatever its vertical rate says', () => {
    expect(trafficGroup('level', true)).toBe('Arriving')
    expect(trafficGroup('level', false)).toBe('Passing through')
  })
})

describe('countTraffic', () => {
  it('counts each group and leaves ground vehicles out', () => {
    const list = [
      ac({ icao24: 'a', onGround: true, speedKt: 0 }),
      ac({ icao24: 'b', onGround: true, speedKt: 0 }),
      ac({ icao24: 'c', onGround: true, speedKt: 14 }),
      ac({ icao24: 'd', onGround: false, altitudeFt: 1500, verticalRateFpm: -700, speedKt: 140 }),
      ac({ icao24: 'e', onGround: false, altitudeFt: 2400, verticalRateFpm: 1800, speedKt: 190 }),
      ac({ icao24: 'f', onGround: false, altitudeFt: 12000, verticalRateFpm: 0, speedKt: 300 }),
      ac({ icao24: 'g', onGround: true, speedKt: 9, category: 'C2' }),
    ]
    expect(countTraffic(list, [], 13)).toEqual({ arriving: 1, departing: 1, taxiing: 1, parked: 2, passing: 1, total: 6 })
  })
  it('is all zeros for an empty sky', () => {
    expect(countTraffic([], [], 0)).toEqual(NO_TRAFFIC)
    expect(sameCounts(countTraffic([], [], 0), NO_TRAFFIC)).toBe(true)
    expect(sameCounts({ ...NO_TRAFFIC, parked: 1, total: 1 }, NO_TRAFFIC)).toBe(false)
  })
})

describe('unreadCalls', () => {
  const entries = [
    { source: 'radio', at: 100 },
    { source: 'event', at: 200 },
    { source: 'radio', at: 300 },
    { source: 'radio', at: 400 },
    { source: 'event', at: 500 },
  ]
  it('counts radio calls after the moment the tab was last seen', () => {
    expect(unreadCalls(entries, 0)).toBe(3)
    expect(unreadCalls(entries, 250)).toBe(2)
    expect(unreadCalls(entries, 400)).toBe(0)
    expect(unreadCalls([], 0)).toBe(0)
  })
})

describe('badgeText', () => {
  it('shows nothing for zero and caps long counts', () => {
    expect(badgeText(0)).toBeNull()
    expect(badgeText(-2)).toBeNull()
    expect(badgeText(NaN)).toBeNull()
    expect(badgeText(3)).toBe('3')
    expect(badgeText(9)).toBe('9')
    expect(badgeText(10)).toBe('9+')
    expect(badgeText(120, 99)).toBe('99+')
  })
})

describe('agoShort', () => {
  it('rounds to minutes, then gives the time', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0)
    expect(agoShort(now - 20_000, now)).toBe('just now')
    expect(agoShort(now - 4 * 60_000, now)).toBe('4 min ago')
    expect(agoShort(now - 3 * 3_600_000, now)).toMatch(/\d{1,2}:\d{2}/)
  })
})
