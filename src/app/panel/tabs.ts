/**
 * The side panel's tabs as data: their names, icons and keys, and what each
 * has to say for itself before it is opened (new calls, alerts, the aircraft
 * count). Shared by the tab bar and the collapsed rail. The weather tab says
 * nothing: the station bar already shows the flight category and the wind.
 */
import { AudioLines, CloudSun, Plane, Radar, type LucideIcon } from 'lucide-react'
import { usePlayhead } from '../../playback/playheadStore'
import type { DockTab } from '../../ui/layout'
import { badgeText } from './overview'
import { useOnAir, useUnreadCalls, useUnseenAlerts, type OnAir } from './panelStore'

export const TAB_LABEL: Record<DockTab, string> = { now: 'Now', transcripts: 'Radio', traffic: 'Traffic', weather: 'Weather' }
export const TAB_ICON: Record<DockTab, LucideIcon> = { now: Radar, transcripts: AudioLines, traffic: Plane, weather: CloudSun }
export const TAB_KEY: Partial<Record<DockTab, string>> = { transcripts: 'T', traffic: '/', weather: 'W' }

export const tabId = (t: DockTab) => `dock-tab-${t}`
export const tabPanelId = (t: DockTab) => `dock-panel-${t}`

export type TabSignals = { live: boolean; count: number; unread: number; alerts: number; air: OnAir }

export function useTabSignals(): TabSignals {
  const live = usePlayhead((s) => s.mode === 'live')
  const count = usePlayhead((s) => (s.liveStatus === 'ok' ? s.liveCount : 0))
  const unread = useUnreadCalls()
  const alerts = useUnseenAlerts()
  const air = useOnAir()
  return { live, count, unread, alerts, air }
}

export type TabBadge =
  | { kind: 'dot'; said: string }
  | { kind: 'unread'; text: string; said: string }
  | { kind: 'count'; text: string; said: string }

/**
 * What a tab shows beside its name, and the words a screen reader hears for
 * it. The tab being looked at doesn't count what is new on itself.
 */
export function tabBadge(tab: DockTab, active: boolean, s: TabSignals): TabBadge | null {
  if (tab === 'now') return s.alerts > 0 && !active ? { kind: 'dot', said: `, ${s.alerts} new ${s.alerts === 1 ? 'alert' : 'alerts'}` } : null
  if (tab === 'transcripts') {
    const text = active ? null : badgeText(s.unread)
    return text ? { kind: 'unread', text, said: `, ${s.unread} new ${s.unread === 1 ? 'call' : 'calls'}` } : null
  }
  if (tab === 'traffic') return s.live && s.count > 0 ? { kind: 'count', text: String(s.count), said: `, ${s.count} aircraft` } : null
  return null
}
