/**
 * The full flight view: a page of everything known about the selected
 * aircraft. A sheet on phones; in the desktop side panel, a page that slides
 * in over the tabs.
 *
 * Top to bottom: a slim bar (back to the tabs in the side panel, a small
 * title once the big one has scrolled away, follow and close), the purple
 * hero (who it is, what it is doing, its route), its live numbers, its story
 * so far, the aircraft, the timeline, and the conversation: live radio calls
 * that named it, a replayed scene's calls, or the tower's log.
 */
import { ChevronLeft, Pause, Play, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AircraftPanel } from '../aircraft/AircraftPanel'
import { AirlineLogo } from '../airline/AirlineLogo'
import type { TranscriptCue } from '../api/types'
import { FlightInsights } from '../insights/FlightInsights'
import { callsFor, useRadio, type Transmission } from '../live/radio/radioStore'
import { CallExtras, CallText, ThreadStory } from '../live/radio/understand/CallExtras'
import { usePlayhead } from '../playback/playheadStore'
import { EventBadge } from '../ui/EventBadge'
import { Hint } from '../ui/kit'
import { Grabber, SectionLabel, useDialog } from '../ui/Panel'
import { speakerColors } from '../ui/speaker'
import { usePresence } from '../ui/usePresence'
import { useSheetDrag } from '../ui/useSheetDrag'
import { PHASE_LABEL } from './describe'
import { FlightHero, RouteCaveat } from './FlightHero'
import { FollowButton } from './FollowButton'
import { FlightSummary } from './FlightSummary'
import { FlightTimeline } from './FlightTimeline'
import { useFlight, useFlightInfo } from './useFlight'

/**
 * A bubble washed in its speaker's colour (from src/ui/speaker.ts): strong
 * enough to tell the two sides apart, soft enough that white text reads on
 * either whatever the colours are.
 */
function bubbleStyle(pilot: boolean): CSSProperties {
  const c = speakerColors(pilot ? 'pilot' : 'controller')
  return { backgroundColor: `color-mix(in srgb, ${c.base} ${pilot ? 30 : 22}%, rgb(255 255 255 / 0.04))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c.light} 26%, transparent)` }
}

/**
 * One radio call in a replayed conversation, in its speaker's colour: the
 * controller's on the left, the pilot's on the right. Tap to hear it again;
 * the call on the air wears a pause button whose ring fills as it is spoken.
 */
function CallBubble({ cue }: { cue: TranscriptCue }) {
  const pilot = /pilot/i.test(cue.speaker ?? '')
  const playing = usePlayhead((s) => s.playing)
  const progress = usePlayhead((s) => (s.tMs >= cue.startMs && s.tMs < cue.endMs ? (s.tMs - cue.startMs) / Math.max(1, cue.endMs - cue.startMs) : -1))
  const setTMs = usePlayhead((s) => s.setTMs)
  const setPlaying = usePlayhead((s) => s.setPlaying)
  const onAir = progress >= 0
  const R = 15
  const C = 2 * Math.PI * R
  return (
    <li className={`relative max-w-[86%] animate-rise ${pilot ? 'self-end' : 'self-start'}`}>
      <button
        type="button"
        data-no-drag
        onClick={() => {
          if (onAir && playing) return setPlaying(false)
          if (!onAir) setTMs(cue.startMs)
          setPlaying(true)
        }}
        aria-label={`${pilot ? 'Pilot' : 'Controller'}: ${cue.text}. ${onAir && playing ? 'Pause' : 'Play this call'}`}
        style={bubbleStyle(pilot)}
        className="pressable-soft block w-full rounded-[1.25rem] px-3.5 py-2.5 text-left text-subhead leading-snug text-white/95 hover:brightness-125"
      >
        {cue.text}
      </button>
      {onAir && (
        <span aria-hidden className={`pointer-events-none absolute -top-4 flex size-9 animate-pop items-center justify-center rounded-full bg-atc-magenta shadow-lg ${pilot ? '-left-3' : '-right-3'}`}>
          <svg viewBox="0 0 36 36" className="absolute inset-0 size-9 -rotate-90">
            <circle cx="18" cy="18" r={R} fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} />
          </svg>
          {playing ? <Pause className="size-3.5 fill-white text-white" /> : <Play className="size-3.5 fill-white text-white" />}
        </span>
      )}
    </li>
  )
}

