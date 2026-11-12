/**
 * "Now": the side panel's first tab, the airport at a glance. Top to bottom,
 * in the order someone glancing over would ask:
 *
 *   who is talking        the call on the air (or the last one), in the speaker's colour
 *   what is going on      the AI briefing, when there is one
 *   which runways         landing and departing ends, with the wind on them
 *   how busy              arriving, departing, taxiing, parked
 *   anything unusual      alerts raised this session
 *   what just happened    recent takeoffs and landings, notable aircraft
 *
 * Only what the station bar under the map doesn't already say: no airport,
 * channel, flight category or wind summary here. Sections with nothing in
 * them yet stay out of the way rather than explain themselves.
 *
 * Each block opens the tab that has the detail. Nothing here fetches on its
 * own: it reads the same stores and cached queries the other tabs fill.
 */
import { ArrowLeftRight, CircleParking, PlaneLanding, PlaneTakeoff } from 'lucide-react'
import { memo, useMemo, type ReactNode } from 'react'
import { AirlineLogo } from '../../airline/AirlineLogo'
import type { TranscriptCue } from '../../api/types'
import { SpottedList } from '../../discovery/SpottedList'
import { useNow } from '../../hooks/useNow'
import { AiMark } from '../../insights/AiMark'
import { ALERT_STYLE } from '../../insights/alertStyle'
import type { Alert } from '../../insights/alerts'
import { useBriefingText } from '../../insights/hooks'
import { useInsights } from '../../insights/insightsStore'
import { useAirfield } from '../../live/airfield'
import { useRadio, type Transmission } from '../../live/radio/radioStore'
import { CallText } from '../../live/radio/understand/CallExtras'
import { useUnderstood } from '../../live/radio/understand/store'
import { toggleRadio } from '../../live/radio/useLiveRadio'
import { liveBuffer } from '../../live/session'
import { runwayEnds } from '../../map/airportDiagram'
import { trackId } from '../../playback/interpolate'
import { usePlayhead } from '../../playback/playheadStore'
import { useSettings, type SpeedUnit } from '../../settings/settingsStore'
import { useWeather } from '../../station/StationBar'
import { Lamp } from '../../ui/kit'
import type { DockTab } from '../../ui/layout'
import { PanelFrame, SectionLabel } from '../../ui/Panel'
import { speakerColors, type RadioSpeaker } from '../../ui/speaker'
import { EmptyState, OfflineArt } from '../../ui/States'
import { ShimmerText, SwapText } from '../../ui/textMotion'
import { Ticker } from '../../ui/Ticker'
import { runwayWinds, type RunwayWind } from '../../weather/atis'
import { speedUnitLabel, speedValue } from '../../weather/decode'
import { RunwayChip } from '../../weather/WindCard'
import { ActivityList } from '../ActivityList'
import { PANEL_ICON } from './icons'
import { agoShort } from './overview'
import { useLampState, useOnAir, useTrafficCounts } from './panelStore'

type Go = (tab: DockTab) => void

const roleWord = (s: RadioSpeaker) => (s === 'pilot' ? 'Pilot' : s === 'controller' ? 'Controller' : 'Radio')

/** The newest finished call on a channel. */
function lastCall(list: Transmission[] | undefined): Transmission | null {
  if (!list) return null
  for (let i = list.length - 1; i >= 0; i--) if (list[i].status === 'done' && list[i].text) return list[i]
  return null
}

