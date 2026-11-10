import { describe, expect, it } from 'vitest'
import type { Transmission } from '../radio/radioStore'
import { findClip, type ClipMeta } from './clips'
import { fromEvent, fromTransmission, mergeEntries, type HistoryEntry } from './store'

const call: Transmission = {
  id: 'rx-1',
  stationId: 'jfk-twr',
  airport: 'KJFK',
  at: 1000,
  durationMs: 3000,
  text: 'Delta 288, runway 4 left, cleared to land',
  status: 'done',
  speaker: 'controller',
  callsigns: [
    { callsign: 'DAL288', icao24: 'a1', confidence: 1 },
    { callsign: 'DAL288', icao24: 'a1', confidence: 1 },
  ],
  icao24: 'a1',
}

describe('history entries', () => {
  it('turns a radio call into a searchable entry', () => {
    const e = fromTransmission(call)
    expect(e).toMatchObject({ id: 'rx-1', source: 'radio', airport: 'KJFK', stationId: 'jfk-twr', callsigns: ['DAL288'], ids: ['a1'], speaker: 'controller' })
  })

  it('turns a tower-log event into one', () => {
    const e = fromEvent({ id: 'ev', at: 5, kind: 'goaround', icao24: 'b2', callsign: 'JBU1', runway: '4R', text: 'JBU1 went around', lon: 0, lat: 0 }, 'KJFK')
    expect(e).toMatchObject({ source: 'event', eventKind: 'goaround', callsigns: ['JBU1'], ids: ['b2'] })
  })

  it('merges in time order and replaces updated calls', () => {
    const a = fromTransmission({ ...call, id: 'a', at: 300 })
    const b = fromTransmission({ ...call, id: 'b', at: 100 })
    const a2: HistoryEntry = { ...a, text: 'corrected' }
    const list = mergeEntries(mergeEntries([], [a, b]), [a2])
    expect(list.map((e) => e.id)).toEqual(['b', 'a'])
    expect(list[1].text).toBe('corrected')
  })
})

describe('findClip', () => {
  const index: ClipMeta[] = [
    { id: 'c1', airport: 'KJFK', stationId: 'twr', start: 0, end: 4000 },
    { id: 'c2', airport: 'KJFK', stationId: 'twr', start: 5000, end: 9000 },
    { id: 'c3', airport: 'KJFK', stationId: 'gnd', start: 5000, end: 9000 },
  ]
  it('finds the clip a call was cut from, on the same channel', () => {
    expect(findClip(index, 'twr', 5200, 3000)?.id).toBe('c2')
    expect(findClip(index, 'gnd', 5200, 3000)?.id).toBe('c3')
  })

  it('finds part of a clip that held two calls', () => {
    expect(findClip(index, 'twr', 2500, 1400)?.id).toBe('c1')
  })

  it('finds nothing when the audio is gone', () => {
    expect(findClip(index, 'twr', 20_000, 3000)).toBeNull()
    expect(findClip(index, 'app', 5200, 3000)).toBeNull()
  })
})
