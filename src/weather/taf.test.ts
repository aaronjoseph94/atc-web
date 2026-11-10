import { describe, expect, it } from 'vitest'
import { tafLines } from './taf'

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
