/**
 * Near the top of the flight detail: the flight's story so far (a short
 * paragraph from its timeline, tower log and radio calls) and one to three
 * facts about the route, the operator and the aircraft. Both are built from
 * the app's own data; with an AI key they are worded more naturally (marked
 * with the sparkle), never extended.
 */
import { Lightbulb } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { icaoCode } from '../api/airportData'
import { getAirport } from '../api/airports'
import type { FlightInfo, RouteAirport, TrackSample } from '../api/types'
import { airlineInfo, parseCallsign } from '../airline/airlines'
import { aircraftProfile } from '../aircraft/types'
import { friendlyFlightName } from '../flight/describe'
import { buildTimeline, type TrackPoint } from '../flight/timeline'
import type { FlightView } from '../flight/useFlight'
import { useHistory } from '../live/history/store'
import { callsFor, useRadio } from '../live/radio/radioStore'
import { liveRecorder } from '../live/session'
import { runwayEnds } from '../map/airportDiagram'
import { sampleOnGround, trackKeyFor } from '../playback/interpolate'
import { usePlayhead } from '../playback/playheadStore'
import { useNow } from '../hooks/useNow'
import { useAiTask } from './ai'
import { AiMark } from './AiMark'
import { buildFacts } from './facts'
import { parseFacts, parseStory } from './parse'
import { buildStoryInput, fallbackStory, storyKey, type StoryData } from './story'

const fromSample = (t: number, s: TrackSample): TrackPoint => ({ t, lat: s.lat, lon: s.lon, heading: s.heading, altitudeFt: s.altitudeFt ?? null, speedKt: s.speedKt ?? null, onGround: sampleOnGround(s) })

const placeName = (a: RouteAirport | null | undefined) => (a ? [a.city ?? a.name, a.iata ?? a.icao].filter(Boolean).join(' ') || null : null)

/**
 * `value` once it has stayed the same (by `key`) for `ms`: so a flight whose
 * timeline is still filling in asks the AI once it settles, not on every
 * new position.
 */
function useSettled<T>(value: T | null, key: string, ms: number): T | null {
  const json = value == null ? null : JSON.stringify(value)
  const latest = useRef(json)
  useEffect(() => {
    latest.current = json
  })
  const [settled, setSettled] = useState<{ key: string; json: string | null } | null>(null)
  useEffect(() => {
    const id = window.setTimeout(() => setSettled({ key, json: latest.current }), ms)
    return () => window.clearTimeout(id)
  }, [key, ms])
  return useMemo(() => (settled && settled.key === key && settled.json ? (JSON.parse(settled.json) as T) : null), [settled, key])
}

