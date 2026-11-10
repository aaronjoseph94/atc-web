/**
 * The selected aircraft, in two sizes.
 *
 * `FlightCard`: the purple card that replaces the station bar when a plane is
 * tapped. Identity, route, speed and altitude, a quiet line with the airline,
 * aircraft type and registration (and how far it has to go), and one plain
 * sentence on what it is doing. Drag it up (or tap the sentence) for the full
 * view; drag it down to let the aircraft go.
 *
 * `FlightDetail`: the full-height view: the flight (number, route progress,
 * arrival time, live numbers), the aircraft (a side view and its facts), the
 * timeline, and the conversation so far (radio calls in a
 * replayed scene, logged events for live traffic).
 */
import { ArrowDown, ArrowUp, Check, ChevronRight, Crosshair, ExternalLink, Pause, Plane, Play, Radio, Sparkles, X } from 'lucide-react'
import { AirlineLogo } from '../airline/AirlineLogo'
import { useMemo, type CSSProperties } from 'react'
import type { FlightInfo, RouteAirport, TranscriptCue } from '../api/types'
import { airlineInfo, parseCallsign } from '../airline/airlines'
import { aircraftProfile } from '../aircraft/types'
import { callsFor, useRadio, type Transmission } from '../live/radio/radioStore'
import { FrequencyTuner } from '../station/FrequencyTuner'
import { Waveform } from '../station/Waveform'
import { usePlayhead } from '../playback/playheadStore'
import { formatAltitude, formatSpeed, useSettings } from '../settings/settingsStore'
import { CARD_BOTTOM, CARD_TOP, registerCardColors, useAirlineTint } from '../ui/airlineTint'
import { Grabber, useDialog } from '../ui/Panel'
import { Ticker } from '../ui/Ticker'
import { usePresence } from '../ui/usePresence'
import { useSheetDrag } from '../ui/useSheetDrag'
import { AircraftPanel } from '../aircraft/AircraftPanel'
import { aircraftTypeName, PHASE_LABEL } from './describe'
import { FlightSummary } from './FlightSummary'
import { FlightTimeline } from './FlightTimeline'
import { formatDistance, routeProgress } from './route'
import { Sparkline } from './Sparkline'
import { useFlight, useFlightInfo, type FlightView } from './useFlight'

const code = (a: RouteAirport | null | undefined) => a?.iata ?? a?.icao ?? null

registerCardColors()

/**
 * The card's gradient, leaning toward the airline's colour. The two stops are
 * registered colour properties, so switching flights cross-fades the tint.
 * Merged with the drag style, whose transform transition must survive.
 */
function cardStyle(tint: { top: string; bottom: string } | null, base: CSSProperties): CSSProperties {
  const fade = '--card-top 700ms var(--ease-in-out), --card-bottom 700ms var(--ease-in-out)'
  const drag = base.transition && base.transition !== 'none' ? `${base.transition}, ` : ''
  return {
    ...base,
    ['--card-top' as string]: tint?.top ?? CARD_TOP,
    ['--card-bottom' as string]: tint?.bottom ?? CARD_BOTTOM,
    backgroundImage: 'linear-gradient(to bottom, var(--card-top), var(--card-bottom))',
    transition: drag + fade,
  }
}

/** Lock / unlock the camera on the aircraft. Reads "Following" while locked, "Re-center" once the map has been moved. */
function FollowButton({ tone }: { tone: 'card' | 'dark' }) {
  const following = usePlayhead((s) => s.following)
  const setFollowing = usePlayhead((s) => s.setFollowing)
  const base = 'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition active:scale-95'
  // In the full view the callsign is set much bigger; on a phone the words would squeeze it to "AVA0…",
  // so there the button keeps only its icon (the word stays as its accessible name).
  const word = tone === 'dark' ? 'max-sm:sr-only' : ''
  return following ? (
    <button type="button" data-no-drag aria-pressed title="Following" className={`${base} ${tone === 'card' ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-white/10 text-white hover:bg-white/20'}`} onClick={() => setFollowing(false)}>
      <Check className="size-3.5" strokeWidth={3} /> <span className={word}>Following</span>
    </button>
  ) : (
    <button type="button" data-no-drag title="Re-center" className={`${base} bg-white text-atc-card hover:bg-white/90`} onClick={() => setFollowing(true)}>
      <Crosshair className="size-3.5" strokeWidth={2.5} /> <span className={word}>Re-center</span>
    </button>
  )
}

