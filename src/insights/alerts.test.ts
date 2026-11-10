import { describe, expect, it } from 'vitest'
import type { Aircraft } from '../api/types'
import type { LiveEvent } from '../live/events'
import type { RunwayEndGeometry } from '../map/airportDiagram'
import { admit, BURST, fromCall, fromEvent, watchRolls, watchRunwayDirection, type Alert, type AlertInput, type RollState } from './alerts'
import { ALERT_KINDS, type AlertKind } from './insightSettings'

const ALL = new Set<AlertKind>(ALERT_KINDS.map((k) => k.kind))

/** A runway running due east from (0,0), 3 km long: "9", with "27" at the far end. */
const R9: RunwayEndGeometry = { ident: '9', threshold: [0, 0], bearing: 90, lengthM: 3000, widthM: 45 }
const R27: RunwayEndGeometry = { ident: '27', threshold: [3000 / 111_320, 0], bearing: 270, lengthM: 3000, widthM: 45 }
const ENDS = [R9, R27]

const plane = (over: Partial<Aircraft>): Aircraft => ({ icao24: 'abc123', callsign: 'UAL1534', lat: 0, lon: 0.001, heading: 90, altitudeFt: 0, speedKt: 0, onGround: true, ...over })

const event = (kind: LiveEvent['kind'], at = 1000): LiveEvent => ({ id: `e-${kind}-${at}`, at, kind, icao24: 'abc123', callsign: 'UAL1534', runway: '27L', text: 'United flight 1534 went around at runway 27L and is climbing away.', lon: 0, lat: 0 })

describe('rules', () => {
  it('turns go-arounds and emergencies from the tower log into alerts, and ignores the routine', () => {
    expect(fromEvent(event('goaround'))).toMatchObject({ kind: 'goaround', title: 'Go-around: United flight 1534', runway: '27L', source: 'traffic' })
    expect(fromEvent(event('emergency'))?.kind).toBe('emergency')
    expect(fromEvent(event('landed'))).toBeNull()
    expect(fromEvent(event('departed'))).toBeNull()
  })

  it('hears mayday, pan-pan, go-arounds, rejected takeoffs and diversions on the radio', () => {
    const call = (text: string) => fromCall({ id: 'c', at: 5, text, callsign: 'DAL22', icao24: 'a1', speaker: 'pilot' }).map((a) => a.kind)
    expect(call('Mayday mayday mayday, Delta 22, engine failure')).toEqual(['emergency'])
    expect(call('Pan-pan pan-pan, Delta 22, medical on board')).toEqual(['emergency'])
    expect(call('Delta 22, going around')).toEqual(['goaround'])
    expect(call('Delta 22 rejecting takeoff')).toEqual(['rto'])
    expect(call('we would like to divert to Milwaukee')).toEqual(['diversion'])
    expect(call('Delta 22, runway 27L, cleared to land')).toEqual([])
  })

  it('does not take an instruction for later as a go-around', () => {
    const kinds = fromCall({ id: 'c', at: 5, text: 'in the event of a go around, fly runway heading, climb 3000', callsign: null, icao24: null, speaker: 'controller' }).map((a) => a.kind)
    expect(kinds).toEqual([])
  })
})

describe('rejected takeoff', () => {
  const run = (frames: Partial<Aircraft>[]) => {
    const state: RollState = new Map()
    const out: AlertInput[] = []
    frames.forEach((f, i) => out.push(...watchRolls(state, [plane(f)], ENDS, 0, 1_000_000 + i * 4000)))
    return out
  }

  it('spots a takeoff roll that stops', () => {
    const out = run([{ speedKt: 5 }, { speedKt: 40 }, { speedKt: 80 }, { speedKt: 95 }, { speedKt: 70 }, { speedKt: 50 }])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'rto', runway: '9' })
    expect(out[0].body).toMatch(/reached 95 kt on runway 9/)
  })

  it('leaves a normal takeoff alone', () => {
    expect(run([{ speedKt: 5 }, { speedKt: 60 }, { speedKt: 120 }, { speedKt: 150, onGround: false, altitudeFt: 300 }])).toEqual([])
  })

  it('leaves a landing rollout alone (it was airborne just before)', () => {
    expect(run([{ speedKt: 140, onGround: false, altitudeFt: 100 }, { speedKt: 120 }, { speedKt: 80 }, { speedKt: 40 }, { speedKt: 20 }])).toEqual([])
  })

  it('needs to have seen the roll start: an aircraft first seen fast and slowing is not reported', () => {
    expect(run([{ speedKt: 110 }, { speedKt: 70 }, { speedKt: 30 }])).toEqual([])
  })
})

describe('runway direction', () => {
  const opposite = new Map([
    ['27L', '9R'],
    ['9R', '27L'],
    ['27R', '9L'],
    ['9L', '27R'],
    ['22L', '4R'],
    ['4R', '22L'],
  ])
  it('alerts when the landing runways turn around, not on the first reading or a partial change', () => {
    let r = watchRunwayDirection(null, ['27L', '27R'], opposite, 0)
    expect(r.alert).toBeNull()
    r = watchRunwayDirection(r.state, ['27L', '27R', '22L'], opposite, 1)
    expect(r.alert).toBeNull()
    r = watchRunwayDirection({ landing: ['27L', '27R'], since: 0 }, ['9L', '9R'], opposite, 2)
    expect(r.alert).toMatchObject({ kind: 'runway', title: 'Runways turned around' })
    expect(r.alert?.body).toMatch(/9L, 9R/)
  })
})

describe('admission', () => {
  const input = (over: Partial<AlertInput> = {}): AlertInput => ({ kind: 'goaround', at: 1000, icao24: 'abc123', callsign: 'UAL1534', runway: null, title: 't', body: 'b', source: 'traffic', ...over })

  it('merges the same aircraft and kind seen twice (traffic, then radio)', () => {
    const first = admit([], input(), ALL, 1000)
    expect(first.action).toBe('new')
    const log = [(first as { alert: Alert }).alert]
    const second = admit(log, input({ source: 'radio', at: 30_000, quote: 'going around', runway: '27L' }), ALL, 30_000)
    expect(second.action).toBe('merge')
    expect((second as { alert: Alert }).alert).toMatchObject({ id: log[0].id, count: 2, quote: 'going around', runway: '27L' })
  })

  it('drops kinds that are switched off', () => {
    expect(admit([], input(), new Set<AlertKind>(['emergency']), 0)).toEqual({ action: 'drop', reason: 'disabled' })
  })

  it('rate-limits bursts but always lets emergencies through', () => {
    const log: Alert[] = []
    for (let i = 0; i < BURST; i++) {
      const r = admit(log, input({ icao24: `a${i}`, callsign: `X${i}`, at: 1000 + i }), ALL, 1000 + i)
      if (r.action === 'new') log.unshift(r.alert)
    }
    expect(admit(log, input({ icao24: 'zz', callsign: 'ZZ1', at: 2000 }), ALL, 2000)).toEqual({ action: 'drop', reason: 'burst' })
    expect(admit(log, input({ kind: 'emergency', icao24: 'zz', callsign: 'ZZ1', at: 2000 }), ALL, 2000).action).toBe('new')
  })

  it('keeps runway changes from repeating within the cooldown', () => {
    const first = admit([], input({ kind: 'runway', icao24: null, callsign: null }), ALL, 0)
    const log = [(first as { alert: Alert }).alert]
    expect(admit(log, input({ kind: 'runway', icao24: null, callsign: null, at: 60_000 }), ALL, 60_000)).toEqual({ action: 'drop', reason: 'cooldown' })
  })
})
