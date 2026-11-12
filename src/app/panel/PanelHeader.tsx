/**
 * The side panel's header: a small copy of the yellow station bar, so the
 * panel reads as part of the same instrument. The airport code on a yellow
 * sign (tap to change airport), its name, the channel being followed with
 * the on-air lamp beside it (tap to change channel), the weather at a glance
 * and play/pause for the radio.
 *
 * The lamp is the panel's one live element: red while the radio plays, and
 * while somebody transmits it takes that speaker's colour (pink for the
 * controller, blue for a pilot) and breathes. In a replay the same row shows
 * the scene and plays or pauses it.
 */
import { ChevronRight, ChevronsUpDown, Loader2, MoreHorizontal, PanelRightClose, Pause, Play, VolumeX, Wind } from 'lucide-react'
import { formatMhz } from '../../api/airportData'
import { getAirport, resolveStation } from '../../api/airports'
import { useRadio } from '../../live/radio/radioStore'
import { toggleRadio } from '../../live/radio/useLiveRadio'
import { usePlayhead } from '../../playback/playheadStore'
import { CATEGORY_COLOR, useWeather } from '../../station/StationBar'
import { Lamp } from '../../ui/kit'
import { Tooltip } from '../../ui/Panel'
import { useLampState, windShort } from './panelStore'

/** Play/pause for the live radio, or for the replay while one is running. */
export function PanelPlayButton({ size = 'md' }: { size?: 'md' | 'sm' }) {
  const playback = usePlayhead((s) => s.mode === 'playback' && !!s.clip)
  const replayPlaying = usePlayhead((s) => s.playing)
  const setPlaying = usePlayhead((s) => s.setPlaying)
  const on = useRadio((s) => s.on)
  const status = useRadio((s) => s.status)
  const livePlaying = on && (status === 'live' || status === 'buffering' || status === 'connecting' || status === 'reconnecting' || status === 'offline')
  const waiting = !playback && on && (status === 'connecting' || status === 'buffering' || status === 'reconnecting')
  const nofeed = !playback && status === 'nofeed'
  const playing = playback ? replayPlaying : livePlaying
  const Icon = nofeed ? VolumeX : playing ? Pause : Play
  const name = playback ? (playing ? 'Pause the replay' : 'Play the replay') : nofeed ? 'No live audio on this channel' : playing ? 'Pause the radio' : 'Play the radio'
  const box = size === 'md' ? 'size-10' : 'size-9'
  return (
    <button
      type="button"
      aria-label={name}
      aria-pressed={playing}
      onClick={() => (playback ? setPlaying(!replayPlaying) : toggleRadio())}
      className={`has-tooltip pressable relative grid ${box} shrink-0 place-items-center rounded-full ${
        nofeed ? 'bg-white/[0.08] text-white/50' : playing ? 'bg-white/[0.1] text-white ring-1 ring-inset ring-white/[0.12] hover:bg-white/[0.16]' : 'on-yellow bg-atc-yellow text-black shadow-[0_2px_10px_rgb(0_0_0/0.3)] hover:bg-atc-yellow-deep'
      }`}
    >
      {waiting && <Loader2 aria-hidden className={`absolute ${box} animate-spin text-atc-yellow/80 [stroke-width:1.25]`} />}
      <Icon className={`size-4 ${Icon === VolumeX ? '' : 'fill-current'} ${Icon === Play ? 'translate-x-px' : ''}`} strokeWidth={2.5} />
      <Tooltip label={name} side={size === 'md' ? 'bottom' : 'left'} />
    </button>
  )
}

