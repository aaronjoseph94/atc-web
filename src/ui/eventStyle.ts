/**
 * Colour, icon and name for each tower-log event kind, shared by `EventBadge`
 * and anything else that draws one. Landings and takeoffs use the same green
 * and blue as the runway-use paint on the map, so a green landing in the log
 * matches the green runway it was on. Emergencies are drawn solid red.
 */
import { ArrowUpFromLine, PlaneLanding, PlaneTakeoff, RotateCcw, Siren, TowerControl, type LucideIcon } from 'lucide-react'
import type { LiveEventKind } from '../live/events'
import { RUNWAY_USE_COLOR } from '../map/mapStyle'

export type EventStyle = { icon: LucideIcon; color: string; label: string; solid?: boolean }

export const EVENT_STYLE: Record<LiveEventKind, EventStyle> = {
  landed: { icon: PlaneLanding, color: RUNWAY_USE_COLOR.arrivals, label: 'Landing' },
  departed: { icon: PlaneTakeoff, color: RUNWAY_USE_COLOR.departures, label: 'Takeoff' },
  goaround: { icon: RotateCcw, color: '#FF9F0A', label: 'Go-around' },
  lineup: { icon: ArrowUpFromLine, color: '#A78BFA', label: 'Lined up' },
  emergency: { icon: Siren, color: '#FF3B30', label: 'Emergency', solid: true },
}

/** Anything the log learns to say later still gets a neutral badge. */
const FALLBACK: EventStyle = { icon: TowerControl, color: '#9AA3B5', label: 'Activity' }

export function eventStyle(kind: string | null | undefined): EventStyle {
  return (kind && EVENT_STYLE[kind as LiveEventKind]) || FALLBACK
}
