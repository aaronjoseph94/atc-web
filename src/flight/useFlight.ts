/**
 * Everything the flight card and the full flight view need to know about the
 * selected aircraft, in one place: its current state (live or replayed), what
 * it is doing relative to the runways, its route and airframe, and the radio
 * calls or logged events that concern it.
 */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { formatMhz, icaoCode } from '../api/airportData'
import { getAirport, resolveStation } from '../api/airports'
import { getFlightInfo, summarizeTransmissions } from '../api/client'
import type { Aircraft, TranscriptCue } from '../api/types'
import { describeRelation, runwayRelation, type LiveEvent } from '../live/events'
import { callsFor, useRadio } from '../live/radio/radioStore'
import { liveBuffer, liveRecorder } from '../live/session'
import { runwayEnds } from '../map/airportDiagram'
import { positionsAt, trackId, trackKeyFor } from '../playback/interpolate'
import { usePlayhead } from '../playback/playheadStore'
import { flightPhase, PHASE_LABEL, PHASE_SENTENCE, summarizeExchange, type Phase } from './describe'
import { greatCircleNm, reconcileRoute, type RouteCheck } from './route'

/** How many of this flight's recent calls are sent for summarizing. */
const RECENT_CALLS = 6
/** Live: after this long with no call about the aircraft, "Now" goes back to describing where it is. */
const STALE_CALLS_MS = 10 * 60_000

/** Re-render a few times a second while a live aircraft is selected, so its numbers tick. */
function useTick(active: boolean, ms: number) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => set((n) => n + 1), ms)
    return () => window.clearInterval(id)
  }, [active, ms])
}

export type FlightView = {
  icao24: string
  callsign: string
  detail: Aircraft | null
  phase: Phase | null
  /** One line on what the aircraft is doing right now. */
  now: string | null
  /** Where `now` came from: a radio call explained, or worked out from position. */
  nowSource: 'radio-ai' | 'radio' | 'position'
  /** Radio calls for this flight up to the playhead (scene clips only). */
  calls: TranscriptCue[]
  /** Tower-log entries for this aircraft, newest first (live and rewinds). */
  events: LiveEvent[]
  /** Speed and altitude history for sparklines. */
  series: { altitudeFt: (number | null)[]; speedKt: (number | null)[] }
  stationLine: string
  airportCode: string
  /** True when the aircraft is real traffic (live or a rewind), false in a scripted scene. */
  real: boolean
}

