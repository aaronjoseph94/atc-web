/**
 * Everything the flight card and the full flight view need to know about the
 * selected aircraft, in one place: its current state (live or replayed), what
 * it is doing relative to the runways, its route and airframe, and the radio
 * calls or logged events that concern it.
 */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { formatMhz } from '../api/airportData'
import { getAirport, resolveStation } from '../api/airports'
import { getFlightInfo, summarizeTransmissions } from '../api/client'
import type { Aircraft, TranscriptCue } from '../api/types'
import { describeRelation, runwayRelation, type LiveEvent } from '../live/events'
import { liveBuffer, liveRecorder } from '../live/session'
import { runwayEnds } from '../map/airportDiagram'
import { positionsAt, trackId, trackKeyFor } from '../playback/interpolate'
import { usePlayhead } from '../playback/playheadStore'
import { flightPhase, PHASE_LABEL, PHASE_SENTENCE, summarizeExchange, type Phase } from './describe'

/** How many of this flight's recent calls are sent for summarizing. */
const RECENT_CALLS = 6

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

  const phase = detail ? flightPhase({ ...detail, altitudeFt: detail.altitudeFt == null ? null : detail.altitudeFt - (detail.onGround ? 0 : airport.elevationFt) }) : null
  const lastCall = calls[calls.length - 1]

  const summary = useQuery({
    queryKey: ['summary', selectedIcao, lastCall?.id],
    queryFn: () =>
      summarizeTransmissions({
        callsign: detail?.callsign ?? selectedIcao ?? '',
        transmissions: calls.slice(-RECENT_CALLS).map((c) => ({ speaker: c.speaker, text: c.text })),
        context: {
          airport: airport.icao,
          station: station ? `${station.label}${station.frequencyMhz ? ` ${formatMhz(station.frequencyMhz)}` : ''}` : undefined,
          phase: phase ? PHASE_LABEL[phase] : undefined,
          altitudeFt: detail?.altitudeFt ?? null,
          speedKt: detail?.speedKt ?? null,
        },
      }),
    enabled: !!selectedIcao && calls.length > 0,
    staleTime: Infinity,
    retry: 0,
    // Instant rule-based text while the AI answers.
    placeholderData: calls.length ? { summary: summarizeExchange(calls.slice(-RECENT_CALLS)), source: 'rules' as const } : undefined,
  })

  if (!selectedIcao) return null

  let now: string | null = null
  let nowSource: FlightView['nowSource'] = 'position'
  if (calls.length) {
    now = summary.data?.summary ?? summarizeExchange(calls.slice(-RECENT_CALLS))
    nowSource = summary.data?.source === 'ai' ? 'radio-ai' : 'radio'
  } else if (detail) {
    now = describeRelation(runwayRelation(detail, ends, airport.elevationFt), detail, airport.elevationFt) ?? (phase ? PHASE_SENTENCE[phase] : null)
    if (now && !/[.!?]$/.test(now)) now += '.'
  }

  const key = playing ? trackKeyFor(playing, selectedIcao) : undefined
  const track = playing && key ? playing.tracks[key].filter((s) => s.tMs <= tMs) : null
  const recorded = live ? liveRecorder.series(selectedIcao) : null
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
  return useQuery({
    queryKey: ['flight', hex, callsign],
    queryFn: () => getFlightInfo(hex, callsign),
    enabled: !!hex,
    staleTime: 30 * 60_000,
    retry: 0,
  })
}