export function FlightInsights({ flight, info }: { flight: FlightView; info: FlightInfo | undefined }) {
  const mode = usePlayhead((s) => s.mode)
  const clip = usePlayhead((s) => s.clip)
  const tMs = usePlayhead((s) => s.tMs)
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const radioLog = useRadio((s) => s.log)
  const history = useHistory((s) => s.entries)
  const now = useNow(60_000)
  const live = mode === 'live'
  const playing = !live && clip ? clip : null
  const airport = getAirport(airportIcao)
  const ends = useMemo(() => runwayEnds(airportIcao), [airportIcao])
  const id = flight.icao24

  // The same timeline the flight view draws, from the recorded or replayed track.
  const key = playing ? trackKeyFor(playing, id) : undefined
  const clipTrack = playing && key ? playing.tracks[key] : null
  const full: TrackPoint[] = clipTrack ? clipTrack.map((s) => fromSample(s.tMs, s)) : live ? liveRecorder.track(id).map((s) => fromSample(s.t, s)) : []
  const seen = live ? full : full.filter((p) => p.t <= tMs)
  const icao4 = icaoCode(airport.icao)
  const isHere = (a: RouteAirport | null | undefined) => !!a && (a.iata === airport.icao || (!!icao4 && a.icao === icao4))
  const roleHint = isHere(info?.destination) ? 'arrival' : isHere(info?.origin) ? 'departure' : null
  const shift = playing?.kind === 'rewind' ? (playing.startedAt ?? 0) : 0
  const timeline = buildTimeline(seen, { ends, elevationFt: airport.elevationFt, roleHint, events: flight.events.map((e) => ({ kind: e.kind, at: e.at - shift, runway: e.runway })) })

  // Times as the timeline shows them: the wall clock for real traffic, clip time in a scripted scene.
  const base = live ? 0 : playing?.kind === 'rewind' ? (playing.startedAt ?? null) : null
  const clock = (t: number) => {
    if (base == null) {
      const s = Math.max(0, Math.round(t / 1000))
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
    }
    return new Date(base + t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }

  const d = flight.detail
  const profile = aircraftProfile({ type: d?.type, category: d?.category, dbName: info?.typeName, dbManufacturer: info?.manufacturer })
  const airline = info?.airline ?? airlineInfo(parseCallsign(flight.callsign)?.prefix)?.name ?? null
  const calls = live
    ? callsFor(radioLog, id).map((c) => ({ at: c.at - shift, speaker: c.speaker, text: c.text }))
    : flight.calls.map((c) => ({ at: c.startMs, speaker: /pilot/i.test(c.speaker ?? '') ? 'pilot' : 'controller', text: c.text }))
  const story: StoryData = {
    callsign: flight.callsign,
    name: friendlyFlightName(flight.callsign),
    airline,
    aircraft: profile.title,
    from: placeName(info?.origin),
    to: placeName(info?.destination),
    airport: airport.icao,
    timeline,
    events: flight.events.map((e) => ({ at: e.at - shift, text: e.text })).sort((a, b) => a.at - b.at),
    calls,
    clock,
  }
  const storyInput = buildStoryInput(story)
  const askStory = useSettled(storyInput.steps.length || storyInput.radio.length ? storyInput : null, storyKey(storyInput), 2500)
  const aiStory = useAiTask('flightStory', askStory, parseStory, 3 * 60_000)

  const facts = flight.real ? buildFacts({ callsign: flight.callsign, info, aircraftTitle: profile.title, typeFacts: profile.facts, airport: airport.icao, history, icao24: id, now }) : []
  const factIds = facts.map((f) => f.id).join(',')
  const askFacts = useSettled(facts.length >= 2 ? { callsign: flight.callsign, facts: facts.slice(0, 8) } : null, `${id}|${factIds}`, 2500)
  // Only ids we sent come back (the request is identified by its input, so a new function each render is fine).
  const aiFacts = useAiTask('flightFacts', askFacts, parseFacts(new Set(factIds.split(','))), 6 * 3_600_000)
  const shownFacts = aiFacts.data ?? facts.slice(0, 3)

  // The built-in story changes only with a new phase, event or call (like the AI's), not with every
  // position report: a phase that flickers between two readings mustn't make the paragraph jump.
  const fallback = fallbackStory(story)
  const steadyFallback = useSettled(fallback, storyKey(storyInput), 2500)
  const text = aiStory.data ?? steadyFallback ?? fallback
  return (
    <section aria-label="Story so far" className="mt-4 animate-rise rounded-2xl bg-white/[0.06] px-4 pb-3.5 pt-3 ring-1 ring-white/[0.04]">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-white/60">
        Story so far
        {aiStory.data && <AiMark />}
      </h3>
      <p className="mt-1 text-[15px] leading-snug text-white/90">{text}</p>
      {shownFacts.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-white/[0.08] pt-3" aria-label="Facts about this flight">
          {shownFacts.map((f) => (
            <li key={f.id} className="flex gap-2 text-sm leading-snug text-white/75">
              <Lightbulb aria-hidden className="mt-0.5 size-3.5 shrink-0 text-atc-yellow" strokeWidth={2.25} />
              <span className="min-w-0">
                {f.text}
                {aiFacts.data && <AiMark className="ml-1" />}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
