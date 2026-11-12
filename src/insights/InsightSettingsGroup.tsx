/**
 * Settings for the "understand what's happening" features: Learn mode and
 * the glossary, the airport briefing, "what did I miss", and smart alerts
 * (which kinds, and system notifications while the app is in the background).
 */
import { BookOpen, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useLearn } from '../learn/learnStore'
import { usePlayhead } from '../playback/playheadStore'
import { Group, Row, SectionLabel, Toggle } from '../ui/Panel'
import { ALERT_KINDS, useInsightSettings } from './insightSettings'
import { notifyPermission, requestNotify, type NotifyPermission } from './notify'

export function InsightSettingsGroup() {
  const s = useInsightSettings()
  const [permission, setPermission] = useState<NotifyPermission>(notifyPermission)

  const setNotify = async (on: boolean) => {
    if (!on) return s.update('notify', false)
    const p = permission === 'granted' ? 'granted' : await requestNotify()
    setPermission(p)
    s.update('notify', p === 'granted')
    if (p === 'denied') usePlayhead.getState().setToast({ message: 'Notifications are blocked for this site in the browser settings.', tone: 'error' })
  }

  return (
    <>
      <SectionLabel>Learn and alerts</SectionLabel>
      <Group>
        <Row label="Learn mode" hint="Tap underlined ATC terms for a definition">
          <Toggle checked={s.learn} onChange={(v) => s.update('learn', v)} label="Learn mode" />
        </Row>
        <button
          type="button"
          className="pressable-soft -mx-3.5 flex min-h-12 w-[calc(100%+1.75rem)] items-center gap-2.5 border-b border-white/[0.07] px-3.5 text-left text-subhead font-medium hover:bg-white/[0.04]"
          onClick={() => {
            usePlayhead.getState().setPanel(null)
            useLearn.getState().openGlossary()
          }}
        >
          <BookOpen className="size-4 text-white/60" />
          <span className="flex-1">All ATC terms</span>
          <ChevronRight className="size-4 text-white/40" />
        </button>
        <Row label="Airport briefing" hint="Summary on open and every 20 min">
          <Toggle checked={s.briefing} onChange={(v) => s.update('briefing', v)} label="Airport briefing" />
        </Row>
        <Row label="What did I miss?" hint="Recap after 5 min away">
          <Toggle checked={s.catchUp} onChange={(v) => s.update('catchUp', v)} label="What did I miss" />
        </Row>
      </Group>

      <Group className="mt-2">
        <Row label="Alerts" hint="Go-arounds, emergencies, oddities">
          <Toggle checked={s.alerts} onChange={(v) => s.update('alerts', v)} label="Alerts" />
        </Row>
        {s.alerts && (
          <>
            {ALERT_KINDS.map((k) => (
              <Row key={k.kind} label={k.label} hint={k.hint}>
                <Toggle checked={s.alertKinds.includes(k.kind)} onChange={() => s.toggleKind(k.kind)} label={k.label} />
              </Row>
            ))}
            {permission !== 'unsupported' && (
              <Row label="Notify in the background" hint={permission === 'denied' ? 'Blocked in this browser’s site settings' : 'A system notification when the app isn’t on screen'}>
                <Toggle checked={s.notify && permission === 'granted'} onChange={(v) => void setNotify(v)} label="Notify in the background" />
              </Row>
            )}
          </>
        )}
      </Group>
    </>
  )
}
