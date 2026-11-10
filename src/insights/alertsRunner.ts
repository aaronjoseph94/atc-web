/**
 * Runs the smart-alert rules against the live app: new tower-log events, new
 * radio transcripts, the traffic every couple of seconds, and the runways in
 * use. Admitted alerts are kept (for "what did I miss?"), shown as toasts if
 * the person wants that kind, sent as system notifications while the tab is
 * hidden (with permission), and given a one-line reason by the AI when one is
 * available. Also records runway changes for the catch-up.
 */
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { askAi } from '../ai/client'
import { getAirport } from '../api/airports'
import type { Weather } from '../api/types'
import { useAirfield } from '../live/airfield'
import type { LiveEvent } from '../live/events'
import { callsFor, useRadio, type Transmission } from '../live/radio/radioStore'
import { oppositeEnds, type ActiveRunways } from '../live/runwayUse'
import { liveBuffer } from '../live/session'
import { runwayEnds } from '../map/airportDiagram'
import { usePlayhead } from '../playback/playheadStore'
import { aiReadyNow } from './ai'
import { admit, fromCall, fromEvent, watchRolls, watchRunwayDirection, type Alert, type AlertInput, type RollState, type RunwayDirState } from './alerts'
import { ALERT_KINDS, useInsightSettings, type AlertKind } from './insightSettings'
import { useInsights } from './insightsStore'
import { showNotification } from './notify'
import { parseAlertWhy } from './parse'
import { windText } from './weatherBrief'

const ALL = new Set<AlertKind>(ALERT_KINDS.map((k) => k.kind))
/** Wait this long before asking why, so the radio calls around the moment have been transcribed. */
const EXPLAIN_DELAY_MS = 8_000
/** A runway configuration must hold this long before it counts as a change (sightings flicker as they fade). */
const RUNWAY_SETTLE_MS = 45_000

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export function useAlertsEngine() {
  const qc = useQueryClient()
  useEffect(() => startAlerts(qc), [qc])
}

