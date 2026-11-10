import { describe, expect, it } from 'vitest'
import { headingDelta, inBox, SendGate, type GateItem, type GateOptions } from './sendGate'

const OPTS: GateOptions = { motionPx: 0.5, minSendMs: 0, maxStaleMs: 1000 }
/** Ground metres per screen pixel used throughout (about zoom 13 at mid latitudes). */
const MPP = 7
/** Degrees of latitude for `m` metres. */
const north = (m: number) => m / 110_540

function item(over: Partial<GateItem> = {}): GateItem {
  return { id: 'a', lon: -73.78, lat: 40.64, shadow: null, heading: 90, reachPx: 20, scale: 1, o: 1, eo: 1, key: 'k', vis: true, ...over }
}

/** A gate that has already sent `items` at time 0. */
function sentWith(items: GateItem[]): SendGate {
  const g = new SendGate()
  expect(g.check(items, 0, MPP, OPTS)).toBe('first')
  g.commit(items, 0)
  return g
}

describe('SendGate', () => {
  it('skips a frame where nothing changed', () => {
    const g = sentWith([item()])
    expect(g.check([item()], 16, MPP, OPTS)).toBeNull()
  })

  it('sends once an aircraft has moved far enough on screen, not before', () => {
    const g = sentWith([item()])
    // A fifth of a pixel: invisible.
    expect(g.check([item({ lat: 40.64 + north(0.2 * MPP) })], 16, MPP, OPTS)).toBeNull()
    expect(g.check([item({ lat: 40.64 + north(0.6 * MPP) })], 32, MPP, OPTS)).toBe('motion')
  })

  it('measures motion against what was last sent, so slow movement adds up', () => {
    const g = sentWith([item()])
    let reason = null
    let t = 0
    for (let i = 1; i <= 10 && !reason; i++) {
      t += 16
      reason = g.check([item({ lat: 40.64 + north(0.1 * MPP * i) })], t, MPP, OPTS)
    }
    expect(reason).toBe('motion')
    // Half a pixel in tenths: the fifth or sixth frame (floating point decides which).
    expect(t).toBeGreaterThanOrEqual(16 * 5)
    expect(t).toBeLessThanOrEqual(16 * 6)
  })

  it('counts a turn by how far it swings the artwork', () => {
    const g = sentWith([item()])
    // 1 degree on a 20 px lever is 0.35 px; 2 degrees is 0.7 px.
    expect(g.check([item({ heading: 91 })], 16, MPP, OPTS)).toBeNull()
    expect(g.check([item({ heading: 92 })], 16, MPP, OPTS)).toBe('motion')
    // Across north too.
    const h = sentWith([item({ heading: 359 })])
    expect(h.check([item({ heading: 1 })], 16, MPP, OPTS)).toBe('motion')
  })

  it('counts a shadow moving, and scaling, and fading', () => {
    const s = sentWith([item({ shadow: [-73.78, 40.64] })])
    expect(s.check([item({ shadow: [-73.78, 40.64 + north(MPP)] })], 16, MPP, OPTS)).toBe('motion')
    const g = sentWith([item()])
    expect(g.check([item({ scale: 1.01 })], 16, MPP, OPTS)).toBeNull()
    expect(g.check([item({ scale: 1.05 })], 16, MPP, OPTS)).toBe('motion')
    expect(g.check([item({ o: 0.99 })], 16, MPP, OPTS)).toBeNull()
    expect(g.check([item({ o: 0.9 })], 16, MPP, OPTS)).toBe('fade')
    expect(g.check([item({ eo: 0.9 })], 16, MPP, OPTS)).toBe('fade')
  })

  it('sends any change to what is drawn at once, even inside the motion interval', () => {
    const g = sentWith([item()])
    const opts = { ...OPTS, minSendMs: 100 }
    expect(g.check([item({ key: 'selected' })], 5, MPP, opts)).toBe('key')
    expect(g.check([item({ shadow: [-73.78, 40.64] })], 5, MPP, opts)).toBe('key')
    // Motion alone waits for the interval.
    expect(g.check([item({ lat: 40.65 })], 5, MPP, opts)).toBeNull()
    expect(g.check([item({ lat: 40.65 })], 100, MPP, opts)).toBe('motion')
  })

  it('sends when aircraft arrive, leave or are swapped', () => {
    const g = sentWith([item()])
    expect(g.check([item(), item({ id: 'b' })], 16, MPP, OPTS)).toBe('set')
    expect(g.check([], 16, MPP, OPTS)).toBe('set')
    expect(g.check([item({ id: 'b' })], 16, MPP, OPTS)).toBe('set')
  })

  it('ignores what happens off screen until the aircraft comes into view', () => {
    const g = sentWith([item({ vis: false })])
    expect(g.check([item({ vis: false, lat: 41, key: 'other', heading: 200 })], 16, MPP, OPTS)).toBeNull()
    expect(g.check([item({ vis: true, lat: 41 })], 32, MPP, OPTS)).toBe('view')
  })

  it('re-sends everything after a while whatever happens', () => {
    const g = sentWith([item({ vis: false })])
    expect(g.check([item({ vis: false, lat: 41 })], 999, MPP, OPTS)).toBeNull()
    expect(g.check([item({ vis: false, lat: 41 })], 1000, MPP, OPTS)).toBe('stale')
  })

  it('scales the threshold with zoom: the same ground distance is more pixels closer in', () => {
    const g = sentWith([item()])
    const moved = [item({ lat: 40.64 + north(2) })]
    // 2 m at 7 m/px is 0.29 px; at 1 m/px (zoomed in) it is 2 px.
    expect(g.check(moved, 16, 7, OPTS)).toBeNull()
    expect(g.check(moved, 16, 1, OPTS)).toBe('motion')
  })

  it('starts over after a reset', () => {
    const g = sentWith([item()])
    g.reset()
    expect(g.check([item()], 16, MPP, OPTS)).toBe('first')
  })
})

describe('helpers', () => {
  it('headingDelta is the short way round', () => {
    expect(headingDelta(10, 350)).toBe(20)
    expect(headingDelta(350, 10)).toBe(20)
    expect(headingDelta(90, 90)).toBe(0)
    expect(headingDelta(0, 180)).toBe(180)
  })

  it('inBox grows the box by a margin on every side', () => {
    const box = { west: 0, south: 0, east: 10, north: 10 }
    expect(inBox(5, 5, box, 0)).toBe(true)
    expect(inBox(10.5, 5, box, 0)).toBe(false)
    expect(inBox(10.5, 5, box, 0.1)).toBe(true)
    expect(inBox(5, -1.5, box, 0.1)).toBe(false)
  })
})
