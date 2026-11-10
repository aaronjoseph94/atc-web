import { describe, expect, it } from 'vitest'
import { callsignSuggestions, groupByTime, highlight, matchItem, mergeRanges, NO_FILTERS, parseQuery, search, termPattern, timeBucket, type SearchItem } from './search'

const item = (p: Partial<SearchItem> & { text: string }): SearchItem => ({ id: p.text, source: 'radio', at: 0, stationId: 'twr', callsigns: [], ids: [], ...p })

const calls: SearchItem[] = [
  item({ id: '1', text: 'Delta 288, runway 4 left, cleared to land', callsigns: ['DAL288'], ids: ['a1'] }),
  item({ id: '2', text: 'JetBlue 1407, runway three one left, line up and wait', callsigns: ['JBU1407'], ids: ['b2'] }),
  item({ id: '3', text: 'JetBlue 1407, going around, fly runway heading', callsigns: ['JBU1407'], ids: ['b2'], stationId: 'gnd' }),
  item({ id: '4', text: 'Taxi via Alpha, Bravo, hold short of runway 4L', callsigns: [], ids: [] }),
  item({ id: '5', source: 'event', text: 'JBU1407 went around on runway 31L', callsigns: ['JBU1407'], ids: ['b2'], eventKind: 'goaround', stationId: '' }),
]

describe('search', () => {
  it('finds every word typed, case-insensitively, and highlights it', () => {
    const hits = search(calls, { ...NO_FILTERS, query: 'jetblue WAIT' })
    expect(hits.map((h) => h.item.id)).toEqual(['2'])
    expect(highlight(hits[0].item.text, hits[0].ranges).filter((r) => r.hit).map((r) => r.text)).toEqual(['JetBlue', 'wait'])
  })

  it('finds a callsign whether it was typed as written or as said', () => {
    expect(search(calls, { ...NO_FILTERS, query: 'DAL288' }).map((h) => h.item.id)).toEqual(['1'])
    expect(search(calls, { ...NO_FILTERS, query: 'dal 288' }).map((h) => h.item.id)).toEqual(['1'])
  })

  it('finds a runway however it was said', () => {
    expect(search(calls, { ...NO_FILTERS, query: '31L' }).map((h) => h.item.id)).toEqual(['2', '5'])
    expect(search(calls, { ...NO_FILTERS, query: '4L' }).map((h) => h.item.id)).toEqual(['1', '4'])
  })

  it('keeps quoted phrases together', () => {
    expect(parseQuery('"hold short" bravo')).toEqual(['hold short', 'bravo'])
    expect(search(calls, { ...NO_FILTERS, query: '"runway heading"' }).map((h) => h.item.id)).toEqual(['3'])
  })

  it('applies the phrase chips to what was said, not to detected events', () => {
    expect(search(calls, { ...NO_FILTERS, phrase: 'goaround' }).map((h) => h.item.id)).toEqual(['3'])
    expect(search(calls, { ...NO_FILTERS, phrase: 'luaw' }).map((h) => h.item.id)).toEqual(['2'])
    expect(search(calls, { ...NO_FILTERS, phrase: 'land' }).map((h) => h.item.id)).toEqual(['1'])
    expect(search(calls, { ...NO_FILTERS, phrase: 'holdshort' }).map((h) => h.item.id)).toEqual(['4'])
  })

  it('filters by source, channel, callsign and aircraft', () => {
    expect(search(calls, { ...NO_FILTERS, source: 'event' }).map((h) => h.item.id)).toEqual(['5'])
    expect(search(calls, { ...NO_FILTERS, stationId: 'gnd' }).map((h) => h.item.id)).toEqual(['3', '5'])
    expect(search(calls, { ...NO_FILTERS, callsign: 'jbu1407' }).map((h) => h.item.id)).toEqual(['2', '3', '5'])
    expect(search(calls, { ...NO_FILTERS, icao24: 'a1' }).map((h) => h.item.id)).toEqual(['1'])
  })

  it('matches everything with no filters', () => {
    expect(matchItem(calls[0], NO_FILTERS)?.ranges).toEqual([])
  })
})

describe('termPattern', () => {
  it('reads runway designators', () => {
    const re = termPattern('31L')
    expect('runway 31 left'.match(re)?.[0]).toBe('31 left')
    expect('runway three one left'.match(termPattern('31L'))?.[0]).toBe('three one left')
    expect('runway 31L'.match(termPattern('31l'))?.[0]).toBe('31L')
    expect('runway 31 right'.match(termPattern('31L'))).toBeNull()
  })
})

describe('highlight', () => {
  it('cuts text into runs', () => {
    expect(highlight('abcdef', [[1, 3]])).toEqual([
      { text: 'a', hit: false },
      { text: 'bc', hit: true },
      { text: 'def', hit: false },
    ])
  })

  it('merges overlapping ranges', () => {
    expect(
      mergeRanges([
        [5, 8],
        [0, 2],
        [1, 3],
      ]),
    ).toEqual([
      [0, 3],
      [5, 8],
    ])
  })
})

describe('timeBucket and groupByTime', () => {
  const now = 10_000_000
  it('labels ages', () => {
    expect(timeBucket(now - 30_000, now)).toBe('Now')
    expect(timeBucket(now - 4 * 60_000, now)).toBe('5 min ago')
    expect(timeBucket(now - 11 * 60_000, now)).toBe('10 min ago')
    expect(timeBucket(now - 3 * 3_600_000, now)).toBe('3 h ago')
    expect(timeBucket(now - 30 * 3_600_000, now)).toBe('Yesterday')
  })

  it('groups consecutive hits under one heading', () => {
    const hits = [now - 12 * 60_000, now - 11 * 60_000, now - 60_000, now - 1000].map((at, i) => ({ item: { at, id: String(i) } }))
    expect(groupByTime(hits, now).map((g) => [g.label, g.hits.length])).toEqual([
      ['10 min ago', 2],
      ['Now', 2],
    ])
  })
})

describe('callsignSuggestions', () => {
  it('suggests callsigns heard most, matching what is typed', () => {
    expect(callsignSuggestions(calls, 'jbu')).toEqual(['JBU1407'])
    expect(callsignSuggestions(calls, 'd')).toEqual([])
  })
})
