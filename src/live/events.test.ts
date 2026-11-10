import { describe, expect, it } from 'vitest'
import type { Aircraft } from '../api/types'
import { runwayEnds } from '../map/airportDiagram'
import { offset } from '../map/geo'
import { describeRelation, detectEvents, runwayRelation, runwaysInUse, type EventState } from './events'
import { LiveRecorder } from './recorder'

const ELEV = 680
const ends = runwayEnds('ORD')
const rwy = ends.find((e) => e.ident === '28R')!
const rad = (rwy.bearing * Math.PI) / 180

/** A point `along` metres past the 28R threshold (negative = on approach), `cross` metres right. */
const at = (along: number, cross = 0) => offset(rwy.threshold, Math.sin(rad) * along + Math.cos(rad) * cross, Math.cos(rad) * along - Math.sin(rad) * cross)

const ac = (over: Partial<Aircraft> & { pos: [number, number] }): Aircraft => ({
  icao24: 'a1',
  callsign: 'UAL2099',
  lon: over.pos[0],
  lat: over.pos[1],
  heading: rwy.bearing,
  altitudeFt: ELEV,
  speedKt: 0,
  onGround: true,
  ...over,
})

describe('runwayRelation', () => {
  it('recognises an aircraft on final and how far out it is', () => {
    const rel = runwayRelation(ac({ pos: at(-3 * 1852), onGround: false, altitudeFt: ELEV + 950, speedKt: 140 }), ends, ELEV)
    expect(rel).toMatchObject({ kind: 'final', runway: '28R' })
    expect(rel?.kind === 'final' && rel.distanceNm).toBeCloseTo(3, 1)
  })

  it('ignores an aircraft crossing the centreline high or at an angle', () => {
    expect(runwayRelation(ac({ pos: at(-3 * 1852), onGround: false, altitudeFt: ELEV + 9000, speedKt: 250 }), ends, ELEV)).toBeNull()
    expect(runwayRelation(ac({ pos: at(-3 * 1852), onGround: false, altitudeFt: ELEV + 900, heading: (rwy.bearing + 90) % 360 }), ends, ELEV)).toBeNull()
  })

  it('recognises an aircraft on the runway, and describes both', () => {
    const on = ac({ pos: at(800), speedKt: 110 })
    expect(runwayRelation(on, ends, ELEV)).toEqual({ kind: 'on', runway: '28R' })
    expect(describeRelation(runwayRelation(on, ends, ELEV), on, ELEV)).toBe('Rolling on runway 28R')
    const fin = ac({ pos: at(-2.2 * 1852), onGround: false, altitudeFt: ELEV + 700 })
    expect(describeRelation(runwayRelation(fin, ends, ELEV), fin, ELEV)).toBe('On final for runway 28R, 2.2 nm out, 700 ft above the field')
  })
})