function Identity({ flight, info, big = false }: { flight: FlightView; info: FlightInfo | undefined; big?: boolean }) {
  const type = flight.detail?.type
  return (
    <div className={`flex min-w-0 items-center ${big ? 'gap-3' : 'gap-2.5'}`}>
      {/* The airline's mark, about as tall as the callsign's capitals, as in the reference. */}
      <AirlineLogo callsign={flight.callsign} icao24={flight.icao24} height={big ? 24 : 21} maxWidth={big ? 40 : 36} className="shrink-0" />
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 className={`display-tight truncate font-display leading-none ${big ? 'text-[2.6rem]' : 'text-[1.9rem]'}`}>{flight.callsign}</h2>
        {type && (
          <span className="shrink-0 text-sm font-medium text-white/70" title={info?.typeName ?? aircraftTypeName(type) ?? undefined}>
            {type}
          </span>
        )}
      </div>
    </div>
  )
}

export function FlightCard() {
  const sheet = usePlayhead((s) => s.sheet)
  const select = usePlayhead((s) => s.select)
  const setSheet = usePlayhead((s) => s.setSheet)
  const live = usePlayhead((s) => s.mode === 'live')
  const playing = usePlayhead((s) => s.playing)
  const hasAudio = usePlayhead((s) => !!s.clip?.audioUrl)
  const radioLive = useRadio((s) => s.on && (s.status === 'live' || s.status === 'buffering'))
  const altitudeUnit = useSettings((s) => s.altitudeUnit)
  const speedUnit = useSettings((s) => s.speedUnit)
  const flight = useFlight()
  const info = useFlightInfo(flight).data
  const { mounted, closing } = usePresence(sheet === 'card' && !!flight, 220)
  const drag = useSheetDrag({ onDown: () => select(null), onUp: () => setSheet('full') })
  const tint = useAirlineTint(flight?.callsign, flight?.icao24)

  if (!mounted || !flight) return null
  const d = flight.detail
  const from = code(info?.origin)
  const to = code(info?.destination)
  // One quiet line: who flies it, on what, which airframe; and how far it has to go.
  const airline = info?.airline ?? airlineInfo(parseCallsign(flight.callsign)?.prefix)?.name ?? null
  const typeName = d?.type || info?.typeName ? aircraftProfile({ type: d?.type, category: d?.category, dbName: info?.typeName, dbManufacturer: info?.manufacturer }).title : null
  const registration = info?.registration ?? d?.registration ?? null
  const about = [airline, typeName, registration && registration !== flight.callsign ? registration : null].filter(Boolean).join(' · ')
  const left = d && !d.onGround && to ? routeProgress(info?.origin, info?.destination, d) : null

  return (
    <section
      aria-label={`Flight ${flight.callsign}`}
      {...drag.handlers}
      style={cardStyle(tint, drag.dragging || drag.style.transform ? drag.style : { touchAction: 'none' })}
      data-tint={tint?.brand}
      className={`pointer-events-auto w-full cursor-grab overflow-hidden rounded-t-[1.75rem] bg-atc-card text-white shadow-[0_-12px_40px_rgba(0,0,0,0.5)] active:cursor-grabbing md:w-[min(92vw,40rem)] md:rounded-[1.75rem] ${
        closing ? 'animate-sheet-out' : 'animate-sheet-in'
      }`}
    >
      <Grabber />
      <div className="flex items-center justify-between gap-3 px-4 pt-2">
        <Identity flight={flight} info={info} />
        <div className="flex shrink-0 items-center gap-2">
          <FollowButton tone="card" />
          <button type="button" data-no-drag aria-label="Close flight" className="grid size-8 place-items-center rounded-full bg-white/15 transition hover:bg-white/25 active:scale-90" onClick={() => select(null)}>
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-4 px-4 text-[15px] font-medium">
        <span className="flex min-w-0 items-center gap-1.5">
          {from || to ? (
            <>
              <span>{from ?? '—'}</span>
              <Plane className="size-3.5 rotate-45 text-white/70" aria-label="to" />
              <span>{to ?? '—'}</span>
            </>
          ) : (
            <span className="truncate text-white/75">{flight.phase ? PHASE_LABEL[flight.phase] : 'Locating…'}</span>
          )}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 tabular-nums">
          <Sparkline values={flight.series.speedKt} className="h-4 w-10 text-white/70" />
          <Ticker value={d?.speedKt} format={(v) => formatSpeed(v, speedUnit)} />
        </span>
        <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
          <Sparkline values={flight.series.altitudeFt} className="h-4 w-10 text-white/70" />
          {d?.onGround ? 'GND' :           <Ticker value={d?.altitudeFt} format={(v) => formatAltitude(v, altitudeUnit)} />}
        </span>
      </div>
      {(about || left) && (
        <div className="mt-0.5 flex items-baseline gap-3 px-4 text-caption text-white/60">
          <span className="min-w-0 flex-1 truncate">{about}</span>
          {left && (
            <span className="shrink-0 tabular-nums text-white/70">
              {formatDistance(left.remainingNm, speedUnit)} to {to}
            </span>
          )}
        </div>
      )}

      <button
        type="button"
        data-no-drag
        className="mx-4 mt-2.5 flex w-[calc(100%-2rem)] items-center gap-3 rounded-2xl bg-white/12 px-3.5 py-2.5 text-left ring-1 ring-white/10 transition hover:bg-white/18 active:scale-[0.99]"
        onClick={() => setSheet('full')}
        aria-label="Open full flight details"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 text-[11px] font-semibold text-white/60">
            {flight.nowSource === 'radio-ai' ? <Sparkles className="size-3" /> : flight.nowSource === 'radio' ? <Radio className="size-3" /> : null}
            Now
          </span>
          {flight.now ? (
            <span className="mt-0.5 line-clamp-2 block text-[15px] font-medium leading-snug">{flight.now}</span>
          ) : (
            <span className="mt-1.5 block space-y-1.5" aria-label="Loading">
              <span className="skeleton block h-3.5 w-11/12" />
              <span className="skeleton block h-3.5 w-7/12" />
            </span>
          )}
        </span>
        <ChevronRight className="size-5 shrink-0 text-white/50" />
      </button>

      {/* Live, the foot of the card is a dial for changing channel; a replayed scene stays on its own channel. */}
      {live ? (
        <FrequencyTuner />
      ) : (
        <p className="px-4 pb-2 pt-2.5 text-center text-[13px] font-medium text-white/75">{flight.stationLine}</p>
      )}
      {/* The channel's audio, as on the station bar. */}
      <div className="pb-[var(--safe-bottom)] md:pb-1">
        <Waveform active={live ? radioLive : playing && hasAudio} source={live ? 'live' : 'replay'} color="rgba(255,255,255,0.5)" />
      </div>
    </section>
  )
}

