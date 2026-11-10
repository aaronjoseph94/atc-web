/**
 * "Contact departure 124.75": which of the airport's channels that is, and
 * whether there is live audio for it, so the transcript can offer to follow
 * the aircraft there.
 */
import { feedFor } from '../../../api/radioFeeds'
import type { Station, StationKind } from '../../../api/types'
import { mhzText, type Instruction } from './instructions'

type Handoff = Extract<Instruction, { kind: 'handoff' }>

const FACILITY_KIND: [RegExp, StationKind][] = [
  [/\bdep(arture)?s?\b/i, 'DEP'],
  [/\b(app(roach)?|arrivals?|director|final)\b/i, 'APP'],
  [/\b(ground|gnd|ramp)\b/i, 'GND'],
  [/\b(tower|twr)\b/i, 'TWR'],
  [/\b(clearance|delivery)\b/i, 'CLD'],
]

export type HandoffTarget = { station: Station; audible: boolean }

/**
 * The channel a handoff points at: the station on that frequency, or with
 * no frequency (or none matching), the only station of the named kind.
 */
export function resolveHandoff(h: Handoff, stations: Station[], audible: (s: Station) => boolean = (s) => !!feedFor(s)): HandoffTarget | null {
  let station: Station | undefined
  if (h.mhz != null) station = stations.find((s) => s.frequencyMhz != null && Math.abs(s.frequencyMhz - h.mhz!) < 0.003)
  if (!station && h.facility) {
    const kind = FACILITY_KIND.find(([re]) => re.test(h.facility))?.[1]
    const ofKind = kind ? stations.filter((s) => s.kind === kind) : []
    if (ofKind.length === 1 && h.mhz == null) station = ofKind[0]
  }
  return station ? { station, audible: audible(station) } : null
}

/** "Departure 124.75" for the chip. */
export function handoffLabel(h: Handoff, target: HandoffTarget | null): string {
  const name = h.facility || (target ? target.station.label.replace(/\s*\(.*\)$/, '') : '')
  return [name.replace(/^(\w)/, (c) => c.toUpperCase()), h.mhz != null ? mhzText(h.mhz) : ''].filter(Boolean).join(' ')
}
