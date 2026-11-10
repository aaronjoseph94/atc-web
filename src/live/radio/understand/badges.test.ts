import { describe, expect, it } from 'vitest'
import { activeBadges, badgeOpacity, BADGE_TTL_MS } from './badges'
import { resolveHandoff, handoffLabel } from './handoff'
import type { Instruction } from './instructions'
import type { Station } from '../../../api/types'
import { fitInput, INPUT_BUDGET } from './context'
import { searchWithRaw, withUnderstanding } from './search'
import { NO_FILTERS } from '../../history/search'
import { targetsFor } from './understand'

const now = 1_000_000
const res = (id: string, at: number, instructions: Instruction[], targets: (string | null)[], airport = 'JFK') => ({ id, at, airport, instructions, targets })
const climb = (ft: number): Instruction => ({ kind: 'altitude', callsign: null, action: 'climb', ft, fl: false })

describe('activeBadges', () => {
  it('shows the newest assignment per aircraft, at this airport, for two minutes', () => {
    const badges = activeBadges(
      [
        res('1', now - 60_000, [climb(3000)], ['a']),
        res('2', now - 10_000, [{ kind: 'heading', callsign: null, action: 'left', deg: 270 }, climb(5000), { kind: 'speed', callsign: null, action: 'reduce', kt: 210 }], ['a', 'a', 'a']),
        res('3', now - 5_000, [{ kind: 'pushback', callsign: null }], ['b']),
        res('4', now - 5_000, [climb(4000)], ['c'], 'ORD'),
        res('5', now - BADGE_TTL_MS - 1, [climb(9000)], ['d']),
        res('6', now - 1_000, [climb(7000)], [null]),
      ],
      'JFK',
      now,
    )
    // A newer call supersedes an older one; at most two instructions in one badge; a pushback isn't a lasting assignment.
    expect(badges).toEqual([{ icao24: 'a', label: 'HDG 270 · ↑5,000', at: now - 10_000, id: '2' }])
  })

  it('fades over the last stretch', () => {
    expect(badgeOpacity(0)).toBe(1)
    expect(badgeOpacity(BADGE_TTL_MS - 10_000)).toBeCloseTo(0.5)
    expect(badgeOpacity(BADGE_TTL_MS)).toBe(0)
  })
})

describe('resolveHandoff', () => {
  const st = (id: string, kind: Station['kind'], mhz: number, label: string): Station => ({ id, airport: 'JFK', name: 'New York JFK', label, position: '', kind, frequencyMhz: mhz })
  const stations = [st('jfk-twr', 'TWR', 119.1, 'Tower'), st('jfk-dep', 'DEP', 135.9, 'Departure'), st('jfk-gnd-1', 'GND', 121.9, 'Ground (North)'), st('jfk-gnd-2', 'GND', 121.65, 'Ground (South)')]
  const h = (facility: string, mhz: number | null) => ({ kind: 'handoff' as const, callsign: null, action: 'contact' as const, facility, mhz })

  it('finds the channel by frequency, or by name when only one fits', () => {
    expect(resolveHandoff(h('Departure', 135.9), stations, () => true)).toEqual({ station: stations[1], audible: true })
    expect(resolveHandoff(h('departure', null), stations, () => false)).toEqual({ station: stations[1], audible: false })
    // Two ground positions and no frequency: can't tell which.
    expect(resolveHandoff(h('Ground', null), stations)).toBeNull()
    expect(resolveHandoff(h('New York Center', 132.35), stations)).toBeNull()
  })

  it('labels the chip', () => {
    expect(handoffLabel(h('departure', 135.9), null)).toBe('Departure 135.9')
    expect(handoffLabel(h('', 121.65), { station: stations[3], audible: true })).toBe('Ground 121.65')
  })
})

describe('fitInput', () => {
  it('keeps the request under budget by shedding context, never the call', () => {
    const big = {
      text: 'delta two eight eight runway three one left line up and wait',
      station: { airport: 'JFK', name: 'New York JFK', role: 'TWR', label: 'Tower', mhz: 119.1 },
      recent: Array.from({ length: 4 }, (_, i) => ({ speaker: 'atc' as const, text: `call ${i} `.padEnd(230, 'x') })),
      traffic: Array.from({ length: 30 }, (_, i) => `DAL${100 + i} (Delta ${100 + i})`),
      runways: ['4L', '22R', '4R', '22L', '13L', '31R', '13R', '31L'],
      taxiways: Array.from({ length: 80 }, (_, i) => `T${i}`),
      guess: { speaker: 'atc' as const, callsigns: ['DAL288'] },
    }
    const out = fitInput(big)
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(INPUT_BUDGET)
    expect(out.text).toBe(big.text)
    expect(out.runways).toEqual(big.runways)
    expect(out.recent.length).toBeGreaterThanOrEqual(2)
    expect(out.recent.at(-1)).toEqual(big.recent.at(-1))
    // Small input passes untouched.
    const small = { ...big, recent: [], traffic: [], taxiways: [] }
    expect(fitInput(small)).toEqual(small)
  })
})

describe('searching cleaned calls', () => {
  const entry = (id: string, text: string) => ({ id, source: 'radio' as const, at: 1, text, stationId: 's', callsigns: [], ids: [], speaker: null })
  const items = withUnderstanding([entry('1', 'delta to eight eight runway three one left line up and wait'), entry('2', 'roger')], {
    '1': { cleaned: 'Delta 288, runway 31L, line up and wait', speaker: 'controller', added: [{ callsign: 'DAL288', icao24: 'a1' }] },
  })

  it('shows the cleaned call with the model speaker and found aircraft', () => {
    expect(items[0]).toMatchObject({ text: 'Delta 288, runway 31L, line up and wait', raw: 'delta to eight eight runway three one left line up and wait', speaker: 'controller', ids: ['a1'], callsigns: ['DAL288'] })
    expect(items[1]).toEqual(entry('2', 'roger'))
  })

  it('finds a call by its cleaned words or by what was first heard', () => {
    expect(searchWithRaw(items, { ...NO_FILTERS, query: '288' }).map((h) => h.item.text)).toEqual(['Delta 288, runway 31L, line up and wait'])
    const raw = searchWithRaw(items, { ...NO_FILTERS, query: 'eight' })
    expect(raw).toHaveLength(1)
    // Shown as heard, so the match can be lit.
    expect(raw[0].item.text).toBe('delta to eight eight runway three one left line up and wait')
    expect(raw[0].ranges.length).toBeGreaterThan(0)
  })
})

describe('targetsFor', () => {
  const traffic = [
    { callsign: 'DAL288 ', icao24: 'a1' },
    { callsign: 'JBU1407', icao24: 'b2' },
  ]
  it('sends each instruction to the aircraft it names, else the call’s aircraft', () => {
    const t = { icao24: 'a1', callsigns: [{ callsign: 'DAL288', icao24: 'a1', confidence: 0.9 }] }
    const ins: Instruction[] = [
      { kind: 'runway', callsign: 'JBU1407', action: 'takeoff', runway: '4L' },
      { kind: 'runway', callsign: 'DAL288', action: 'luaw', runway: '4L' },
      { kind: 'heading', callsign: null, action: 'fly', deg: 40 },
      { kind: 'squawk', callsign: 'XYZ999', code: '1200' },
    ]
    expect(targetsFor({ instructions: ins }, t, traffic)).toEqual(['b2', 'a1', 'a1', 'a1'])
    expect(targetsFor({ instructions: ins.slice(2) }, { icao24: null, callsigns: [] }, traffic)).toEqual([null, null])
  })
})