/** One spoken line with its speaker's colour down the left edge: the shape every call takes in this tab. */
function CallLine({ speaker, who, icao24, meta, children }: { speaker: RadioSpeaker; who: string | null; icao24: string | null; meta: ReactNode; children: ReactNode }) {
  const c = speakerColors(speaker)
  return (
    <div className="flex gap-2.5">
      <span aria-hidden className="w-[3px] shrink-0 rounded-full transition-colors duration-500" style={{ background: speaker ? c.base : 'rgb(255 255 255 / 0.22)' }} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-caption font-medium text-white/50">
          {who && (
            <span className="flex items-center gap-1.5 font-semibold" style={{ color: speaker ? c.light : 'rgb(255 255 255 / 0.75)' }}>
              <AirlineLogo callsign={who} icao24={icao24} height={13} maxWidth={22} />
              {who}
            </span>
          )}
          {meta}
        </div>
        <p className="mt-0.5 text-body font-semibold leading-snug text-white/95">{children}</p>
      </div>
    </div>
  )
}

function LiveCall({ call, now }: { call: Transmission; now: number }) {
  const understood = useUnderstood(call.id)
  const speaker = understood?.speaker ?? call.speaker
  return (
    <CallLine speaker={speaker} who={call.callsigns[0]?.callsign ?? null} icao24={call.icao24} meta={<><span>{roleWord(speaker)}</span><span className="tabular-nums">{agoShort(call.at + call.durationMs, now)}</span></>}>
      <CallText call={call} />
    </CallLine>
  )
}

/** The cue being spoken in a replay, or the last one that was. */
function useReplayCue(): TranscriptCue | null {
  return usePlayhead((s) => {
    if (s.mode !== 'playback' || !s.clip) return null
    let last: TranscriptCue | null = null
    for (const c of s.clip.cues) {
      if (c.startMs > s.tMs) break
      if (c.speaker !== 'Tower log') last = c
    }
    return last
  })
}

