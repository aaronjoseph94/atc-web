import { describe, expect, it } from 'vitest'
import type { LiveEvent } from '../live/events'
import type { HistoryEntry } from '../live/history/store'
import { recentActivity } from './activity'

const entry = (id: string, at: number, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id,
  source: 'event',
  airport: 'JFK',
  stationId: '',
  at,
  durationMs: 0,
  text: `${id} landed`,
  callsigns: ['DAL1'],
  ids: ['a1'],
  speaker: null,
  eventKind: 'landed',
  ...extra,
})
const event = (id: string, at: number): LiveEvent => ({ id, at, kind: 'departed', icao24: 'b2', callsign: 'JBU2', runway: '22R', text: `${id} took off`, lon: 0, lat: 0 })

describe('recentActivity', () => {
  it('merges history and live events, newest first, without duplicates', () => {
    const list = recentActivity([entry('e1', 1), entry('e2', 3)], [event('e3', 4), event('e2', 3)], 'JFK', 10)
    expect(list.map((a) => a.id)).toEqual(['e3', 'e2', 'e1'])
    expect(list[0]).toMatchObject({ kind: 'departed', callsign: 'JBU2', icao24: 'b2' })
  })
  it('leaves out radio calls and other airports, and keeps to the limit', () => {
    const list = recentActivity([entry('r1', 5, { source: 'radio', eventKind: undefined }), entry('o1', 6, { airport: 'ORD' }), entry('e1', 1), entry('e2', 2), entry('e3', 3)], [], 'JFK', 2)
    expect(list.map((a) => a.id)).toEqual(['e3', 'e2'])
  })
})
