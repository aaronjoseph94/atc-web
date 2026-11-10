/**
 * The full conversation, big and readable. In a replay: every radio call,
 * tap one to jump there. Live: the tower log of detected takeoffs, landings
 * and go-arounds, tap one to find that aircraft.
 */
import { ArrowDown, ArrowUp, ArrowUpFromLine, RotateCcw, Siren } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { AirlineLogo } from '../airline/AirlineLogo'
import { getAirport, resolveStation } from '../api/airports'
import { formatMhz } from '../api/airportData'
import type { LiveEvent } from '../live/events'
import { trackId } from '../playback/interpolate'
import { formatClock } from '../playback/Timeline'
import { usePlayhead } from '../playback/playheadStore'
import { FullPanel } from '../ui/Panel'

const EVENT_ICON: Record<LiveEvent['kind'], typeof ArrowUp> = { departed: ArrowUp, landed: ArrowDown, goaround: RotateCcw, lineup: ArrowUpFromLine, emergency: Siren }

export function TranscriptsView() {
  const open = usePlayhead((s) => s.panel === 'transcripts')
  const clip = usePlayhead((s) => s.clip)
  const tMs = usePlayhead((s) => s.tMs)
  const mode = usePlayhead((s) => s.mode)
  const events = usePlayhead((s) => s.events)
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const stationId = usePlayhead((s) => s.stationId)
  const setPanel = usePlayhead((s) => s.setPanel)
  const setTMs = usePlayhead((s) => s.setTMs)
  const setPlaying = usePlayhead((s) => s.setPlaying)
  const select = usePlayhead((s) => s.select)
  const activeRef = useRef<HTMLLIElement>(null)

  const playback = mode === 'playback' && !!clip
  const cues = playback ? clip.cues : []
  const activeId = cues.find((c) => tMs >= c.startMs && tMs < c.endMs)?.id

  // Keep the line being spoken in view.
  useEffect(() => {
    if (open) activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [open, activeId])

  const airport = getAirport(airportIcao)
  const station = resolveStation(airport, stationId)
  const close = () => setPanel(null)

  return (
    <FullPanel open={open} title={playback ? 'Transcript' : 'Tower log'} onClose={close} tone="black">
      <p className="-mt-2 mb-4 text-sm text-white/55">
        {airport.icao} {station?.label}
        {station?.frequencyMhz != null ? `, ${formatMhz(station.frequencyMhz)}` : ''}
      </p>

      {playback ? (
        cues.length === 0 ? (
          <p className="py-10 text-center text-sm text-atc-muted">Nothing was logged during this stretch. Scrub the timeline to see the traffic move.</p>
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
                    className={`w-full rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.07] ${active ? 'bg-white/10' : ''}`}
                    onClick={() => {
                      setTMs(c.startMs)
                      setPlaying(true)
                      if (c.callsign && clip.kind === 'rewind') select(trackId(c.callsign))
                      close()
                    }}
                  >
                    <span className="flex items-center gap-2 text-xs font-medium text-white/45">
                      <span className="flex items-center gap-1.5 font-semibold text-white/65">
                        {c.callsign && <AirlineLogo callsign={label} icao24={trackId(c.callsign)} height={14} maxWidth={24} />}
                        {label}
                      </span>
                      {c.speaker && c.speaker !== 'Tower log' && <span>{c.speaker}</span>}
                      <span className="tabular-nums">{clip.startedAt != null ? new Date(clip.startedAt + c.startMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : formatClock(c.startMs)}</span>
                    </span>
                    <span className={`mt-0.5 block text-[21px] font-semibold leading-snug ${active ? 'text-white' : past ? 'text-white/80' : 'text-white/40'}`}>{c.text}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        )
      ) : events.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-[15px] font-semibold">Watching the runways</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-atc-muted">
            Takeoffs, landings and go-arounds are logged here as they happen. Free live feeds carry positions, not radio, so this log is worked out from where aircraft are. For radio with a transcript, open Replay from the menu.
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
                  className="flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.07]"
                  onClick={() => {
                    select(e.icao24)
                    close()
                  }}
                >
                  <span className={`mt-1 grid size-7 shrink-0 place-items-center rounded-full ${e.kind === 'emergency' ? 'bg-atc-live text-white' : 'bg-atc-yellow text-black'}`}>
                    <Icon className="size-4" strokeWidth={2.5} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-xs font-medium tabular-nums text-white/45">
                      <AirlineLogo callsign={e.callsign} icao24={e.icao24} height={14} maxWidth={24} />
                      {new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className="block text-[19px] font-semibold leading-snug">{e.text}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
      {playback && cues.length > 0 && <p className="py-6 text-center text-xs text-white/35">Tap a line to jump the replay there.</p>}
    </FullPanel>
  )
}
