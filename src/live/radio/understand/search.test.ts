import { describe, expect, it } from 'vitest'
import { NO_FILTERS } from '../../history/search'
import { fromTransmission } from '../../history/store'
import type { Transmission } from '../radioStore'
import { searchWithRaw, withUnderstanding } from './search'

const RAW = 'delta two eighty eight contact departure one three five point niner'
const CLEANED = 'Delta 288, contact Departure 135.9.'

const call: Transmission = {
  id: 'rx-1',
  stationId: 'jfk-twr',
  airport: 'KJFK',
  at: 1000,
  durationMs: 3000,
  text: CLEANED,
  raw: RAW,
  status: 'done',
  speaker: 'controller',
  callsigns: [{ callsign: 'DAL288', icao24: 'a1', confidence: 1 }],
  icao24: 'a1',
}

describe('history entries and the AI pass', () => {
  it('a processed call keeps its raw words beside the cleaned ones', () => {
    const e = fromTransmission(call)
    expect(e).toMatchObject({ text: CLEANED, raw: RAW })
    expect(e.unprocessed).toBeUndefined()
  })

  it('a call shown without the AI pass says so, and has no second version', () => {
    const e = fromTransmission({ ...call, text: RAW, raw: undefined, unprocessed: true })
    expect(e).toMatchObject({ text: RAW, unprocessed: true })
    expect(e.raw).toBeUndefined()
  })

  it('search finds the raw words of a cleaned call', () => {
    const items = withUnderstanding([fromTransmission(call)], {})
    expect(searchWithRaw(items, { ...NO_FILTERS, query: 'departure 135.9' })).toHaveLength(1)
    const hit = searchWithRaw(items, { ...NO_FILTERS, query: 'niner' })
    expect(hit).toHaveLength(1)
    // The raw words are shown for that hit, so the match can be lit.
    expect(hit[0].item.text).toBe(RAW)
    expect(searchWithRaw(items, { ...NO_FILTERS, query: 'heavy' })).toHaveLength(0)
  })

  it('entries saved before calls were published processed still get their cleaned words from the stored answer', () => {
    const old = { ...fromTransmission({ ...call, text: RAW, raw: undefined }) }
    const [shown] = withUnderstanding([old], { 'rx-1': { cleaned: CLEANED, speaker: 'pilot', added: [] } })
    expect(shown).toMatchObject({ text: CLEANED, raw: RAW, speaker: 'pilot' })
    // An entry already published with its answer is left exactly as it is.
    const now = fromTransmission(call)
    expect(withUnderstanding([now], { 'rx-1': { cleaned: 'something else', speaker: 'pilot', added: [] } })[0]).toBe(now)
  })
})