/** Start watching; returns the stop function. A plain function (not inside the hook) so it reads simply. */
function startAlerts(qc: QueryClient): () => void {
  let airport = usePlayhead.getState().airportIcao
  let ends = runwayEnds(airport)
  let opposite = oppositeEnds(ends)
  let rolls: RollState = new Map()
  let direction: RunwayDirState = null
  let settled: { landing: string[]; departing: string[] } | null = null
  let candidate: { landing: string[]; departing: string[]; since: number } | null = null
  // Only what happens from now on: calls and events already logged are history, not news.
  let startedAt = Date.now()
  const seenCalls = new Set<string>()
  const timers = new Set<number>()
  useInsights.getState().reset(airport)

  const weatherLine = () => {
    const w = qc.getQueryData<Weather>(['weather', airport])
    const m = w?.metar
    if (!m) return null
    return [windText(m) && `wind ${windText(m)}`, m.flightCategory, m.weather].filter(Boolean).join(', ') || null
  }

  const explain = (alert: Alert) => {
    const id = window.setTimeout(async () => {
      timers.delete(id)
      if (useInsights.getState().airport !== airport || !(await aiReadyNow())) return
      const radio = alert.icao24 ? callsFor(useRadio.getState().log, alert.icao24).filter((t) => Math.abs(t.at - alert.at) < 3 * 60_000) : []
      const live = alert.icao24 ? liveBuffer.get(alert.icao24) : null
      try {
        const raw = await askAi('explainAlert', {
          kind: alert.kind,
          title: alert.title,
          detail: alert.body,
          callsign: alert.callsign,
          aircraft: live?.type ?? null,
          runway: alert.runway,
          radio: [...radio.slice(-6).map((t) => ({ time: clock(t.at), speaker: t.speaker ?? 'radio', text: t.text })), ...(alert.quote && !radio.some((t) => t.text === alert.quote) ? [{ time: clock(alert.at), speaker: 'radio', text: alert.quote }] : [])].slice(-6),
          weather: weatherLine(),
        })
        const why = parseAlertWhy(raw)
        if (why && why.basis !== 'none' && useInsights.getState().airport === airport) useInsights.getState().setWhy(alert.id, why.why)
      } catch {
        // No AI right now: the alert stands on its own.
      }
    }, EXPLAIN_DELAY_MS)
    timers.add(id)
  }

  const raise = (inputs: AlertInput[]) => {
    if (!inputs.length || usePlayhead.getState().mode !== 'live') return
    const st = useInsights.getState()
    let log = st.alerts
    for (const input of inputs) {
      const now = Date.now()
      const res = admit(log, input, ALL, now)
      if (res.action === 'drop') continue
      log = res.action === 'merge' ? log.map((a) => (a.id === res.alert.id ? res.alert : a)) : [res.alert, ...log]
      if (res.action !== 'new') continue
      const prefs = useInsightSettings.getState()
      const wanted = prefs.alerts && prefs.alertKinds.includes(res.alert.kind)
      if (wanted) {
        st.show(res.alert.id)
        if (prefs.notify && document.visibilityState === 'hidden') void showNotification(`${airport} · ${res.alert.title}`, res.alert.body, `${airport}-${res.alert.kind}-${res.alert.icao24 ?? res.alert.runway ?? ''}`, `/#/${airport}`)
      }
      explain(res.alert)
    }
    useInsights.getState().setAlerts(log)
  }

  const onEvents = (events: LiveEvent[], prev: LiveEvent[]) => {
    const known = new Set(prev.map((e) => e.id))
    raise(events.filter((e) => !known.has(e.id) && e.at >= startedAt).map(fromEvent).filter((a): a is AlertInput => !!a))
  }

  const onRadio = (log: Record<string, Transmission[]>) => {
    const out: AlertInput[] = []
    for (const list of Object.values(log))
      for (const t of list) {
        if (t.status !== 'done' || !t.text || t.airport !== airport || seenCalls.has(t.id)) continue
        seenCalls.add(t.id)
        if (t.at < startedAt - 60_000) continue
        const ids = [t.icao24, ...t.callsigns.map((c) => c.icao24)].filter((x): x is string => !!x)
        out.push(...fromCall({ id: t.id, at: t.at, text: t.text, callsign: t.callsigns[0]?.callsign ?? null, icao24: ids[0] ?? null, speaker: t.speaker }))
      }
    raise(out)
  }

  const onRunways = (r: ActiveRunways | null) => {
    if (!r || r.basis !== 'traffic' || usePlayhead.getState().mode !== 'live') return
    const res = watchRunwayDirection(direction, r.landing, opposite, Date.now())
    direction = res.state
    if (res.alert) raise([res.alert])
    // Runway changes for the catch-up, once a new configuration has held for a while.
    const same = (a: { landing: string[]; departing: string[] } | null) => !!a && a.landing.join() === r.landing.join() && a.departing.join() === r.departing.join()
    if (same(settled)) {
      candidate = null
      return
    }
    if (!same(candidate)) candidate = { landing: r.landing, departing: r.departing, since: Date.now() }
    else if (candidate && Date.now() - candidate.since > RUNWAY_SETTLE_MS) {
      if (settled) useInsights.getState().addRunwayChange({ at: candidate.since, landing: candidate.landing, departing: candidate.departing, prevLanding: settled.landing, prevDeparting: settled.departing })
      settled = { landing: candidate.landing, departing: candidate.departing }
      candidate = null
    }
  }

  const offEvents = usePlayhead.subscribe((s, prev) => {
    if (s.airportIcao !== airport) {
      airport = s.airportIcao
      ends = runwayEnds(airport)
      opposite = oppositeEnds(ends)
      rolls = new Map()
      direction = null
      settled = null
      candidate = null
      startedAt = Date.now()
      timers.forEach((t) => window.clearTimeout(t))
      timers.clear()
      useInsights.getState().reset(airport)
      return
    }
    if (s.events !== prev.events && s.mode === 'live') onEvents(s.events, prev.events)
  })
  const offRadio = useRadio.subscribe((s, prev) => {
    if (s.log !== prev.log) onRadio(s.log)
  })
  // Calls already in the log when we start are only remembered, not alerted on.
  for (const list of Object.values(useRadio.getState().log)) for (const t of list) if (t.status === 'done') seenCalls.add(t.id)
  const offRunways = useAirfield.subscribe((s, prev) => {
    if (s.runways !== prev.runways) onRunways(s.runways)
  })
  // The traffic itself, for rejected takeoffs: every two seconds is plenty (a takeoff roll lasts thirty).
  const poll = window.setInterval(() => {
    if (usePlayhead.getState().mode !== 'live') return
    raise(watchRolls(rolls, liveBuffer.sample(), ends, getAirport(airport).elevationFt, Date.now()))
  }, 2000)

  return () => {
    offEvents()
    offRadio()
    offRunways()
    window.clearInterval(poll)
    timers.forEach((t) => window.clearTimeout(t))
  }
}
