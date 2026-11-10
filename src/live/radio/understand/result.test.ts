import { describe, expect, it } from 'vitest'
import { overlap, parseCleanup } from './result'

const RAW = 'delta two eight eight runway three one left line up and wait'
const good = {
  cleaned: 'Delta 288, runway 31L, line up and wait.',
  plain: 'Delta 288 may enter runway 31L and wait there for takeoff clearance.',
  speaker: 'atc',
  speakerConfidence: 0.92,
  callsigns: ['DAL288', 'dal 288', ''],
  instructions: [
    { type: 'runway', callsign: 'DAL288', action: 'luaw', value: '', facility: '', runway: '31 left', route: [] },
    { type: 'heading', callsign: 'DAL288', action: 'fly', value: '999', facility: '', runway: '', route: [] },
  ],
}

describe('parseCleanup', () => {
  it('takes a good answer, normalising as it goes', () => {
    const u = parseCleanup('rx-1', RAW, good, ['31L', '13R'])!
    expect(u.cleaned).toBe('Delta 288, runway 31L, line up and wait.')
    expect(u.plain).toBe(good.plain)
    expect(u.speaker).toBe('controller')
    expect(u.callsigns).toEqual(['DAL288'])
    // The impossible heading is dropped; the runway clearance is kept.
    expect(u.instructions).toEqual([{ kind: 'runway', callsign: 'DAL288', action: 'luaw', runway: '31L' }])
  })

  it('ignores a speaker the model was not sure of', () => {
    expect(parseCleanup('a', RAW, { ...good, speaker: 'pilot', speakerConfidence: 0.5 })!.speaker).toBeNull()
    expect(parseCleanup('a', RAW, { ...good, speaker: 'pilot', speakerConfidence: 0.8 })!.speaker).toBe('pilot')
    expect(parseCleanup('a', RAW, { ...good, speaker: 'unknown', speakerConfidence: 1 })!.speaker).toBeNull()
    // A percentage instead of a fraction.
    expect(parseCleanup('a', RAW, { ...good, speakerConfidence: 85 })!.speakerConfidence).toBeCloseTo(0.85)
  })

  it('keeps the raw words when the "cleanup" is a different call', () => {
    const u = parseCleanup('a', RAW, { ...good, cleaned: 'American 12, cleared to land runway 4R, wind 310 at 12, number two following traffic on a three mile final.' })!
    expect(u.cleaned).toBeNull()
    expect(u.plain).toBe(good.plain)
    expect(parseCleanup('a', RAW, { ...good, cleaned: RAW })!.cleaned).toBeNull()
    expect(parseCleanup('a', RAW, { ...good, cleaned: '   ' })!.cleaned).toBeNull()
  })

  it('rejects answers of the wrong shape', () => {
    expect(parseCleanup('a', RAW, null)).toBeNull()
    expect(parseCleanup('a', RAW, 'Delta 288 line up and wait')).toBeNull()
    expect(parseCleanup('a', RAW, { cleaned: 5, plain: '' })).toBeNull()
    const thin = parseCleanup('a', RAW, { cleaned: 'Delta 288, runway 31L, line up and wait', plain: '' })!
    expect(thin.instructions).toEqual([])
    expect(thin.callsigns).toEqual([])
    expect(thin.speaker).toBeNull()
  })

  it('measures shared wording, ignoring numbers said as words', () => {
    expect(overlap('delta two eight eight cleared for takeoff', 'Delta 288, cleared for takeoff')).toBe(1)
    expect(overlap('united four seven taxi via alpha bravo hold short', 'Lufthansa 400, contact departure')).toBeLessThan(0.2)
  })
})
