/**
 * Purple detail card for the selected aircraft, written for people who
 * don't speak aviation: airline + flight number, what the aircraft is doing
 * right now, speed/altitude in familiar units, and a plain-English summary
 * of the latest radio exchange (AI when the server has a key, rules otherwise).
 *
 * Live mode reads from the shared TanStack Query cache (same key as the map);
 * playback mode interpolates the clip track at the current playhead.
 */
import { useQuery } from '@tanstack/react-query'
import { ArrowUp, Compass, Gauge, Plane, Radio, Sparkles, X } from 'lucide-react'
import { useMemo } from 'react'
import { formatMhz } from '../api/airportData'
import { getAirport } from '../api/airports'
import { getAircraft, summarizeTransmissions } from '../api/client'
import type { Aircraft, TrackSample, TranscriptCue } from '../api/types'
import { interpolateTrack } from '../playback/interpolate'
import { usePlayhead } from '../playback/playheadStore'
import { formatAltitude, formatSpeed, useSettings } from '../settings/settingsStore'
import {
  aircraftTypeName,
  altitudeComparison,
  compassDirection,
  describeCallsign,
  flightPhase,
  PHASE_LABEL,
  PHASE_SENTENCE,
  summarizeExchange,
} from './describe'

/** How many of this flight's recent calls are sent for summarizing. */
const RECENT_CALLS = 6

