import { describe, expect, it } from 'vitest'
import type { Instruction } from './instructions'
import { groupThreads, threadStory, type ThreadCall } from './threads'

const DAL = 'a1b2c3'
const JBU = 'd4e5f6'
const call = (id: string, at: number, ids: string[], primary: string | null = ids[0] ?? null): ThreadCall => ({ id, at, icao24: primary, callsigns: ids.map((x) => ({ callsign: x === DAL ? 'DAL288' : 'JBU1407', icao24: x, confidence: 0.9 })) })
const r = (instructions: Instruction[], targets: (string | null)[]) => ({ instructions, targets })

describe('groupThreads', () => {
  it('groups calls by aircraft, newest thread first, a shared call in both', () => {
    const calls = [call('1', 1000, [DAL]), call('2', 2000, [JBU]), call('3', 3000, [DAL, JBU]), call('4', 2500, [DAL]), { id: '5', at: 4000, icao24: null, callsigns: [] }]
    const threads = groupThreads(calls)
    expect(threads.map((t) => t.icao24)).toEqual([DAL, JBU])
    expect(threads[0].calls.map((c) => c.id)).toEqual(['1', '4', '3'])
    expect(threads[0].callsign).toBe('DAL288')
    expect(threads[1].calls.map((c) => c.id)).toEqual(['2', '3'])
    expect(threads[0].lastAt).toBe(3000)
  })
})

describe('threadStory', () => {
  const calls = [call('1', 1, [DAL]), call('2', 2, [DAL]), call('3', 3, [DAL]), call('4', 4, [DAL, JBU]), call('5', 5, [DAL])]
  const results = {
    '1': r([{ kind: 'pushback', callsign: null }], [DAL]),
    '2': r([{ kind: 'taxi', callsign: null, runway: '4L', via: ['A', 'B'] }, { kind: 'runway', callsign: null, action: 'hold_short', runway: '31L' }], [DAL, DAL]),
    // The pilot's read-back of the same clearance.
    '3': r([{ kind: 'taxi', callsign: null, runway: '4L', via: ['A', 'B'] }, { kind: 'runway', callsign: null, action: 'hold_short', runway: '31L' }], [DAL, DAL]),
    // Two aircraft in one call: only Delta's part counts for Delta.
    '4': r([{ kind: 'runway', callsign: 'JBU1407', action: 'takeoff', runway: '4L' }, { kind: 'runway', callsign: 'DAL288', action: 'luaw', runway: '4L' }], [JBU, DAL]),
    '5': r([{ kind: 'runway', callsign: null, action: 'takeoff', runway: '4L' }, { kind: 'handoff', callsign: null, action: 'contact', facility: 'Departure', mhz: 135.9 }], [DAL, DAL]),
  }

  it('tells the story from the understood instructions', () => {
    expect(threadStory(calls, results, DAL)).toBe('Pushback → taxi via A, B to 4L → hold short 31L → line up and wait 4L → cleared for takeoff 4L → contact Departure 135.9')
    expect(threadStory(calls, results, JBU)).toBe('Cleared for takeoff 4L')
  })

  it('keeps the latest steps of a long story', () => {
    expect(threadStory(calls, results, DAL, 3)).toBe('… → line up and wait 4L → cleared for takeoff 4L → contact Departure 135.9')
  })

  it('has nothing to say without understood instructions', () => {
    expect(threadStory(calls, {}, DAL)).toBeNull()
    expect(threadStory(calls, { '1': r([], []) }, DAL)).toBeNull()
  })
})
