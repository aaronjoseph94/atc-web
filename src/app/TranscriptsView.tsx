/**
 * The full conversation, big and readable. In a replay: every radio call,
 * tap one to jump there. Live: the calls heard on this channel's live audio
 * (tap one to find the aircraft it named), and the tower log of detected
 * takeoffs, landings and go-arounds.
 */
import { ArrowDown, ArrowUp, ArrowUpFromLine, RotateCcw, Siren } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AirlineLogo } from '../airline/AirlineLogo'
import { getAirport, resolveStation } from '../api/airports'
import { formatMhz } from '../api/airportData'
import type { LiveEvent } from '../live/events'
import { useRadio, type Transmission } from '../live/radio/radioStore'
import { trackId } from '../playback/interpolate'
import { formatClock } from '../playback/Timeline'
import { usePlayhead } from '../playback/playheadStore'
import { PanelFrame } from '../ui/Panel'

const EVENT_ICON: Record<LiveEvent['kind'], typeof ArrowUp> = { departed: ArrowUp, landed: ArrowDown, goaround: RotateCcw, lineup: ArrowUpFromLine, emergency: Siren }

const NO_CALLS: Transmission[] = []

/** Who a live call was from or to, for its label: `DAL288 · Controller`. */
function callLabel(t: Transmission): string {
  const who = t.callsigns.find((c) => c.icao24)?.callsign ?? t.callsigns[0]?.callsign
  const role = t.speaker === 'pilot' ? 'Pilot' : t.speaker === 'controller' ? 'Controller' : null
  return [who, role].filter(Boolean).join(' · ')
}