export function useFlight(): FlightView | null {
  const selectedIcao = usePlayhead((s) => s.selectedIcao)
  const mode = usePlayhead((s) => s.mode)
  const clip = usePlayhead((s) => s.clip)
  const tMs = usePlayhead((s) => s.tMs)
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const stationId = usePlayhead((s) => s.stationId)
  const allEvents = usePlayhead((s) => s.events)

  const live = mode === 'live'
  useTick(live && !!selectedIcao, 500)
  // Changes once a minute, so the age check below is re-run without rebuilding the list every tick.
  const minute = Math.floor(Date.now() / 60_000)

  const airport = getAirport(airportIcao)
  const station = resolveStation(airport, stationId)
  const ends = useMemo(() => runwayEnds(airportIcao), [airportIcao])
  const playing = !live && clip ? clip : null
  const scene = playing && playing.kind !== 'rewind' ? playing : null

  const detail: Aircraft | null = !selectedIcao ? null : playing ? (positionsAt(playing, tMs).find((a) => a.icao24 === selectedIcao) ?? null) : liveBuffer.get(selectedIcao)

  const calls = useMemo<TranscriptCue[]>(() => {
    if (!scene || !selectedIcao) return []
    return scene.cues.filter((c) => c.callsign && trackId(c.callsign) === selectedIcao && c.startMs <= tMs)
  }, [scene, selectedIcao, tMs])

  // What "Now" summarises: a replayed scene's calls up to the playhead, or, live, the calls heard
  // on the radio that named this aircraft (on any channel at this airport). Only finished calls.
  const radioLog = useRadio((s) => (live ? s.log : null))
  const heard = useMemo<{ id: string; speaker?: string; text: string }[]>(() => {
    if (scene) return calls
    if (!live || !selectedIcao || !radioLog) return []
    const list = callsFor(radioLog, selectedIcao)
    const last = list[list.length - 1]
    // Old calls would read as what it is doing now.
    if (!last || Date.now() - last.at > STALE_CALLS_MS) return []
    return list.map((t) => ({ id: t.id, speaker: t.speaker ?? undefined, text: t.text }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `minute` re-checks the age as time passes
  }, [scene, calls, live, selectedIcao, radioLog, minute])

  const phase = detail ? flightPhase({ ...detail, altitudeFt: detail.altitudeFt == null ? null : detail.altitudeFt - (detail.onGround ? 0 : airport.elevationFt) }) : null
  const lastCall = heard[heard.length - 1]

  const summary = useQuery({
    queryKey: ['summary', selectedIcao, lastCall?.id],
    queryFn: () =>
      summarizeTransmissions({
        callsign: detail?.callsign ?? selectedIcao ?? '',
        transmissions: heard.slice(-RECENT_CALLS).map((c) => ({ speaker: c.speaker, text: c.text })),
        context: {
          airport: airport.icao,
          station: station ? `${station.label}${station.frequencyMhz ? ` ${formatMhz(station.frequencyMhz)}` : ''}` : undefined,
          phase: phase ? PHASE_LABEL[phase] : undefined,
          altitudeFt: detail?.altitudeFt ?? null,
          speedKt: detail?.speedKt ?? null,
        },
      }),
    enabled: !!selectedIcao && heard.length > 0,
    staleTime: Infinity,
    retry: 0,
    // Instant rule-based text while the AI answers.
    placeholderData: heard.length ? { summary: summarizeExchange(heard.slice(-RECENT_CALLS)), source: 'rules' as const } : undefined,
  })

  if (!selectedIcao) return null

  let now: string | null = null
  let nowSource: FlightView['nowSource'] = 'position'
  if (heard.length) {
    now = summary.data?.summary ?? summarizeExchange(heard.slice(-RECENT_CALLS))
    nowSource = summary.data?.source === 'ai' ? 'radio-ai' : 'radio'
  } else if (detail) {
    now = describeRelation(runwayRelation(detail, ends, airport.elevationFt), detail, airport.elevationFt) ?? (phase ? PHASE_SENTENCE[phase] : null)
    if (now && !/[.!?]$/.test(now)) now += '.'
  }

  const key = playing ? trackKeyFor(playing, selectedIcao) : undefined
  const track = playing && key ? playing.tracks[key].filter((s) => s.tMs <= tMs) : null
  // The recorder logs reports as they arrive, but the map (and the numbers on the card) show the
  // aircraft a few seconds late: trim the graphs to the moment being drawn and end them on the
  // drawn values, so the last point of each line is the number printed beside it.
  let recorded = live ? liveRecorder.series(selectedIcao) : null
  if (recorded && detail) {
    const shownAt = Date.now() - (liveBuffer.delayOf(selectedIcao) ?? liveBuffer.delayMs)
    recorded = [...recorded.filter((s) => s.t <= shownAt), { t: shownAt, altitudeFt: detail.altitudeFt ?? null, speedKt: detail.speedKt ?? null }]
  }
  const series = {
    altitudeFt: track ? track.map((s) => s.altitudeFt ?? null) : (recorded?.map((s) => s.altitudeFt) ?? []),
    speedKt: track ? track.map((s) => s.speedKt ?? null) : (recorded?.map((s) => s.speedKt) ?? []),
  }

  return {
    icao24: selectedIcao,
    callsign: detail?.callsign ?? (key && playing?.aircraft?.[key]?.callsign) ?? selectedIcao.toUpperCase(),
    detail,
    phase,
    now,
    nowSource,
    calls,
    events: scene ? [] : allEvents.filter((e) => e.icao24 === selectedIcao),
    series,
    stationLine: `${airport.icao} ${station?.label ?? 'Tower'}${station?.frequencyMhz != null ? ` ${formatMhz(station.frequencyMhz)}` : ''}`,
    airportCode: airport.icao,
    real: !scene,
  }
}

/** Route and airframe for real traffic. Scripted scenes use invented flights, so nothing is looked up. */
export function useFlightInfo(flight: FlightView | null) {
  const hex = flight?.real && /^[0-9a-f]{6}$/.test(flight.icao24) ? flight.icao24 : null
  const callsign = flight?.real ? flight.callsign : null
  const check = routeCheck(flight)
  return useQuery({
    queryKey: ['flight', hex, callsign],
    // Only an opened flight reaches this hook, so the server may use its paid last resort for it.
    queryFn: () => getFlightInfo(hex, callsign, { deep: true }),
    enabled: !!hex,
    staleTime: 30 * 60_000,
    retry: 0,
    // The route is checked against what the aircraft is doing here: the other leg of a re-used
    // flight number is flipped round, and a route that can't be right is dropped (see route.ts).
    select: (info) => (info && check ? reconcileRoute(info, check) : info),
  })
}

/** How the selected aircraft relates to the watched airport, for `reconcileRoute`. */
function routeCheck(flight: FlightView | null): RouteCheck | null {
  const d = flight?.detail
  if (!flight || !d || d.lat == null || d.lon == null) return null
  const airport = getAirport(flight.airportCode)
  const nm = greatCircleNm({ lat: d.lat, lon: d.lon }, { lat: airport.center[1], lon: airport.center[0] })
  const agl = d.onGround ? 0 : d.altitudeFt == null ? null : d.altitudeFt - airport.elevationFt
  const near = nm < 40 && (d.onGround || (agl != null && agl < 12_000))
  const p = flight.phase
  const heading = p === 'final' || p === 'descending' ? 'arriving' : p === 'takeoff' || p === 'climbing' ? 'departing' : 'unclear'
  return { here: airport.icao, hereIcao: icaoCode(airport.icao) ?? null, heading, near }
}