export function PanelHeader({ onCollapse }: { onCollapse: () => void }) {
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const stationId = usePlayhead((s) => s.stationId)
  const clipTitle = usePlayhead((s) => (s.mode === 'playback' && s.clip ? (s.clip.kind === 'rewind' ? 'Traffic replay' : s.clip.title) : null))
  const setPanel = usePlayhead((s) => s.setPanel)
  const airport = getAirport(airportIcao)
  const station = resolveStation(airport, stationId)
  const metar = useWeather(airportIcao).data?.metar
  const lamp = useLampState()
  const name = airport.stations[0]?.name ?? airport.name
  const mhz = station?.frequencyMhz != null ? formatMhz(station.frequencyMhz) : null
  const stationText = `${station?.label ?? 'Tower'}${mhz ? ` ${mhz}` : ''}`
  // "Tower (Rwy 4R-22L, 13L-31R)" is too long for this row; its frequency already tells it from the other tower.
  const shortLabel = (station?.label ?? 'Tower').replace(/\s*\(.*$/, '') || 'Tower'

  return (
    <header className="@container flex shrink-0 items-center gap-2.5 pb-2.5 pl-3 pr-2 pt-3">
      <button
        type="button"
        aria-label={`${airport.name}: choose another airport`}
        title="Choose another airport"
        onClick={() => setPanel('airports')}
        className="on-yellow pressable display-tight grid h-11 min-w-[3.25rem] shrink-0 place-items-center rounded-[0.8rem] bg-atc-yellow px-2 font-display text-[1.7rem] leading-none text-black shadow-[inset_0_-2px_0_rgb(0_0_0/0.14),0_2px_8px_rgb(0_0_0/0.3)] hover:bg-atc-yellow-deep"
      >
        {airport.icao}
      </button>

      <div className="flex min-w-0 flex-1 flex-col items-start">
        <button type="button" aria-hidden tabIndex={-1} onClick={() => setPanel('airports')} className="group flex max-w-full items-center gap-1 rounded-md text-left text-subhead font-semibold leading-5 text-white">
          <span className="truncate">{name}</span>
          <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-white/40 transition-colors group-hover:text-white/80" strokeWidth={2.5} />
        </button>
        {clipTitle ? (
          <button type="button" aria-label={`Replay: ${clipTitle}. Choose another`} onClick={() => setPanel('replay')} className="group mt-px flex max-w-full items-center gap-1.5 rounded-md text-left text-footnote text-white/70 hover:text-white">
            <Lamp state={lamp.state} color={lamp.color} />
            <span className="shrink-0 font-semibold text-[#E58BF2]">Replay</span>
            <span className="truncate">{clipTitle}</span>
          </button>
        ) : (
          <button
            type="button"
            aria-label={`${stationText}: choose another channel. ${lamp.label}`}
            title="Choose another channel"
            onClick={() => setPanel('stations')}
            className="group mt-px flex max-w-full items-center gap-1.5 rounded-md text-left text-footnote text-white/70 hover:text-white"
          >
            <Lamp state={lamp.state} color={lamp.color} />
            <span className="truncate">{shortLabel}</span>
            {mhz && <span className="shrink-0 tabular-nums text-white/55">{mhz}</span>}
            <ChevronRight aria-hidden className="-ml-1 size-3.5 shrink-0 text-white/40 transition-colors group-hover:text-white/80" strokeWidth={2.5} />
          </button>
        )}
      </div>

      {metar && (
        <button
          type="button"
          aria-label={`Weather: ${metar.flightCategory ?? 'reported'}, wind ${windShort(metar)}`}
          onClick={() => setPanel('weather')}
          className="pressable hidden h-10 shrink-0 flex-col items-end justify-center rounded-xl bg-white/[0.06] px-2.5 text-right ring-1 ring-inset ring-white/[0.06] hover:bg-white/[0.1] @[23.5rem]:flex"
        >
          <span className="flex items-center gap-1.5 text-caption2 font-bold leading-[14px]">
            {metar.flightCategory && <span aria-hidden className="size-2 rounded-full" style={{ background: CATEGORY_COLOR[metar.flightCategory] }} />}
            {metar.flightCategory ?? 'Weather'}
          </span>
          <span className="flex items-center gap-1 text-caption2 font-medium tabular-nums leading-[14px] text-white/65">
            <Wind aria-hidden className="size-3" />
            {windShort(metar)}
          </span>
        </button>
      )}
      <PanelPlayButton />
      <PanelMenuButton />
      <button
        type="button"
        aria-label="Hide side panel"
        aria-keyshortcuts="]"
        className="has-tooltip pressable relative grid size-8 shrink-0 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
        onClick={onCollapse}
      >
        <PanelRightClose className="size-[18px]" />
        <Tooltip label="Hide panel" shortcut="]" side="left" />
      </button>
    </header>
  )
}

/** The app menu (Replay, Transcript, Map, Settings…), opened from the panel's header beside the panel. */
function PanelMenuButton() {
  const open = usePlayhead((s) => s.panel === 'menu')
  const setPanel = usePlayhead((s) => s.setPanel)
  return (
    <button
      type="button"
      aria-label="Menu"
      aria-keyshortcuts="M"
      aria-haspopup="menu"
      aria-expanded={open}
      className={`has-tooltip pressable relative grid size-8 shrink-0 place-items-center rounded-full hover:bg-white/10 hover:text-white ${open ? 'bg-white/15 text-white' : 'text-white/60'}`}
      onClick={() => setPanel(open ? null : 'menu')}
    >
      <MoreHorizontal className="size-[18px]" />
      {!open && <Tooltip label="Menu" shortcut="M" side="left" />}
    </button>
  )
}
