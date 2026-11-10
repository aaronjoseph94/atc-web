/**
 * What happened on the airfield lately (takeoffs, landings, go-arounds,
 * line-ups, emergencies), newest first, for the Recent activity list.
 *
 * Two sources, merged: the history store keeps the day's events across
 * reloads, and the playhead holds the ones detected since the app started
 * (which the history may not have caught yet). The same event has the same
 * id in both.
 */
import type { LiveEvent } from '../live/events'
import type { HistoryEntry } from '../live/history/store'

export type Activity = { id: string; at: number; kind: string; text: string; callsign: string; icao24: string | null }

export function recentActivity(history: HistoryEntry[], events: LiveEvent[], airport: string, limit: number): Activity[] {
  const byId = new Map<string, Activity>()
  for (const e of history) {
    if (e.source !== 'event' || e.airport !== airport) continue
    byId.set(e.id, { id: e.id, at: e.at, kind: e.eventKind ?? '', text: e.text, callsign: e.callsigns[0] ?? '', icao24: e.ids[0] ?? null })
  }
  for (const e of events) byId.set(e.id, { id: e.id, at: e.at, kind: e.kind, text: e.text, callsign: e.callsign, icao24: e.icao24 })
  return [...byId.values()].sort((a, b) => b.at - a.at).slice(0, limit)
}