/**
 * One radio call in the conversation: grey for the controller, blue for the
 * pilot. Tap to hear it again; the call on the air wears a pause button
 * whose ring fills as it is spoken.
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
        className={`block w-full rounded-[1.35rem] px-4 py-3 text-left text-[15px] leading-snug transition active:scale-[0.98] ${
          pilot ? 'bg-atc-blue text-white hover:brightness-110' : 'bg-white/[0.11] text-white/90 hover:bg-white/[0.15]'
        }`}
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

/**
 * One live radio call in the conversation, styled like the replayed ones:
 * grey on the left for the controller, blue on the right for the pilot.
 */
function LiveCallBubble({ call }: { call: Transmission }) {
  const pilot = call.speaker === 'pilot'
  const time = new Date(call.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
  return (
    <li className={`max-w-[86%] animate-rise ${pilot ? 'self-end' : 'self-start'}`} aria-label={`${pilot ? 'Pilot' : call.speaker === 'controller' ? 'Controller' : 'Radio'} at ${time}: ${call.text}`}>
      <p
        className={`rounded-[1.35rem] px-4 py-3 text-[15px] leading-snug ${pilot ? 'bg-atc-blue text-white' : 'bg-white/[0.11] text-white/90'}`}
      >
        {call.text}
      </p>
      <p className={`mt-1 px-2 text-[11px] tabular-nums text-white/40 ${pilot ? 'text-right' : ''}`}>
        {pilot ? 'Pilot' : call.speaker === 'controller' ? 'Controller' : 'Radio'} · {time}
      </p>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Full view
// ---------------------------------------------------------------------------

/** `docked`: rendered in the desktop side panel (no backdrop, no drag, no focus trap) instead of as a sheet. */
export function FlightDetail({ docked = false }: { docked?: boolean }) {
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
        <div {...drag.handlers} className="shrink-0 cursor-grab touch-none border-b border-white/10 active:cursor-grabbing md:cursor-default">
          <div className="md:hidden">
            <Grabber />
          </div>
          <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-3">
            <div className="min-w-0">
              <Identity flight={flight} info={info} big={!docked} />
            </div>
            <div className="flex shrink-0 items-center gap-2 pt-1" data-no-drag>
              <FollowButton tone="dark" />
              <button type="button" aria-label="Close flight" className="grid size-9 place-items-center rounded-full bg-white/10 transition hover:bg-white/20 active:scale-90" onClick={() => select(null)}>
                <X className="size-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="scroll-quiet scroll-fade @container min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.5rem,var(--safe-bottom))] pt-4">
          {/* The flight: number, route and progress, its live numbers */}
          <FlightSummary flight={flight} info={info} infoLoading={infoQuery.isLoading} />

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
            <section className="mt-6" aria-label="Live radio calls">
              <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-white/60">
                <span className="rounded bg-atc-yellow px-1.5 py-0.5 font-display text-xs tracking-wide text-black">{flight.airportCode}</span>
                Live radio
              </h3>
              <ol className="flex flex-col gap-2.5">
                {liveCalls.map((c) => (
                  <LiveCallBubble key={c.id} call={c} />
                ))}
              </ol>
              <p className="mt-4 text-center text-xs text-white/40">New transmissions will appear here</p>
            </section>
          )}

          {/* The conversation so far */}
          {flight.calls.length > 0 ? (
            <section className="mt-6" aria-label="Radio calls">
              <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-white/60">
                <span className="rounded bg-atc-yellow px-1.5 py-0.5 font-display text-xs tracking-wide text-black">{flight.airportCode}</span>
                {flight.stationLine.replace(`${flight.airportCode} `, '')}
              </h3>
              <ol className="flex flex-col gap-2.5">
                {flight.calls.map((c) => (
                  <CallBubble key={c.id} cue={c} />
                ))}
              </ol>
              <p className="mt-4 text-center text-xs text-white/40">New transmissions will appear here</p>
            </section>
          ) : liveCalls.length > 0 && flight.events.length === 0 ? null : (
            <section className="mt-6" aria-label="Tower log">
              <h3 className="mb-2 text-[13px] font-semibold text-white/60">Tower log</h3>
              {flight.events.length > 0 ? (
                <ol className="flex flex-col gap-2">
                  {flight.events.map((e) => (
                    <li key={e.id} className="flex items-start gap-3 rounded-2xl bg-white/[0.06] px-3.5 py-2.5">
                      {e.kind === 'landed' ? <ArrowDown className="mt-0.5 size-4 shrink-0 text-atc-yellow" /> : <ArrowUp className="mt-0.5 size-4 shrink-0 text-atc-yellow" />}
                      <span className="min-w-0 flex-1 text-[15px] leading-snug">{e.text}</span>
                      <time className="shrink-0 text-xs tabular-nums text-white/45">{new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="rounded-2xl bg-white/[0.06] px-3.5 py-3 text-sm leading-relaxed text-white/65">
                  {mode === 'live'
                    ? 'Nothing logged for this aircraft yet. Takeoffs, landings and go-arounds show up here as they happen, and with the radio playing, every call that names this flight.'
                    : 'No radio calls for this flight yet. Keep listening.'}
                </p>
              )}
            </section>
          )}

          {flight.real && (
            <a
              href={`https://www.flightaware.com/live/flight/${encodeURIComponent(flight.callsign)}`}
              target="_blank"
              rel="noreferrer"
              className="mt-5 flex items-center justify-between gap-3 rounded-2xl bg-white/[0.06] px-4 py-3 text-sm font-medium transition hover:bg-white/10"
            >
              Look up {flight.callsign} on FlightAware
              <ExternalLink className="size-4 shrink-0 text-white/60" />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