describe('detectEvents', () => {
  const run = (frames: Aircraft[][]) => {
    const state: EventState = new Map()
    return frames.flatMap((f, i) => detectEvents(state, f, ends, ELEV, 1_000_000 + i * 8000))
  }

  it('logs lining up, then the takeoff, with the runway', () => {
    const events = run([
      [ac({ pos: at(-80, 90), heading: (rwy.bearing + 90) % 360, speedKt: 8 })], // taxiing toward the runway
      [ac({ pos: at(60), speedKt: 0 })], // lined up
      [ac({ pos: at(900), speedKt: 120 })], // rolling
      [ac({ pos: at(2600), onGround: false, altitudeFt: ELEV + 300, speedKt: 160, verticalRateFpm: 2200 })],
    ])
    expect(events.map((e) => [e.kind, e.runway])).toEqual([
      ['lineup', '28R'],
      ['departed', '28R'],
    ])
    expect(events[1].text).toBe('United flight 2099 took off from runway 28R.')
  })

  it('logs a landing once, and does not call the rollout "lined up"', () => {
    const events = run([
      [ac({ pos: at(-2 * 1852), onGround: false, altitudeFt: ELEV + 640, speedKt: 140, verticalRateFpm: -700 })],
      [ac({ pos: at(-400), onGround: false, altitudeFt: ELEV + 60, speedKt: 135, verticalRateFpm: -650 })],
      [ac({ pos: at(700), speedKt: 95 })],
      [ac({ pos: at(1500), speedKt: 18 })],
      [ac({ pos: at(1560), speedKt: 12 })],
    ])
    expect(events.map((e) => e.kind)).toEqual(['landed'])
    expect(events[0].text).toBe('United flight 2099 landed on runway 28R.')
  })

  it('logs a go-around when a low approach turns into a climb', () => {
    const events = run([
      [ac({ pos: at(-1.5 * 1852), onGround: false, altitudeFt: ELEV + 480, speedKt: 140, verticalRateFpm: -700 })],
      [ac({ pos: at(-500), onGround: false, altitudeFt: ELEV + 260, speedKt: 138, verticalRateFpm: -600 })],
      [ac({ pos: at(900), onGround: false, altitudeFt: ELEV + 900, speedKt: 150, verticalRateFpm: 2400 })],
    ])
    expect(events.map((e) => [e.kind, e.runway])).toEqual([['goaround', '28R']])
  })

  it('announces an emergency squawk once, and ignores ground vehicles', () => {
    const state: EventState = new Map()
    const plane = ac({ pos: at(-9000), onGround: false, altitudeFt: 9000, squawk: '7700' })
    const tug = ac({ pos: at(100), icao24: 'v1', callsign: 'TUG7', category: 'C2', speedKt: 80 })
    const first = detectEvents(state, [plane, tug], ends, ELEV, 1)
    const second = detectEvents(state, [plane, { ...tug, onGround: false }], ends, ELEV, 2)
    expect(first.map((e) => e.kind)).toEqual(['emergency'])
    expect(second).toEqual([])
  })

  it('summarises which runways are in use', () => {
    const events = run([
      [ac({ pos: at(60), speedKt: 0 })],
      [ac({ pos: at(900), speedKt: 120 })],
      [ac({ pos: at(2600), onGround: false, altitudeFt: ELEV + 300, speedKt: 160 })],
    ])
    expect(runwaysInUse(events, 0)).toEqual({ landing: [], departing: ['28R'] })
  })
})

describe('LiveRecorder', () => {
  it('turns recorded polls into a replay keyed by transponder address', () => {
    const r = new LiveRecorder()
    const t0 = 1_700_000_000_000
    expect(r.toClip('ORD', 'ord-tower', t0)).toBeNull()
    for (let i = 0; i <= 5; i++) r.push([ac({ pos: at(i * 300), speedKt: 100, type: 'B738' })], t0 + i * 8000)
    r.addEvents([{ id: 'e1', at: t0 + 16000, kind: 'departed', icao24: 'a1', callsign: 'UAL2099', runway: '28R', text: 'x', lon: 0, lat: 0 }])
    const clip = r.toClip('ORD', 'ord-tower', t0 + 40000)!
    expect(clip).toMatchObject({ kind: 'rewind', startedAt: t0, durationMs: 40000, audioUrl: '' })
    expect(clip.tracks.a1).toHaveLength(6)
    expect(clip.tracks.a1[5].tMs).toBe(40000)
    expect(clip.aircraft?.a1).toMatchObject({ callsign: 'UAL2099', type: 'B738' })
    expect(clip.cues).toMatchObject([{ startMs: 16000, callsign: 'a1', speaker: 'Tower log' }])
  })

  it('stores a parked aircraft as a span, not one sample per poll', () => {
    const r = new LiveRecorder()
    for (let i = 0; i < 50; i++) r.push([ac({ pos: at(-200, 300) })], 1000 + i * 8000)
    expect(r.series('a1')).toHaveLength(2)
    expect(r.spanMs(1000 + 49 * 8000)).toBe(49 * 8000)
  })
})