/** `docked`: rendered in the desktop side panel instead of as a sheet. */
export function TranscriptsView({ docked = false }: { docked?: boolean }) {
  const open = usePlayhead((s) => s.panel === 'transcripts') || docked
  const clip = usePlayhead((s) => s.clip)
  // The clock only matters while the transcript is showing; closed, it shouldn't re-render on every tick.
  const tMs = usePlayhead((s) => (docked || s.panel === 'transcripts' ? s.tMs : 0))
  const mode = usePlayhead((s) => s.mode)
  const events = usePlayhead((s) => s.events)
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const stationId = usePlayhead((s) => s.stationId)
  const setPanel = usePlayhead((s) => s.setPanel)
  const setTMs = usePlayhead((s) => s.setTMs)
  const setPlaying = usePlayhead((s) => s.setPlaying)
  const select = usePlayhead((s) => s.select)
  const activeRef = useRef<HTMLLIElement>(null)
  const radioCalls = useRadio((s) => s.log[stationId] ?? NO_CALLS)
  const radioOn = useRadio((s) => s.on && s.status !== 'off' && s.status !== 'nofeed')
  const transcripts = useRadio((s) => s.transcripts)
  const [tab, setTab] = useState<'radio' | 'log' | null>(null)
  const listEnd = useRef<HTMLDivElement>(null)

  const playback = mode === 'playback' && !!clip
  const cues = playback ? clip.cues : []
  const activeId = cues.find((c) => tMs >= c.startMs && tMs < c.endMs)?.id

  // Keep the line being spoken in view.
  useEffect(() => {
    if (open) activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [open, activeId])

  // Live: the radio tab when there is radio to show, else the tower log.
  const hasRadio = radioOn || radioCalls.length > 0
  const view = playback ? 'replay' : (tab ?? (hasRadio ? 'radio' : 'log')) === 'radio' && hasRadio ? 'radio' : 'log'

  // Newest call at the bottom, like a chat: keep it in view as calls arrive.
  useEffect(() => {
    if (open && view === 'radio' && radioCalls.length) listEnd.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [open, view, radioCalls.length])

  const airport = getAirport(airportIcao)
  const station = resolveStation(airport, stationId)
  const close = () => setPanel(null)

  return (
    <PanelFrame docked={docked} open={open} title={playback ? 'Transcript' : view === 'radio' ? 'Live radio' : 'Tower log'} onClose={close} tone="black">
      <p className="-mt-1.5 mb-4 px-1 text-footnote text-white/55">
        {airport.icao} {station?.label}
        {station?.frequencyMhz != null ? `, ${formatMhz(station.frequencyMhz)}` : ''}
      </p>

      {!playback && hasRadio && (
        <div className="mb-4 inline-flex rounded-full bg-white/10 p-1 text-sm font-semibold" role="tablist" aria-label="Show">
          {(['radio', 'log'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={view === t}
              className={`rounded-full px-3.5 py-1.5 transition ${view === t ? 'bg-white text-black' : 'text-white/70 hover:text-white'}`}
              onClick={() => setTab(t)}
            >
              {t === 'radio' ? 'Radio' : 'Tower log'}
            </button>
          ))}
        </div>
      )}

      {view === 'radio' ? (
        radioCalls.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-[15px] font-semibold">Listening</p>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-atc-muted">
              {transcripts === 'unavailable'
                ? 'Live transcripts need the deployed site. The audio still plays here.'
                : 'Each call on this channel is written out here a moment after it is spoken. Quiet channels can go minutes without a call.'}
            </p>
          </div>
        ) : (
          <ol className="flex flex-col gap-1">
            {radioCalls.map((c) => {
              const target = c.icao24
              const label = callLabel(c)
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={!target}
                    className="w-full rounded-2xl px-3 py-2.5 text-left transition-colors enabled:hover:bg-white/[0.07]"
                    onClick={() => {
                      if (!target) return
                      select(target)
                      close()
                    }}
                  >
                    <span className="flex items-center gap-2 text-xs font-medium text-white/45">
                      {label && <span className={`font-semibold ${c.speaker === 'pilot' ? 'text-[#7DB3FF]' : 'text-white/65'}`}>{label}</span>}
                      <span className="tabular-nums">{new Date(c.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>
                    </span>
                    <span className="mt-0.5 block text-[21px] font-semibold leading-snug text-white/90">{c.text}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        )
      ) : playback ? (
        cues.length === 0 ? (
          <p className="py-10 text-center text-subhead text-atc-muted">Nothing was logged during this stretch. Scrub the timeline to see the traffic move.</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {cues.map((c) => {
              const active = c.id === activeId
              const past = c.endMs <= tMs
              const label = c.callsign ? (clip.aircraft?.[c.callsign]?.callsign ?? c.callsign).toUpperCase() : (c.speaker ?? '')
              return (
                <li key={c.id} ref={active ? activeRef : undefined}>
                  <button
                    type="button"
                    aria-current={active || undefined}
                    className={`pressable-soft w-full rounded-2xl px-3 py-2.5 text-left hover:bg-white/[0.07] ${active ? 'bg-white/10' : ''}`}
                    onClick={() => {
                      setTMs(c.startMs)
                      setPlaying(true)
                      if (c.callsign && clip.kind === 'rewind') select(trackId(c.callsign))
                      close()
                    }}
                  >
                    <span className="flex items-center gap-2 text-caption font-medium text-white/45">
                      <span className="flex items-center gap-1.5 font-semibold text-white/65">
                        {c.callsign && <AirlineLogo callsign={label} icao24={trackId(c.callsign)} height={14} maxWidth={24} />}
                        {label}
                      </span>
                      {c.speaker && c.speaker !== 'Tower log' && <span>{c.speaker}</span>}
                      <span className="tabular-nums">{clip.startedAt != null ? new Date(clip.startedAt + c.startMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : formatClock(c.startMs)}</span>
                    </span>
                    <span className={`mt-0.5 block text-title3 font-semibold transition-colors duration-[var(--duration-base)] ${active ? 'text-white' : past ? 'text-white/80' : 'text-white/40'}`}>{c.text}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        )
      ) : events.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-body font-semibold">Watching the runways</p>
          <p className="mx-auto mt-2 max-w-sm text-footnote text-atc-muted">
            Takeoffs, landings and go-arounds are logged here as they happen, worked out from where aircraft are. Press play on the station bar to hear the channel live and read along.
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-1">
          {events.map((e) => {
            const Icon = EVENT_ICON[e.kind]
            return (
              <li key={e.id}>
                <button
                  type="button"
                  className="pressable-soft flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-white/[0.07]"
                  onClick={() => {
                    select(e.icao24)
                    close()
                  }}
                >
                  <span className={`mt-1 grid size-7 shrink-0 place-items-center rounded-full ${e.kind === 'emergency' ? 'bg-atc-live text-white' : 'bg-atc-yellow text-black'}`}>
                    <Icon className="size-4" strokeWidth={2.5} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-caption font-medium tabular-nums text-white/45">
                      <AirlineLogo callsign={e.callsign} icao24={e.icao24} height={14} maxWidth={24} />
                      {new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className="block text-title3 font-semibold">{e.text}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
      {playback && cues.length > 0 && <p className="py-6 text-center text-caption text-white/35">Tap a line to jump the replay there.</p>}
      {view === 'radio' && radioCalls.length > 0 && <p className="py-6 text-center text-caption text-white/35">Live audio from LiveATC.net. Transcripts are machine-made and can be wrong.</p>}
      <div ref={listEnd} />
    </PanelFrame>
  )
}
