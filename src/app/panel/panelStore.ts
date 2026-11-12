/**
 * What the side panel remembers for its badges: when the Radio tab and the
 * overview's alerts were last looked at, so a tab (and the collapsed rail)
 * can say "4 new" instead of making people check. Session only.
 */
import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { getAirport } from '../../api/airports'
import type { Metar } from '../../api/types'
import { useInsights } from '../../insights/insightsStore'
import { useHistory } from '../../live/history/store'
import { statusText, useRadio } from '../../live/radio/radioStore'
import { liveBuffer } from '../../live/session'
import { runwayEnds } from '../../map/airportDiagram'
import { getActiveCue } from '../../playback/interpolate'
import { usePlayhead } from '../../playback/playheadStore'
import type { LampState } from '../../ui/kit'
import { speakerColors, type RadioSpeaker, type SpeakerColors } from '../../ui/speaker'
import { countTraffic, NO_TRAFFIC, sameCounts, unreadCalls, type TrafficCounts } from './overview'

type PanelState = {
  /** Calls heard after this are new to the viewer. Starts now: yesterday's saved history isn't news. */
  radioSeenAt: number
  alertsSeenAt: number
  markRadioSeen: () => void
  markAlertsSeen: () => void
}

export const usePanel = create<PanelState>((set) => ({
  radioSeenAt: Date.now(),
  alertsSeenAt: Date.now(),
  markRadioSeen: () => set({ radioSeenAt: Date.now() }),
  markAlertsSeen: () => set({ alertsSeenAt: Date.now() }),
}))

/** Radio calls heard since the Radio tab was last showing. */
export function useUnreadCalls(): number {
  const seenAt = usePanel((s) => s.radioSeenAt)
  return useHistory((s) => unreadCalls(s.entries, seenAt))
}

/** Alerts raised since the overview was last showing. */
export function useUnseenAlerts(): number {
  const seenAt = usePanel((s) => s.alertsSeenAt)
  return useInsights((s) => s.alerts.reduce((n, a) => n + (a.at > seenAt ? 1 : 0), 0))
}

export type OnAir = {
  /** The radio (or a replay with sound) is playing. */
  listening: boolean
  /** Somebody is transmitting right now. */
  speaking: boolean
  speaker: RadioSpeaker
  /** The speaker's colours (pink for ATC, blue for a pilot), from the one place the app defines them. */
  colors: SpeakerColors
}

/** Who has the microphone, for the lamp in the header and on the rail: live radio, or the cue being spoken in a replay. */
export function useOnAir(): OnAir {
  const playback = usePlayhead((s) => s.mode === 'playback')
  const liveListening = useRadio((s) => s.on && (s.status === 'live' || s.status === 'buffering'))
  const liveSpeaking = useRadio((s) => s.speaking)
  const liveSpeaker = useRadio((s) => (s.focus && s.focus.until > Date.now() ? s.focus.speaker : s.speaking ? (s.caption?.speaker ?? null) : null))
  // In a replay the store's clock ticks every frame; pick out only who is speaking, so this re-renders per cue, not per frame.
  const cueSpeaker = usePlayhead((s): 'pilot' | 'controller' | null => {
    if (s.mode !== 'playback' || !s.clip || !s.playing) return null
    const cue = getActiveCue(s.clip.cues, s.tMs)
    return cue ? (/pilot/i.test(cue.speaker ?? '') ? 'pilot' : 'controller') : null
  })
  const replayPlaying = usePlayhead((s) => s.mode === 'playback' && s.playing && !!s.clip?.audioUrl)
  const speaking = playback ? cueSpeaker != null : liveListening && liveSpeaking
  const speaker = playback ? cueSpeaker : liveSpeaker
  return useMemo(() => ({ listening: playback ? replayPlaying : liveListening, speaking, speaker, colors: speakerColors(speaker) }), [playback, replayPlaying, liveListening, speaking, speaker])
}

/**
 * How the live traffic splits up right now. Sampled every couple of seconds
 * while `active` (the map keeps its own 60 fps copy) and only handed on when a
 * number actually changed, so the tiles don't re-render for nothing.
 */
export function useTrafficCounts(active = true): TrafficCounts {
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const live = usePlayhead((s) => s.mode === 'live')
  const [counts, setCounts] = useState<TrafficCounts>(NO_TRAFFIC)
  useEffect(() => {
    if (!active || !live) return
    const airport = getAirport(airportIcao)
    const ends = runwayEnds(airportIcao)
    const read = () => {
      const next = countTraffic(liveBuffer.sample(), ends, airport.elevationFt)
      setCounts((prev) => (sameCounts(prev, next) ? prev : next))
    }
    read()
    const id = window.setInterval(read, 2000)
    return () => window.clearInterval(id)
  }, [active, live, airportIcao])
  return live ? counts : NO_TRAFFIC
}

/** "300° 9" / "Calm" / "Vrb 4G18": the wind as the station bar writes it. */
export function windShort(m: Pick<Metar, 'windKt' | 'windDirDeg' | 'gustKt'>): string {
  if (!m.windKt) return 'Calm'
  return `${m.windDirDeg != null ? `${String(m.windDirDeg).padStart(3, '0')}°` : 'Vrb'} ${m.windKt}${m.gustKt ? `G${m.gustKt}` : ''}`
}

/** What the lamp shows for the radio's state. */
export function useLampState(): { state: LampState; color: string; label: string } {
  const playback = usePlayhead((s) => s.mode === 'playback')
  const on = useRadio((s) => s.on)
  const status = useRadio((s) => s.status)
  const retryInS = useRadio((s) => s.retryInS)
  const air = useOnAir()
  if (playback) return { state: air.speaking ? 'speaking' : air.listening ? 'live' : 'off', color: air.colors.base, label: air.speaking ? 'On the air' : 'Replay' }
  if (!on || status === 'off' || status === 'nofeed' || status === 'blocked') return { state: 'off', color: air.colors.base, label: status === 'nofeed' ? 'No live audio for this channel' : 'Radio off' }
  if (status === 'live' || status === 'buffering') return { state: air.speaking ? 'speaking' : 'live', color: air.colors.base, label: air.speaking ? 'On the air' : 'Live' }
  return { state: 'waiting', color: air.colors.base, label: statusText(status, retryInS) }
}
