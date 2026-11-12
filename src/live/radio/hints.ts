/**
 * The callsigns worth naming to the speech recogniser (and, after it, to the
 * AI pass): the aircraft this station is likely to be talking to right now.
 */
import type { StationKind } from '../../api/types'
import { liveBuffer } from '../session'
import { writtenCallsign } from './callsigns'

/** Most callsigns listed in the recognition hint. */
const HINT_LIMIT = 24

/** Callsigns worth naming to the recogniser: the ones this station is likely to be talking to. */
export function hintCallsigns(kind: StationKind | undefined, elevationFt: number): string {
  const all = liveBuffer.sample()
  const relevant = all.filter((a) => {
    const agl = a.onGround || a.altitudeFt == null ? 0 : a.altitudeFt - elevationFt
    if (kind === 'GND' || kind === 'CLD') return a.onGround
    if (kind === 'APP' || kind === 'DEP') return !a.onGround
    if (kind === 'TWR') return a.onGround || agl < 5000
    return true
  })
  // Moving aircraft are the likeliest to be on frequency; parked ones last.
  relevant.sort((x, y) => (y.speedKt ?? 0) - (x.speedKt ?? 0))
  const names: string[] = []
  for (const a of relevant) {
    const w = writtenCallsign(a.callsign)
    if (w && !names.includes(w)) names.push(w)
    if (names.length >= HINT_LIMIT) break
  }
  return names.join(', ')
}