/** Who is talking: the panel's live centre. */
function OnAirCard({ go }: { go: Go }) {
  const playback = usePlayhead((s) => s.mode === 'playback')
  const stationId = usePlayhead((s) => s.stationId)
  const setPanel = usePlayhead((s) => s.setPanel)
  const lamp = useLampState()
  const air = useOnAir()
  const status = useRadio((s) => s.status)
  const pending = useRadio((s) => s.pending)
  const transcripts = useRadio((s) => s.transcripts)
  const call = useRadio((s) => (s.caption && s.caption.stationId === stationId ? s.caption : lastCall(s.log[stationId])))
  const cue = useReplayCue()
  const clip = usePlayhead((s) => (s.mode === 'playback' ? s.clip : null))
  const now = useNow(20_000)
  const off = lamp.state === 'off'

  // A wash of the speaker's colour while they have the microphone; it drains away when they let go.
  const wash = air.speaking ? `color-mix(in srgb, ${air.colors.base} 13%, rgb(255 255 255 / 0.05))` : undefined
  // The channel's name is on the station bar; here the lamp and what it means are enough (a replay names its scene).
  const head = (
    <div className="flex items-center gap-2">
      <Lamp state={lamp.state} color={lamp.color} />
      {/* A new state swaps its words; a countdown within one ("Retrying in 5s") just ticks. */}
      <SwapText swapKey={lamp.label.replace(/\d+/g, '#')} className="text-footnote font-semibold text-white/85">
        {lamp.label}
      </SwapText>
      {playback && clip && <span className="ml-auto min-w-0 truncate text-caption text-white/50">{clip.title}</span>}
    </div>
  )

  // Radio off: one quiet line with the one thing to do about it.
  if (!playback && off) {
    const nofeed = status === 'nofeed'
    return (
      <section aria-label="On the air" className="ui-card flex items-center gap-3 py-2.5 pl-3.5 pr-2.5">
        <Lamp state={lamp.state} color={lamp.color} />
        <span className="min-w-0 flex-1">
          <span className="block text-footnote font-semibold text-white/85">{nofeed ? 'No live audio' : 'Radio off'}</span>
          <span className="block truncate text-caption text-white/55">{nofeed ? 'Nobody streams this channel' : 'Calls are written out here as they’re spoken'}</span>
        </span>
        {nofeed ? (
          <button type="button" className="pressable flex h-8 shrink-0 items-center rounded-full bg-white/10 px-3.5 text-footnote font-semibold text-white hover:bg-white/[0.16]" onClick={() => setPanel('stations')}>
            Change channel
          </button>
        ) : (
          <button type="button" className="pressable on-yellow flex h-8 shrink-0 items-center rounded-full bg-atc-yellow px-3.5 text-footnote font-semibold text-black hover:bg-atc-yellow-deep" onClick={() => toggleRadio()}>
            Listen
          </button>
        )}
      </section>
    )
  }

  const waiting = !playback && (air.speaking || (pending > 0 && transcripts !== 'unavailable'))
  return (
    <section aria-label="On the air" className="ui-card overflow-hidden transition-[background-color] duration-700 ease-[var(--ease-out)]" style={{ backgroundColor: wash }}>
      <button type="button" className="pressable-soft block w-full p-3.5 text-left" aria-label="On the air: the latest call. Show every call" onClick={() => go('transcripts')}>
        {head}
        <div className="mt-2.5">
          {playback ? (
            cue ? (
              <CallLine
                key={cue.id}
                speaker={/pilot/i.test(cue.speaker ?? '') ? 'pilot' : 'controller'}
                who={cue.callsign ? (clip?.aircraft?.[cue.callsign]?.callsign ?? cue.callsign).toUpperCase() : null}
                icao24={cue.callsign ? trackId(cue.callsign) : null}
                meta={<span>{/pilot/i.test(cue.speaker ?? '') ? 'Pilot' : 'Controller'}</span>}
              >
                {cue.text}
              </CallLine>
            ) : (
              <p className="text-subhead text-white/60">Nobody has spoken yet in this replay.</p>
            )
          ) : call ? (
            <div key={call.id} className="animate-caption">
              <LiveCall call={call} now={now} />
            </div>
          ) : (
            <p className="text-subhead leading-snug text-white/60">{transcripts === 'unavailable' ? 'The audio is playing. Written calls only work on the published site.' : 'Listening. The next call on this channel shows up here.'}</p>
          )}
        </div>
        {waiting && (
          <p className="mt-2 pl-[13px] text-caption font-semibold text-white/55" role="status">
            <SwapText swapKey={air.speaking ? 'air' : 'processing'}>
              {air.speaking ? (
                <span className="flex items-center gap-1.5">
                  <span className="size-1.5 animate-pulse-dot rounded-full bg-white/70" />
                  <span className="size-1.5 animate-pulse-dot rounded-full bg-white/70 [animation-delay:0.2s]" />
                  <span className="size-1.5 animate-pulse-dot rounded-full bg-white/70 [animation-delay:0.4s]" />
                  <span className="ml-1">Someone is talking</span>
                </span>
              ) : (
                <ShimmerText>Processing call…</ShimmerText>
              )}
            </SwapText>
          </p>
        )}
      </button>
    </section>
  )
}

/**
 * The AI briefing: what is going on here, in a sentence or two. Only the
 * AI-written one: the plain fallback just read out the runway and traffic
 * cards below it.
 */
function Briefing() {
  const brief = useBriefingText()
  if (!brief?.ai) return null
  return (
    <section aria-label="Airport briefing" className="rounded-2xl bg-atc-card/[0.16] px-3.5 py-3 ring-1 ring-inset ring-atc-card/40">
      <div className="flex items-center gap-1 text-caption font-semibold text-white/65">
        Right now
        <AiMark />
      </div>
      <p className="mt-1 animate-fade text-subhead leading-snug text-white/90">{brief.text}</p>
    </section>
  )
}

