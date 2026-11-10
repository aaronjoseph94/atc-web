import { describe, expect, it } from 'vitest'
import { normalizeAtis, normalizeMetar } from './weatherHandler'

describe('normalizeMetar', () => {
  it('decodes a typical US observation', () => {
    const m = normalizeMetar({
      rawOb: 'METAR KORD 092151Z 21008KT 10SM BKN300 15/03 A3002 RMK AO2',
      obsTime: 1794261060,
      temp: 15,
      dewp: 3.3,
      wdir: 210,
      wspd: 8,
      visib: '10+',
      altim: 1016.7,
      clouds: [{ cover: 'BKN', base: 30000 }],
      fltCat: 'VFR',
    })
    expect(m).toMatchObject({
      raw: 'KORD 092151Z 21008KT 10SM BKN300 15/03 A3002 RMK AO2',
      windDirDeg: 210,
      windKt: 8,
      windVariable: false,
      visibilitySm: 10,
      visibilityPlus: true,
      altimeterInHg: 30.02,
      flightCategory: 'VFR',
      clouds: [{ cover: 'BKN', baseFt: 30000 }],
    })
    expect(m?.observedAt).toBe(new Date(1794261060 * 1000).toISOString())
  })

  it('treats variable and calm winds as having no direction', () => {
    expect(normalizeMetar({ rawOb: 'X', wdir: 'VRB', wspd: 4 })).toMatchObject({ windDirDeg: null, windVariable: true, windKt: 4 })
    expect(normalizeMetar({ rawOb: 'X', wdir: 0, wspd: 0 })).toMatchObject({ windDirDeg: null, windVariable: false, windKt: 0 })
  })

  it('returns null without a raw observation', () => {
    expect(normalizeMetar(undefined)).toBeNull()
    expect(normalizeMetar({ temp: 4 })).toBeNull()
  })
})

describe('normalizeAtis', () => {
  it('orders split broadcasts arrival first and drops empty rows', () => {
    const a = normalizeAtis([
      { type: 'dep', code: 'c', datis: 'DEP INFO C' },
      { type: 'arr', code: 'B', datis: 'ARR INFO B' },
      { type: 'arr', code: 'Z', datis: '  ' },
    ])
    expect(a.map((x) => [x.kind, x.code])).toEqual([
      ['arrival', 'B'],
      ['departure', 'C'],
    ])
  })

  it('tolerates an error payload', () => {
    expect(normalizeAtis({ error: 'No results found' } as never)).toEqual([])
  })
})
