/**
 * The insight features' hooks that run in the background: gathering the
 * airport briefing on a schedule, noticing a return to the app, and the
 * briefing's words (AI or template) for the components that show it.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { getAirport } from '../api/airports'
import type { Weather } from '../api/types'
import { useAirfield } from '../live/airfield'
import { liveBuffer } from '../live/session'
import { runwayEnds } from '../map/airportDiagram'
import { usePlayhead } from '../playback/playheadStore'
import { useAiTask } from './ai'
import { buildBriefing, fallbackBriefing } from './briefingModel'
import { AWAY_MS } from './catchUpModel'
import { useInsightSettings } from './insightSettings'
import { useInsights } from './insightsStore'
import { parseSummary } from './parse'

/** Give the feeds this long after an airport opens: traffic, weather and the first runway sightings. */
const SETTLE_MS = 9_000
/** Don't wait longer than this for the weather. */
const WEATHER_WAIT_MS = 20_000
const BRIEFING_EVERY_MS = 20 * 60_000

/** Gather the briefing when an airport opens (once its data is in) and every twenty minutes while the app is in view. */
export function useBriefingSchedule() {
  const qc = useQueryClient()
  useEffect(() => {
    let timer = 0
    let openedAt = Date.now()
    let airport = usePlayhead.getState().airportIcao

    const gather = (open: boolean) => {
      const ph = usePlayhead.getState()
      const a = getAirport(airport)
      const w = qc.getQueryData<Weather>(['weather', airport])
      const input = buildBriefing({
        airport: a,
        aircraft: liveBuffer.sample(),
        ends: runwayEnds(airport),
        events: ph.events,
        runways: useAirfield.getState().runways,
        metar: w?.metar ?? null,
        taf: w?.taf ?? null,
        atis: w?.atis ?? [],
        now: Date.now(),
      })
      const prefs = useInsightSettings.getState()
      useInsights.getState().setBriefing(input, open && prefs.briefing && ph.mode === 'live' && !ph.selectedIcao)
    }

    const first = () => {
      const ph = usePlayhead.getState()
      const waited = Date.now() - openedAt
      const weather = qc.getQueryState(['weather', airport])
      const weatherSettled = weather?.status === 'success' || weather?.status === 'error' || waited > WEATHER_WAIT_MS
      if (ph.mode !== 'live' || ph.liveStatus !== 'ok' || waited < SETTLE_MS || !weatherSettled) {
        // Try again shortly; a feed that never answers simply means no briefing.
        if (waited < 120_000) timer = window.setTimeout(first, 2000)
        return
      }
      gather(true)
      timer = window.setTimeout(again, BRIEFING_EVERY_MS)
    }
    const again = () => {
      // Only while someone is looking; coming back offers "what did I miss?" instead.
      if (document.visibilityState === 'visible' && usePlayhead.getState().mode === 'live') gather(true)
      timer = window.setTimeout(again, BRIEFING_EVERY_MS)
    }
    timer = window.setTimeout(first, 2000)

    const off = usePlayhead.subscribe((s, prev) => {
      if (s.airportIcao === prev.airportIcao) return
      airport = s.airportIcao
      openedAt = Date.now()
      window.clearTimeout(timer)
      timer = window.setTimeout(first, 2000)
    })
    return () => {
      off()
      window.clearTimeout(timer)
    }
  }, [qc])
}

/** The briefing's words: the AI's when available, else the template. */
export function useBriefingText(): { text: string; ai: boolean } | null {
  const input = useInsights((s) => s.briefing)
  const answer = useAiTask('airportBriefing', input, parseSummary(500), 10 * 60_000, { keepPrevious: true })
  if (!input) return null
  return answer.data ? { text: answer.data, ai: true } : { text: fallbackBriefing(input), ai: false }
}

/** Notice coming back after a while away and offer the catch-up. */
export function useCatchUpWatch() {
  useEffect(() => {
    let hiddenAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null
    const on = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        return
      }
      const since = hiddenAt
      hiddenAt = null
      const ph = usePlayhead.getState()
      if (since == null || Date.now() - since < AWAY_MS || ph.mode !== 'live' || !useInsightSettings.getState().catchUp) return
      // Nothing else open on top: the catch-up shouldn't cover something the person was doing.
      if (ph.panel && ph.panel !== 'menu') return
      useInsights.getState().openCatchUp({ since, until: Date.now(), auto: true })
    }
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
}

/** Open the catch-up for the last `minutes` (the menu's "What did I miss?"). */
export function openCatchUp(minutes = 30) {
  const now = Date.now()
  useInsights.getState().openCatchUp({ since: now - minutes * 60_000, until: now, auto: false })
}