function WindOn({ wind, unit }: { wind: RunwayWind | null; unit: SpeedUnit }) {
  if (!wind) return null
  const u = speedUnitLabel(unit)
  const tail = wind.headwindKt < 0
  return (
    <span className="shrink-0 text-right text-caption tabular-nums text-white/55">
      <span className={tail ? 'font-semibold text-[#FFC266]' : 'font-semibold text-white/85'}>
        {speedValue(Math.abs(wind.headwindKt), unit)} {u}
      </span>{' '}
      {tail ? 'tail' : 'head'}
      {wind.crosswindKt > 0 && (
        <>
          <span className="mx-1 text-white/25">/</span>
          <span className={wind.crosswindKt >= 15 ? 'font-semibold text-[#FFC266]' : 'font-semibold text-white/85'}>{speedValue(wind.crosswindKt, unit)}</span> cross
        </>
      )}
    </span>
  )
}

/** Which runways are in use and what the wind is doing on them. */
function FieldCard({ go }: { go: Go }) {
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const active = useAirfield((s) => s.runways)
  const unit = useSettings((s) => s.speedUnit)
  const metar = useWeather(airportIcao).data?.metar ?? null
  const ends = useMemo(() => runwayEnds(airportIcao), [airportIcao])
  const winds = useMemo(() => runwayWinds(metar, ends), [metar, ends])
  const byIdent = new Map(winds.map((w) => [w.ident, w]))
  const inUse = active && (active.landing.length > 0 || active.departing.length > 0)
  const idents = inUse ? [...new Set([...active.landing, ...active.departing])] : (active?.favoured.length ? active.favoured : winds.slice(0, 2).map((w) => w.ident)).slice(0, 2)
  if (!idents.length) return null
  const basis = !inUse ? 'Best into the wind' : active.basis === 'atis' ? 'Per the ATIS' : 'From the traffic'

  return (
    <section aria-label="Runways and wind" className="mt-5">
      <SectionLabel aside={basis}>{inUse ? 'Runways in use' : 'Favoured runways'}</SectionLabel>
      <button type="button" className="ui-card pressable-soft block w-full px-3.5 text-left hover:bg-white/[0.08]" aria-label="Runways and wind. Open the weather" onClick={() => go('weather')}>
        {idents.map((ident) => {
          const landing = !!inUse && active.landing.includes(ident)
          const departing = !!inUse && active.departing.includes(ident)
          return (
            <span key={ident} className="flex min-h-11 items-center gap-3 border-b border-white/[0.06] py-1.5 last:border-0">
              <RunwayChip ident={ident} landing={landing} departing={departing} />
              <span className="min-w-0 flex-1 truncate text-footnote text-white/70">{landing && departing ? 'Landing and departing' : landing ? 'Landing' : departing ? 'Departing' : 'Into the wind'}</span>
              <WindOn wind={byIdent.get(ident) ?? null} unit={unit} />
            </span>
          )
        })}
      </button>
    </section>
  )
}

const whole = (v: number | null | undefined) => String(Math.round(v ?? 0))

/** How busy it is: four counters that roll as traffic comes and goes. */
function TrafficTiles({ go }: { go: Go }) {
  const c = useTrafficCounts()
  const status = usePlayhead((s) => s.liveStatus)
  const cells: [string, number, ReactNode][] = [
    ['Arriving', c.arriving, <PlaneLanding key="i" {...PANEL_ICON} />],
    ['Departing', c.departing, <PlaneTakeoff key="i" {...PANEL_ICON} />],
    ['Taxiing', c.taxiing, <ArrowLeftRight key="i" {...PANEL_ICON} />],
    ['Parked', c.parked, <CircleParking key="i" {...PANEL_ICON} />],
  ]
  return (
    <section aria-label="Traffic" className="mt-5">
      <SectionLabel>Traffic</SectionLabel>
      <button type="button" className="ui-card pressable-soft grid w-full grid-cols-4 divide-x divide-white/[0.06] py-2.5 text-left hover:bg-white/[0.08]" aria-label={`Traffic: ${c.arriving} arriving, ${c.departing} departing, ${c.taxiing} taxiing, ${c.parked} parked. Open the list`} onClick={() => go('traffic')}>
        {cells.map(([label, n, icon]) => (
          <span key={label} className="min-w-0 px-3" aria-hidden>
            <span className="flex items-center justify-between gap-1">
              <span className="font-display text-[1.6rem] leading-none tracking-normal text-white">{status === 'ok' ? <Ticker variant="digits" value={n} format={whole} /> : <span className="text-white/30">–</span>}</span>
              <span className="shrink-0 text-white/40">{icon}</span>
            </span>
            <span className="mt-1.5 block truncate text-caption2 font-medium text-white/55">{label}</span>
          </span>
        ))}
      </button>
    </section>
  )
}

