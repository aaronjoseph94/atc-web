import { describe, expect, it } from 'vitest'
import { findTerms, searchGlossary, segmentTerms } from './detect'
import { GLOSSARY, GLOSSARY_BY_ID, parseRunway } from './glossary'

const ids = (text: string) => findTerms(text).map((h) => h.id)
const words = (text: string) => findTerms(text).map((h) => h.text)

describe('glossary', () => {
  it('has a good number of unique, filled-in entries', () => {
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(60)
    expect(new Set(GLOSSARY.map((e) => e.id)).size).toBe(GLOSSARY.length)
    for (const e of GLOSSARY) {
      expect(e.text.length, e.id).toBeGreaterThan(30)
      // Short enough to read in a popover.
      expect(e.text.split(/\s+/).length, e.id).toBeLessThanOrEqual(70)
      expect(e.patterns.length, e.id).toBeGreaterThan(0)
    }
  })
  it('reads runway designators', () => {
    expect(parseRunway('31R')).toEqual({ number: 31, side: 'right' })
    expect(parseRunway('9 left')).toEqual({ number: 9, side: 'left' })
    expect(parseRunway('4')).toEqual({ number: 4, side: null })
    expect(parseRunway('40')).toBeNull()
  })
})

describe('findTerms', () => {
  it('finds the common clearances in a real-sounding call', () => {
    expect(ids('United 1534, runway 28 right, line up and wait.')).toEqual(['runway', 'luaw'])
    expect(ids('Delta 22 heavy, hold short of runway 4 left')).toEqual(['heavy', 'holdShort', 'runway'])
    expect(ids('American 12, cleared ILS 31R approach, maintain 3000 until established')).toEqual(['ils'])
  })
  it('prefers the longer phrase where two overlap', () => {
    expect(words('Speedbird 1, cleared ILS runway 31 right')).toEqual(['ILS runway 31 right'])
    expect(words('going around')).toEqual(['going around'])
  })
  it('knows flight levels, squawks and pressure settings', () => {
    expect(ids('climb and maintain flight level 350, squawk 4521')).toEqual(['climbMaintain', 'flightLevel', 'squawk'])
    expect(ids('FL350')).toEqual(['flightLevel'])
    expect(ids('altimeter 29.92')).toEqual(['altimeter'])
    expect(ids('QNH 1013')).toEqual(['altimeter'])
    expect(GLOSSARY_BY_ID.flightLevel.detail?.('FL350')).toBe('Flight level 350 is about 35,000 ft.')
    expect(GLOSSARY_BY_ID.squawk.detail?.('squawk 7700')).toMatch(/general emergency/)
  })
  it('respects case for abbreviations that are also words', () => {
    expect(ids('the TAF calls for rain')).toEqual(['taf'])
    expect(ids('we have a star on the tail')).toEqual([])
    expect(ids('expect the TRUKN2 STAR')).toEqual(['star'])
  })
  it('does not take weather intensity for a heavy aircraft', () => {
    expect(ids('heavy rain and mist')).toEqual([])
    expect(ids('Lufthansa 400 heavy')).toEqual(['heavy'])
  })
  it('does not mistake cloud base for a base leg', () => {
    expect(ids('cloud base 1200 feet')).toEqual([])
    expect(ids('turn left base runway 27')).toContain('pattern')
  })
  it('handles emergencies', () => {
    expect(ids('Mayday mayday mayday, engine failure')).toEqual(['mayday', 'mayday', 'mayday'])
    expect(ids('pan-pan, medical')).toEqual(['panpan'])
  })
  it('works with weather codes', () => {
    expect(ids('BKN012 OVC025')).toEqual(['cover', 'cover'])
    expect(GLOSSARY_BY_ID.cover.detail?.('BKN012')).toMatch(/1,200 ft/)
    expect(ids('Information Bravo, wind 270 at 15 gusting 25')).toEqual(['atis', 'gusts'])
  })
  it('returns nothing for ordinary text', () => {
    expect(findTerms('')).toEqual([])
    expect(findTerms('good morning, have a nice day')).toEqual([])
  })
})

describe('segmentTerms', () => {
  it('splits text into plain and term runs that join back up', () => {
    const text = 'Delta 22, line up and wait runway 4L.'
    const segs = segmentTerms(text)
    expect(segs.map((s) => s.text).join('')).toBe(text)
    expect(segs.filter((s) => s.hit).map((s) => s.text)).toEqual(['line up and wait', 'runway 4L'])
  })
})

describe('searchGlossary', () => {
  it('finds by name, keyword and by the words themselves', () => {
    expect(searchGlossary('squawk')[0].id).toBe('squawk')
    expect(searchGlossary('LUAW')[0].id).toBe('luaw')
    expect(searchGlossary('FL350')[0].id).toBe('flightLevel')
    expect(searchGlossary('')).toHaveLength(GLOSSARY.length)
    expect(searchGlossary('zzzz')).toEqual([])
  })
})
