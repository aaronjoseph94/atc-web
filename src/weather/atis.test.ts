import { describe, expect, it } from 'vitest'
import { runwayEnds } from '../map/airportDiagram'
import { ceilingFt, phonetic, readableAtis, runwayWinds, sentenceCase } from './atis'

describe('readableAtis', () => {
  const text = readableAtis('ORD ATIS INFO P 2151Z. 21008KT 10SM BKN300 15/03 A3002 (THREE ZERO ZERO TWO). ARR EXP ILS RWY 27C APCH. DEPS EXP RWYS 22L 28R. RWY 4L, 22R CLSD.')

  it('decodes the weather groups', () => {
    expect(text).toContain('information Papa')
    expect(text).toContain('time 21 51 Zulu')
    expect(text).toContain('wind 2 1 0 at 8')
    expect(text).toContain('visibility 10 miles')
    expect(text).toContain('broken clouds at 30,000')
    expect(text).toContain('temperature 15, dew point 3')
    expect(text).toContain('altimeter 3 0 0 2')
    expect(text).not.toContain('THREE ZERO')
  })

  it('spells runways digit by digit and expands shorthand', () => {
    expect(text).toContain('arrivals expect I L S runway 2 7 centre approach')
    expect(text).toContain('departures expect runways 2 2 left, 2 8 right')
    expect(text).toContain('runway 4 left, 2 2 right closed')
  })

  it('handles gusts, variable wind and sub-zero temperatures', () => {
    expect(readableAtis('33020G27KT')).toBe('wind 3 3 0 at 20, gusting 27')
    expect(readableAtis('VRB04KT M02/M07')).toBe('wind variable at 4 temperature minus 2, dew point minus 7')
  })

  it('sentence-cases for reading', () => {
    expect(sentenceCase('ARRIVALS EXPECT I L S RUNWAY 2 7. BIRD ACTIVITY.')).toBe('Arrivals expect ILS runway 2 7. Bird activity.')
    expect(phonetic('p')).toBe('Papa')
  })
})

describe('runwayWinds', () => {
  const ends = runwayEnds('ORD')

  it('ranks runway ends by headwind', () => {
    const w = runwayWinds({ windDirDeg: 270, windKt: 20 }, ends)
    // Wind from the west: the 27s and 28s face straight into it.
    expect(w[0].ident).toMatch(/^(27|28)/)
    expect(w[0].headwindKt).toBe(20)
    expect(w[0].crosswindKt).toBe(0)
    expect(w.at(-1)?.headwindKt).toBe(-20)
  })

  it('reports which side a crosswind comes from', () => {
    const w = runwayWinds({ windDirDeg: 360, windKt: 10 }, ends).find((r) => r.ident === '28R')!
    // Flying west with a north wind: it comes from the right.
    expect(w).toMatchObject({ crosswindKt: 10, from: 'right' })
  })

  it('has nothing to say in calm or variable wind', () => {
    expect(runwayWinds({ windDirDeg: null, windKt: 4 }, ends)).toEqual([])
    expect(runwayWinds({ windDirDeg: 90, windKt: 0 }, ends)).toEqual([])
  })
})

describe('ceilingFt', () => {
  it('is the lowest broken or overcast layer', () => {
    expect(ceilingFt({ clouds: [{ cover: 'FEW', baseFt: 600 }, { cover: 'BKN', baseFt: 14000 }, { cover: 'OVC', baseFt: 20000 }] })).toBe(14000)
    expect(ceilingFt({ clouds: [{ cover: 'SCT', baseFt: 3000 }] })).toBeNull()
  })
})