const AlertRow = memo(function AlertRow({ alert, why, now }: { alert: Alert; why: string | undefined; now: number }) {
  const s = ALERT_STYLE[alert.kind]
  const Icon = s.icon
  const here = !!alert.icao24 && !!liveBuffer.get(alert.icao24)
  const urgent = alert.kind === 'emergency'
  return (
    <li>
      <button type="button" aria-disabled={!here || undefined} className="ui-row pressable-soft flex w-full items-start gap-3 aria-disabled:cursor-default" onClick={() => here && usePlayhead.getState().select(alert.icao24)}>
        <span className="mt-0.5 grid size-[26px] shrink-0 place-items-center rounded-full" style={{ color: urgent ? '#fff' : s.color, background: urgent ? s.color : `color-mix(in srgb, ${s.color} 22%, transparent)` }} aria-hidden>
          <Icon {...PANEL_ICON} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 truncate text-subhead font-semibold text-white/95">{alert.title}</span>
            <span className="ml-auto shrink-0 text-caption tabular-nums text-white/50">{agoShort(alert.at, now)}</span>
          </span>
          <span className="mt-0.5 block text-footnote leading-snug text-white/65">{alert.body}</span>
          {why && (
            <span className="mt-1 flex items-start gap-1 text-footnote leading-snug text-[#DCD3FF]">
              <AiMark className="mt-[3px]" />
              <span className="min-w-0">{why}</span>
            </span>
          )}
        </span>
      </button>
    </li>
  )
})

/** Anything unusual this session: go-arounds, rejected takeoffs, runway changes, emergencies. */
function Alerts() {
  const alerts = useInsights((s) => s.alerts)
  const why = useInsights((s) => s.why)
  const now = useNow(20_000)
  if (!alerts.length) return null
  return (
    <section aria-label="Alerts" className="mt-5">
      <SectionLabel count={alerts.length}>Alerts</SectionLabel>
      <ul className="flex flex-col">
        {alerts.slice(0, 3).map((a) => (
          <AlertRow key={a.id} alert={a} why={why[a.id]} now={now} />
        ))}
      </ul>
    </section>
  )
}

const noop = () => {}

export function NowTab({ go }: { go: Go }) {
  const live = usePlayhead((s) => s.mode === 'live')
  const offline = usePlayhead((s) => s.mode === 'live' && s.liveStatus === 'error' && s.liveCount === 0)
  const airportIcao = usePlayhead((s) => s.airportIcao)
  return (
    <PanelFrame docked open title={`Now at ${airportIcao}`} onClose={noop}>
      <div className="flex flex-col gap-2.5">
        <OnAirCard go={go} />
        {live && <Briefing />}
      </div>
      <FieldCard go={go} />
      {live &&
        (offline ? (
          <EmptyState compact art={<OfflineArt />} title="Live traffic is offline">
            The tracking feeds aren’t answering. It keeps retrying by itself.
          </EmptyState>
        ) : (
          <>
            <TrafficTiles go={go} />
            <Alerts />
            <ActivityList onPick={noop} hideEmpty />
            <SpottedList onPick={noop} hideEmpty />
          </>
        ))}
      {!live && <p className="mt-6 px-1 text-footnote text-white/55">This is a replay. Runways and wind are as they are now; traffic counts and recent activity come back with the live view.</p>}
    </PanelFrame>
  )
}