/** One live radio call in the conversation, styled like the replayed ones. */
function LiveCallBubble({ call }: { call: Transmission }) {
  const pilot = call.speaker === 'pilot'
  const who = pilot ? 'Pilot' : call.speaker === 'controller' ? 'Controller' : 'Radio'
  const time = new Date(call.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
  return (
    <li className={`max-w-[86%] animate-rise ${pilot ? 'self-end' : 'self-start'}`} aria-label={`${who} at ${time}: ${call.text}`}>
      <p style={bubbleStyle(pilot)} className="rounded-[1.25rem] px-3.5 py-2.5 text-subhead leading-snug text-white/95">
        <CallText call={call} />
      </p>
      <CallExtras id={call.id} align={pilot ? 'end' : 'start'} />
      <p className={`mt-1 px-2 text-caption2 tabular-nums text-white/50 ${pilot ? 'text-right' : ''}`}>
        {who} · {time}
      </p>
    </li>
  )
}

/** The yellow airport sign in miniature, in front of a radio section's title. */
function CodeChip({ airport }: { airport: string }) {
  return <span className="rounded bg-atc-yellow px-1.5 py-0.5 font-display text-xs leading-none tracking-wide text-black">{airport}</span>
}

/**
 * `docked`: rendered in the desktop side panel (no backdrop, no drag, no focus
 * trap) instead of as a sheet. There it is a page over the panel's tabs, and
 * `onBack` returns to them (to the one named by `backLabel`) with the flight
 * still selected.
 */
export function FlightDetail({ docked = false, onBack, backLabel }: { docked?: boolean; onBack?: () => void; backLabel?: string }) {
  const sheet = usePlayhead((s) => s.sheet)
  const setSheet = usePlayhead((s) => s.setSheet)
  const select = usePlayhead((s) => s.select)
  const mode = usePlayhead((s) => s.mode)
  const flight = useFlight()
  const infoQuery = useFlightInfo(flight)
  const info = infoQuery.data
  // Live radio calls that named this aircraft, on any channel at this airport.
  const radioLog = useRadio((s) => s.log)
  const selectedIcao = usePlayhead((s) => s.selectedIcao)
  const liveCalls = useMemo(() => (mode === 'live' && selectedIcao ? callsFor(radioLog, selectedIcao) : []), [mode, selectedIcao, radioLog])
  const open = (docked || sheet === 'full') && !!flight
  const collapse = () => setSheet('card')
  const { mounted, closing } = usePresence(open, 240)
  const ref = useDialog(open && !docked, collapse)
  const drag = useSheetDrag({ onDown: collapse, threshold: 90, enabled: () => !docked })

  // Once the big callsign has scrolled away, a small one takes its place in the bar at the top.
  const title = useRef<HTMLHeadingElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)
  const shown = mounted && !!flight
  useEffect(() => {
    const el = title.current
    const root = scroller.current
    if (!shown || !el || !root || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting), { root, threshold: 0.15 })
    io.observe(el)
    return () => io.disconnect()
  }, [shown])

  if (!mounted || !flight) return null
  const d = flight.detail

  return (
    <div className={docked ? 'flex h-full flex-col' : 'absolute inset-0 z-40 flex items-end justify-center md:items-center md:p-6'}>
      {!docked && <button type="button" tabIndex={-1} aria-label="Collapse" className={`absolute inset-0 bg-black/55 ${closing ? 'animate-fade-out' : 'animate-fade'}`} onClick={collapse} />}
      <div
        ref={ref}
        role={docked ? 'region' : 'dialog'}
        aria-modal={docked ? undefined : 'true'}
        aria-label={`Flight ${flight.callsign}`}
        tabIndex={-1}
        style={drag.dragging || drag.style.transform ? drag.style : undefined}
        className={
          docked
            ? 'flex min-h-0 flex-1 flex-col outline-none'
            : `grain relative flex h-[calc(100dvh-max(2.75rem,var(--safe-top)))] w-full flex-col overflow-hidden rounded-t-[1.75rem] bg-[#15181F] shadow-2xl ring-1 ring-white/10 outline-none md:h-auto md:max-h-[88dvh] md:w-[min(94vw,36rem)] md:rounded-[1.75rem] ${
                closing ? 'animate-sheet-out md:animate-pop-out' : 'animate-sheet-in md:animate-pop'
              }`
        }
      >
        {/* The bar at the top. On a phone it is also the handle the sheet is dragged by. */}
        <div {...drag.handlers} className={`shrink-0 ${docked ? '' : 'cursor-grab touch-none active:cursor-grabbing md:cursor-default'}`}>
          {!docked && (
            <div className="md:hidden">
              <Grabber />
            </div>
          )}
          <div data-scrolled={scrolled ? '' : undefined} className={`@container flex h-12 items-center gap-2 border-b pl-2 pr-3 transition-colors duration-[var(--duration-base)] ${scrolled ? 'border-white/10' : 'border-transparent'} ${docked ? '' : 'md:mt-1.5'}`}>
            {onBack && (
              <button type="button" data-no-drag aria-label={`Back to ${backLabel ?? 'the tabs'}`} className="pressable flex h-8 shrink-0 items-center rounded-full pl-1 pr-3 text-footnote font-semibold text-white/80 hover:bg-white/10 hover:text-white" onClick={onBack}>
                <ChevronLeft className="size-4" strokeWidth={2} />
                {backLabel ?? 'Back'}
              </button>
            )}
            <div aria-hidden className={`mini-title flex min-w-0 flex-1 items-center gap-2 ${onBack ? '' : 'pl-2'}`}>
              <AirlineLogo callsign={flight.callsign} icao24={flight.icao24} height={16} maxWidth={26} className="shrink-0" />
              <span className="display-tight truncate font-display text-[1.2rem] leading-none">{flight.callsign}</span>
              {flight.phase && <span className="hidden min-w-0 truncate text-caption font-medium text-white/60 @[24rem]:inline">{PHASE_LABEL[flight.phase]}</span>}
            </div>
            <div className="flex shrink-0 items-center gap-2" data-no-drag>
              <FollowButton tone="dark" compact={!!onBack} />
              <button type="button" aria-label="Close flight" className="pressable grid size-8 place-items-center rounded-full bg-white/10 text-white/85 hover:bg-white/20 hover:text-white" onClick={() => select(null)}>
                <X className="size-4" />
              </button>
            </div>
          </div>
        </div>

        <div ref={scroller} className="scroll-quiet scroll-fade @container min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[max(1.5rem,var(--safe-bottom))] pt-1 md:px-4">
          {/* The flight: who, what it is doing, where it is going, in the flight card's purple */}
          <FlightHero flight={flight} info={info} infoLoading={infoQuery.isLoading} titleRef={title} />
          <RouteCaveat info={info} />

          {/* Its live numbers */}
          <FlightSummary flight={flight} />

          {/* Its story so far, and a few facts about the route and aircraft */}
          <FlightInsights flight={flight} info={info} />

          {/* The aircraft: its type from the side, with what it is */}
          <AircraftPanel
            type={d?.type}
            category={d?.category}
            registration={info?.registration ?? d?.registration ?? null}
            dbName={info?.typeName}
            dbManufacturer={info?.manufacturer}
            callsign={flight.real ? flight.callsign : null}
            icao24={flight.icao24}
            onGround={!!d?.onGround}
          />

          {/* Its life so far: phases, times, and a speed and altitude chart */}
          <FlightTimeline flight={flight} info={info} />

          {/* The conversation so far: live radio calls naming this aircraft */}
          {liveCalls.length > 0 && (
            <section aria-label="Live radio calls" className="mt-5">
              <SectionLabel count={liveCalls.length}>
                <span className="flex items-center gap-2">
                  <CodeChip airport={flight.airportCode} />
                  Live radio
                </span>
              </SectionLabel>
              <ThreadStory calls={liveCalls} icao24={flight.icao24} />
              <ol className="flex flex-col gap-2.5 pt-1">
                {liveCalls.map((c) => (
                  <LiveCallBubble key={c.id} call={c} />
                ))}
              </ol>
              <p className="mt-4 text-center text-caption text-white/50">New calls about this flight appear here.</p>
            </section>
          )}

          {/* A replayed scene's calls, else the tower's log */}
          {flight.calls.length > 0 ? (
            <section aria-label="Radio calls" className="mt-5">
              <SectionLabel>
                <span className="flex items-center gap-2">
                  <CodeChip airport={flight.airportCode} />
                  {flight.stationLine.replace(`${flight.airportCode} `, '')}
                </span>
              </SectionLabel>
              <ol className="flex flex-col gap-2.5 pt-1">
                {flight.calls.map((c) => (
                  <CallBubble key={c.id} cue={c} />
                ))}
              </ol>
              <p className="mt-4 text-center text-caption text-white/50">New calls about this flight appear here.</p>
            </section>
          ) : liveCalls.length > 0 && flight.events.length === 0 ? null : (
            <section aria-label="Tower log" className="mt-5">
              <SectionLabel count={flight.events.length || null}>Tower log</SectionLabel>
              {flight.events.length > 0 ? (
                <ol className="ui-card divide-y divide-white/[0.06] px-3.5">
                  {flight.events.map((e) => (
                    <li key={e.id} className="flex items-start gap-3 py-2.5">
                      <EventBadge kind={e.kind} size={24} className="mt-px shrink-0" />
                      <span className="min-w-0 flex-1 text-subhead leading-snug">{e.text}</span>
                      <time className="shrink-0 pt-0.5 text-caption tabular-nums text-white/50">{new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
                    </li>
                  ))}
                </ol>
              ) : (
                <Hint>
                  {mode === 'live'
                    ? 'Nothing logged for this aircraft yet. Takeoffs, landings and go-arounds show up here as they happen, and with the radio playing, every call that names this flight.'
                    : 'No radio calls for this flight yet. Keep listening.'}
                </Hint>
              )}
            </section>
          )}

        </div>
      </div>
    </div>
  )
}
