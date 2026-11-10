import { describe, expect, it } from 'vitest'
import { parseTaf, tafLines, upcoming } from './taf'

describe('tafLines', () => {
  it('puts each change group on its own line', () => {
    const raw = 'TAF KJFK 100839Z 1009/1112 28010KT P6SM BKN045 FM101500 26013G21KT P6SM SCT045 FM101800 25017G26KT P6SM SKC'
    expect(tafLines(raw)).toEqual(['TAF KJFK 100839Z 1009/1112 28010KT P6SM BKN045', 'FM101500 26013G21KT P6SM SCT045', 'FM101800 25017G26KT P6SM SKC'])
  })
  it('keeps PROB30 TEMPO together and splits BECMG', () => {
    const raw = 'TAF CYYC 101140Z 1012/1112 30010KT P6SM FEW040 PROB30 TEMPO 1015/1018 -SHRA BECMG 1020/1022 VRB03KT TEMPO 1100/1104 BR'
    expect(tafLines(raw)).toEqual(['TAF CYYC 101140Z 1012/1112 30010KT P6SM FEW040', 'PROB30 TEMPO 1015/1018 -SHRA', 'BECMG 1020/1022 VRB03KT', 'TEMPO 1100/1104 BR'])
  })
  it('handles missing and multi-line input', () => {
    expect(tafLines(null)).toEqual([])
    expect(tafLines('  TAF KORD\n  FM101500 26013KT ')).toEqual(['TAF KORD', 'FM101500 26013KT'])
  })
})

const ref = new Date('2026-11-10T09:00:00Z')
const at = (iso: string) => new Date(iso).getTime()

describe('parseTaf', () => {
  it('splits FM groups into back-to-back periods', () => {
    const taf = parseTaf('TAF KJFK 100839Z 1009/1112 28010KT P6SM BKN045 BKN200 FM101500 26013G21KT P6SM SCT045 FM101800 25017G26KT P6SM SKC', ref)!
    expect(taf.issuedAt).toBe(at('2026-11-10T08:39:00Z'))
    expect(taf.from).toBe(at('2026-11-10T09:00:00Z'))
    expect(taf.to).toBe(at('2026-11-11T12:00:00Z'))
    expect(taf.main.map((p) => [p.kind, new Date(p.from).toISOString().slice(8, 13), new Date(p.to).toISOString().slice(8, 13)])).toEqual([
      ['base', '10T09', '10T15'],
      ['from', '10T15', '10T18'],
      ['from', '10T18', '11T12'],
    ])
    expect(taf.main[0]).toMatchObject({ wind: { dirDeg: 280, kt: 10, gustKt: null }, visibilitySm: 6, visibilityPlus: true, category: 'VFR' })
    expect(taf.main[1].wind).toMatchObject({ dirDeg: 260, kt: 13, gustKt: 21 })
    expect(taf.main[2].clouds).toEqual([{ cover: 'SKC', baseFt: null }])
  })

  it('reads BECMG as a lasting change and TEMPO / PROB as overlays', () => {
    const taf = parseTaf('TAF CYYC 101140Z 1012/1112 30010KT P6SM FEW040 PROB30 TEMPO 1015/1018 2SM -SHRA BKN008 BECMG 1020/1022 VRB03KT TEMPO 1100/1104 1/2SM FG', ref)!
    expect(taf.main.map((p) => p.kind)).toEqual(['base', 'becoming'])
    // BECMG changes only the wind; visibility and cloud carry over.
    expect(taf.main[1]).toMatchObject({ wind: { dirDeg: null, variable: true, kt: 3 }, visibilitySm: 6, clouds: [{ cover: 'FEW', baseFt: 4000 }] })
    expect(taf.overlays).toHaveLength(2)
    expect(taf.overlays[0]).toMatchObject({ kind: 'prob', probability: 30, weather: '-SHRA', visibilitySm: 2, category: 'IFR' })
    // The TEMPO keeps the wind from underneath.
    expect(taf.overlays[1]).toMatchObject({ kind: 'tempo', weather: 'FG', visibilitySm: 0.5, category: 'LIFR', wind: { kt: 3 } })
  })

  it('reads ICAO style (metres, CAVOK, NSW) and spans the month end', () => {
    const taf = parseTaf('TAF EGLL 302300Z 3100/0106 24012KT 9999 BKN012 BECMG 3102/3104 CAVOK TEMPO 3104/0102 4000 RA', new Date('2026-10-31T00:00:00Z'))!
    expect(taf.to).toBe(at('2026-11-01T06:00:00Z'))
    expect(taf.main[0]).toMatchObject({ visibilityPlus: true, category: 'MVFR' })
    expect(taf.main[1]).toMatchObject({ clouds: [], category: 'VFR', weather: null })
    expect(taf.overlays[0].visibilitySm).toBeCloseTo(2.5, 1)
  })

  it('drops what is past and clips the current period to now', () => {
    const taf = parseTaf('TAF KJFK 100839Z 1009/1112 28010KT P6SM BKN045 FM101500 26013G21KT P6SM SCT045', ref)!
    const next = upcoming(taf, at('2026-11-10T16:00:00Z'))
    expect(next.main).toHaveLength(1)
    expect(next.main[0].from).toBe(at('2026-11-10T16:00:00Z'))
    expect(parseTaf('', ref)).toBeNull()
    expect(parseTaf('TAF KJFK garbage', ref)).toBeNull()
  })
})
