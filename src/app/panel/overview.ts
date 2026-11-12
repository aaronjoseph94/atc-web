/**
 * The numbers behind the side panel's overview and its tab badges, kept apart
 * from the components so they can be tested: how the traffic in view splits
 * into arriving, departing, taxiing and parked, how many radio calls came in
 * since the Radio tab was last looked at, and how a count is written on a
 * small badge.
 */
import type { Aircraft } from '../../api/types'
import { flightPhase, type Phase } from '../../flight/describe'
import { runwayRelation } from '../../live/events'
import type { RunwayEndGeometry } from '../../map/airportDiagram'

export type TrafficGroup = 'Arriving' | 'Departing' | 'Passing through' | 'Taxiing' | 'Parked'

/** The order the groups are listed in: what is about to use a runway first. */
export const TRAFFIC_ORDER: TrafficGroup[] = ['Arriving', 'Departing', 'Taxiing', 'Passing through', 'Parked']

export function trafficGroup(phase: Phase, onFinal: boolean): TrafficGroup {
  if (phase === 'parked') return 'Parked'
  if (phase === 'taxiing' || phase === 'rolling') return 'Taxiing'
  if (onFinal || phase === 'final' || phase === 'descending') return 'Arriving'
  if (phase === 'takeoff' || phase === 'climbing') return 'Departing'
  return 'Passing through'
}

export type Classified = { phase: Phase; group: TrafficGroup; relation: ReturnType<typeof runwayRelation> }

/** What one aircraft is doing at this airport: its phase (heights above the field), its group, and the runway it is lined up with or on. */
export function classifyAircraft(a: Aircraft, ends: RunwayEndGeometry[], elevationFt: number): Classified {
  const relation = runwayRelation(a, ends, elevationFt)
  const phase = flightPhase({ ...a, altitudeFt: a.altitudeFt == null || a.onGround ? a.altitudeFt : a.altitudeFt - elevationFt })
  return { phase, group: trafficGroup(phase, relation?.kind === 'final'), relation }
}

/** Ground vehicles report over ADS-B too (category C); they are not traffic anyone is looking for. */
export const isVehicle = (a: Pick<Aircraft, 'category'>) => !!a.category?.startsWith('C')

export type TrafficCounts = { arriving: number; departing: number; taxiing: number; parked: number; passing: number; total: number }

export const NO_TRAFFIC: TrafficCounts = { arriving: 0, departing: 0, taxiing: 0, parked: 0, passing: 0, total: 0 }

const COUNT_KEY: Record<TrafficGroup, keyof Omit<TrafficCounts, 'total'>> = { Arriving: 'arriving', Departing: 'departing', Taxiing: 'taxiing', Parked: 'parked', 'Passing through': 'passing' }

export function countTraffic(list: Aircraft[], ends: RunwayEndGeometry[], elevationFt: number): TrafficCounts {
  const out = { ...NO_TRAFFIC }
  for (const a of list) {
    if (isVehicle(a)) continue
    out[COUNT_KEY[classifyAircraft(a, ends, elevationFt).group]]++
    out.total++
  }
  return out
}

export const sameCounts = (a: TrafficCounts, b: TrafficCounts) => a.total === b.total && a.arriving === b.arriving && a.departing === b.departing && a.taxiing === b.taxiing && a.parked === b.parked && a.passing === b.passing

/**
 * Radio calls heard after `seenAt`. `entries` is the history, oldest first,
 * so this walks back from the end and stops at the first call already seen:
 * cheap however long the day's history is.
 */
export function unreadCalls(entries: readonly { source: string; at: number }[], seenAt: number): number {
  let n = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.at <= seenAt) break
    if (e.source === 'radio') n++
  }
  return n
}

/** A count as it fits on a small badge: nothing for zero, "9+" past nine. */
export function badgeText(n: number, max = 9): string | null {
  if (!Number.isFinite(n) || n <= 0) return null
  return n > max ? `${max}+` : String(Math.floor(n))
}

/** "just now", "4 min ago", then the clock time: how long ago something on the airfield happened. */
export function agoShort(at: number, now: number): string {
  const min = Math.round((now - at) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