export function FlightSheet() {
  const open = usePlayhead((s) => s.sheetOpen)
  const selectedIcao = usePlayhead((s) => s.selectedIcao)
  const mode = usePlayhead((s) => s.mode)
  const clip = usePlayhead((s) => s.clip)
  const tMs = usePlayhead((s) => s.tMs)
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const stationId = usePlayhead((s) => s.stationId)
  const setSheetOpen = usePlayhead((s) => s.setSheetOpen)
  const altitudeUnit = useSettings((s) => s.altitudeUnit)
  const speedUnit = useSettings((s) => s.speedUnit)

  // Shares the map's cache entry; never triggers its own network poll.
  const { data: live } = useQuery({
    queryKey: ['aircraft', airportIcao],
    queryFn: () => getAircraft(airportIcao),
    enabled: mode === 'live' && open,
    staleTime: Infinity,
  })

  const detail = useMemo<Aircraft | null>(() => {
    if (!selectedIcao) return null
    if (mode === 'playback' && clip) {
      const key = Object.keys(clip.tracks).find((k) => k.toLowerCase() === selectedIcao.toLowerCase())
      if (!key) return null
      const p = interpolateTrack(clip.tracks[key], tMs)
      if (!p) return null
      return {
        icao24: selectedIcao,
        callsign: key,
        lat: p.lat,
        lon: p.lon,
        heading: p.heading,
        altitudeFt: p.altitudeFt ?? null,
        speedKt: p.speedKt ?? null,
        onGround: (p.altitudeFt ?? 0) < 50,
        verticalRateFpm: climbRate(clip.tracks[key], tMs),
      }
    }
    return live?.find((a) => a.icao24 === selectedIcao) ?? null
  }, [selectedIcao, mode, clip, tMs, live])

  // Radio calls for this flight up to the playhead (playback only; live feeds carry no audio).
  const calls = useMemo<TranscriptCue[]>(() => {
    if (mode !== 'playback' || !clip || !detail) return []
    const cs = detail.callsign.replace(/\s/g, '')
    return clip.cues.filter((c) => c.callsign?.replace(/\s/g, '') === cs && c.startMs <= tMs).slice(-RECENT_CALLS)
  }, [mode, clip, detail, tMs])

  const airport = getAirport(airportIcao)
  const station = airport.stations.find((s) => s.id === stationId) ?? airport.stations[0]
  const phase = detail ? flightPhase(detail) : null

  const lastCall = calls[calls.length - 1]
  const summary = useQuery({
    queryKey: ['summary', detail?.callsign, lastCall?.id],
    queryFn: () =>
      summarizeTransmissions({
        callsign: detail!.callsign,
        transmissions: calls.map((c) => ({ speaker: c.speaker, text: c.text })),
        context: {
          airport: airport.icao,
          station: station ? `${station.label}${station.frequencyMhz ? ` ${formatMhz(station.frequencyMhz)}` : ''}` : undefined,
          phase: phase ? PHASE_LABEL[phase] : undefined,
          altitudeFt: detail?.altitudeFt ?? null,
          speedKt: detail?.speedKt ?? null,
        },
      }),
    enabled: !!detail && calls.length > 0,
    staleTime: Infinity,
    retry: 0,
    // Instant rule-based text while the AI answers.
    placeholderData: calls.length ? { summary: summarizeExchange(calls), source: 'rules' as const } : undefined,
  })

  if (!open || !selectedIcao) return null

  const callsign = detail?.callsign ?? selectedIcao.toUpperCase()
  const { airline, flightNumber } = describeCallsign(callsign)
  const typeName = aircraftTypeName(detail?.type)
  const who = airline && flightNumber ? `${airline} flight ${flightNumber}` : detail?.registration ?? 'Private or unlisted flight'
  const comparison = altitudeComparison(detail?.altitudeFt)

  return (
    <section
      aria-label={`Flight ${callsign}`}
      className="pointer-events-auto w-full animate-rise overflow-hidden rounded-t-3xl bg-gradient-to-b from-atc-card to-atc-card-deep text-white shadow-[0_-12px_40px_rgba(0,0,0,0.45)] ring-1 ring-white/15 md:w-[min(92vw,40rem)] md:rounded-3xl"
    >
      {/* Header: identity */}
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-full bg-white/15 ring-1 ring-white/20">
            <Plane className="size-5 -rotate-45" />
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h2 className="truncate text-2xl font-extrabold tracking-tight">{callsign}</h2>
              {detail?.type && (
                <span className="rounded-md bg-white/15 px-1.5 py-0.5 text-[11px] font-bold tracking-wide" title={typeName ?? undefined}>
                  {detail.type}
                </span>
              )}
            </div>
            <div className="truncate text-sm text-white/80">
              {detail ? [who, typeName].filter(Boolean).join(' · ') : 'Waiting for position…'}
            </div>
          </div>
        </div>
        <button
          type="button"
          aria-label="Close flight details"
          className="rounded-full bg-white/15 p-2 transition hover:bg-white/25"
          onClick={() => setSheetOpen(false)}
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Status + numbers */}
      {detail && phase && (
        <div className="mt-3 px-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-atc-card">
              {PHASE_LABEL[phase]}
            </span>
            <span className="text-xs text-white/85">{PHASE_SENTENCE[phase]}</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Stat
              icon={Gauge}
              label="Speed"
              value={formatSpeed(detail.speedKt, speedUnit)}
              hint={detail.speedKt != null && speedUnit === 'kt' ? `${Math.round(detail.speedKt * 1.15078)} mph` : undefined}
            />
            <Stat
              icon={ArrowUp}
              label="Altitude"
              value={detail.onGround ? 'Ground' : formatAltitude(detail.altitudeFt, altitudeUnit)}
              hint={comparison ?? undefined}
            />
            <Stat
              icon={Compass}
              label="Heading"
              value={`${Math.round(detail.heading)}°`}
              hint={`toward the ${compassDirection(detail.heading)}`}
            />
          </div>
        </div>
      )}

      {/* Latest radio exchange, explained */}
      <div className="mx-4 mt-3 rounded-2xl bg-black/25 p-3 ring-1 ring-white/10">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white/70">
          {summary.data?.source === 'ai' ? <Sparkles className="size-3.5" /> : <Radio className="size-3.5" />}
          <span>Now</span>
          {lastCall?.speaker && <span className="ml-auto font-medium normal-case tracking-normal text-white/55">from {lastCall.speaker}</span>}
        </div>
        {calls.length > 0 ? (
          <>
            <p className="mt-1 text-[15px] font-semibold leading-snug">{summary.data?.summary ?? summarizeExchange(calls)}</p>
            {lastCall && <p className="mt-1.5 text-xs italic leading-snug text-white/65">“{lastCall.text}”</p>}
          </>
        ) : (
          <p className="mt-1 text-sm leading-snug text-white/80">
            {mode === 'live'
              ? 'No radio calls to show — free live feeds carry positions only, not tower audio. Open the menu and try Playback to hear a real exchange.'
              : 'No radio calls for this flight yet. Keep listening.'}
          </p>
        )}
      </div>

      {/* Station line */}
      <div className="flex items-center justify-center gap-2 px-4 pb-[max(0.9rem,var(--safe-bottom))] pt-3 text-xs text-white/80">
        <span className="font-semibold">
          {airport.icao} {station?.label ?? 'Tower'}
        </span>
        {station?.frequencyMhz && <span className="tabular-nums text-white/65">{formatMhz(station.frequencyMhz)} MHz</span>}
      </div>
    </section>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Gauge
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="min-w-0 rounded-xl bg-white/10 px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white/65">
        <Icon className="size-3" />
        {label}
      </div>
      <div className="truncate text-base font-bold tabular-nums">{value}</div>
      {hint && <div className="truncate text-[10px] text-white/60">{hint}</div>}
    </div>
  )
}

/** Approximate vertical speed (ft/min) from neighbouring track samples. */
function climbRate(samples: TrackSample[], tMs: number): number | null {
  const a = interpolateTrack(samples, Math.max(0, tMs - 1000))
  const b = interpolateTrack(samples, tMs + 1000)
  if (!a || !b || a.altitudeFt == null || b.altitudeFt == null) return null
  const dt = (b.tMs - a.tMs) / 60000
  return dt > 0 ? Math.round((b.altitudeFt - a.altitudeFt) / dt) : null
}
