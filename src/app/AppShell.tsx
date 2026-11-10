/**
 * Root layout. The map fills the viewport; everything else is layered on top:
 *
 *   top chrome   — clear/back, status pill, menu; map controls down the right edge
 *   bottom stack — "back to automatic map", subtitles, then the flight card
 *                  or the yellow station bar (mobile: edge-to-edge, desktop: floating)
 *   overlays     — channel switcher, flight detail, panels, menu, toast
 */
import { memo, useEffect, useRef, useState } from 'react'
import { FlightCard, FlightDetail } from '../flight/FlightSheet'
import { useLiveCaptions } from '../hooks/useLiveCaptions'
import { useShortcuts } from '../hooks/useShortcuts'
import { useUrlSync } from '../hooks/useUrlSync'
import { MapView } from '../map/MapView'
import { AudioEngine } from '../playback/AudioEngine'
import { getActiveCue } from '../playback/interpolate'
import { usePlayhead } from '../playback/playheadStore'
import { SettingsView } from '../settings/SettingsView'
import { useSettings } from '../settings/settingsStore'
import { StationBar } from '../station/StationBar'
import { StationSheet } from '../station/StationSheet'
import { Subtitles } from '../transcript/Subtitles'
import { DURATION } from '../ui/motion'
import { usePresence } from '../ui/usePresence'
import { WeatherPanel } from '../weather/WeatherPanel'
import { AirportPicker } from './AirportPicker'
import { HelpPanel } from './HelpPanel'
import { LayersPanel } from './LayersPanel'
import { AutoMapPill, MapControls } from './MapControls'
import { MapGestures } from './MapGestures'
import { Menu } from './Menu'
import { ReplayPanel } from './ReplayPanel'
import { RunwayInfo } from './RunwayInfo'
import { TopBar } from './TopBar'
import { TrafficPanel } from './TrafficPanel'
import { TranscriptsView } from './TranscriptsView'

export function AppShell() {
  const mode = usePlayhead((s) => s.mode)
  const sheet = usePlayhead((s) => s.sheet)
  const tracking = usePlayhead((s) => s.following && !!s.selectedIcao)
  const reduceMotion = useSettings((s) => s.reduceMotion)
  const stack = useRef<HTMLDivElement>(null)
  const cardStack = usePresence(sheet !== 'closed', DURATION.exit + 80)

  useShortcuts()
  useUrlSync()
  useLiveCaptions()

  // Publish the bottom stack's height so the map attribution can sit above it.
  useEffect(() => {
    const el = stack.current
    if (!el) return
    const apply = () => document.documentElement.style.setProperty('--bottom-stack', `${el.offsetHeight}px`)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // A live feed that stops answering deserves one clear message, not a silent empty map.
  const liveStatus = usePlayhead((s) => s.liveStatus)
  const setToast = usePlayhead((s) => s.setToast)
  useEffect(() => {
    if (liveStatus === 'error') setToast({ message: 'Live traffic isn’t answering. Retrying on its own; replays still work.', tone: 'error' })
  }, [liveStatus, setToast])

  return (
    <div className={`relative h-full w-full overflow-hidden bg-atc-bg ${reduceMotion ? 'reduce-motion' : ''}`}>
      <MapLayer />

      {/* Tint over the top of the map: neutral, purple while tracking a flight, magenta in a replay.
          Gradients can't be transitioned, so the three tints cross-fade. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/55 to-transparent" />
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-atc-card/60 to-transparent transition-opacity duration-500 ease-[var(--ease-in-out)] ${tracking && mode !== 'playback' ? 'opacity-100' : 'opacity-0'}`} />
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-atc-magenta/55 to-transparent transition-opacity duration-500 ease-[var(--ease-in-out)] ${mode === 'playback' ? 'opacity-100' : 'opacity-0'}`} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-[#070b14]/90 via-[#070b14]/45 to-transparent" />

      <Chrome />

      <div ref={stack} id="bottom-stack" className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center md:bottom-6 md:px-6">
        <Hint />
        <AutoMapPill />
        <Subtitles />
        <WaitingStrip />
        {/* The flight card slides up over the station bar and back down to reveal it, as one stack. */}
        <div className="grid w-full justify-items-center md:w-auto">
          <div className={`pointer-events-none flex w-full justify-center self-end [grid-area:1/1] md:w-auto ${sheet === 'closed' ? '' : 'invisible delay-[var(--duration-sheet)]'} transition-[visibility]`} inert={sheet !== 'closed'}>
            <StationBar />
          </div>
          <div className="pointer-events-none flex w-full justify-center self-end [grid-area:1/1] md:w-auto">
            {/* Mounted only while a flight is selected (and while its card slides away). */}
            {cardStack.mounted && <FlightCard />}
          </div>
        </div>
      </div>
      <Overlays />
    </div>
  )
}

/*
 * The parts below take no props and keep their own subscriptions, so they are
 * memoised: a change that only the shell cares about (a selection tinting the
 * top of the map, the card replacing the bar) doesn't re-render the map, the
 * chrome and every panel along with it.
 */
const MapLayer = memo(function MapLayer() {
  return (
    <>
      <AudioEngine />
      <MapView />
    </>
  )
})

const Chrome = memo(function Chrome() {
  return (
    <>
      <TopBar />
      <MapControls />
    </>
  )
})

const Overlays = memo(function Overlays() {
  return (
    <>
      <RunwayInfo />
      <MapGestures />
      <StationSheet />
      <SelectedFlightDetail />
      <AirportPicker />
      <TranscriptsView />
      <ReplayPanel />
      <TrafficPanel />
      <WeatherPanel />
      <LayersPanel />
      <SettingsView />
      <HelpPanel />
      <Menu />
      <Toast />
    </>
  )
})

/** The full flight view, mounted only while it is open or closing (hidden, it would still tick with the flight). */
function SelectedFlightDetail() {
  const { mounted } = usePresence(usePlayhead((s) => s.sheet === 'full'), DURATION.exit + 80)
  return mounted ? <FlightDetail /> : null
}

/** The thin purple strip between transmissions in a replay with audio. */
function WaitingStrip() {
  const show = usePlayhead((s) => s.mode === 'playback' && s.playing && !!s.clip?.audioUrl && s.sheet === 'closed' && !getActiveCue(s.clip.cues, s.tMs))
  const { mounted, closing } = usePresence(show, 200)
  if (!mounted) return null
  return (
    <div
      data-closing={closing ? '' : undefined}
      className="motion-fade flex w-full items-center justify-center gap-2 bg-atc-magenta px-4 py-1.5 text-caption font-semibold text-white md:mb-2 md:w-auto md:rounded-full md:shadow-float"
    >
      <span className="size-1.5 animate-pulse-dot rounded-full bg-white" />
      Waiting for the next transmission…
    </div>
  )
}

/** First-run nudge; goes away for good the first time a plane is tapped. */
function Hint() {
  const seen = useSettings((s) => s.hintSeen)
  const update = useSettings((s) => s.update)
  const selected = usePlayhead((s) => !!s.selectedIcao)
  // Only when the screen is otherwise quiet: no caption, no other pill competing for attention.
  const ready = usePlayhead((s) => s.liveStatus === 'ok' && s.liveCount > 0 && s.mode === 'live' && !s.caption && s.cameraMode === 'auto' && !s.panel)
  useEffect(() => {
    if (selected && !seen) update('hintSeen', true)
  }, [selected, seen, update])
  const { mounted, closing } = usePresence(!seen && ready && !selected, 200)
  if (!mounted) return null
  return (
    <div className="mb-2 flex w-full justify-center px-4">
      <button
        type="button"
        data-closing={closing ? '' : undefined}
        className="motion-rise pressable pointer-events-auto rounded-full bg-white px-4 py-2 text-footnote font-semibold text-black shadow-float"
        onClick={() => update('hintSeen', true)}
      >
        Tap any aircraft to follow it
      </button>
    </div>
  )
}

function Toast() {
  const toast = usePlayhead((s) => s.toast)
  const setToast = usePlayhead((s) => s.setToast)
  const { mounted, closing } = usePresence(!!toast, 200)
  // Keep showing the last message while it fades out.
  const [last, setLast] = useState(toast)
  if (toast && toast !== last) setLast(toast)

  // Toasts dismiss themselves; ones with an action stay a little longer.
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), toast.action ? 7000 : 4200)
    return () => window.clearTimeout(id)
  }, [toast, setToast])

  const shown = toast ?? last
  if (!mounted || !shown) return null
  return (
    <div
      role={shown.tone === 'error' ? 'alert' : 'status'}
      data-closing={closing ? '' : undefined}
      className={`motion-pop absolute left-1/2 top-[calc(max(0.75rem,var(--safe-top))+3.6rem)] z-[60] flex w-max max-w-[min(92vw,26rem)] -translate-x-1/2 origin-top items-center gap-3 rounded-2xl py-2.5 pl-4 text-subhead font-medium shadow-pop ring-1 backdrop-blur-xl ${
        shown.tone === 'error' ? 'bg-[#3a1418]/95 text-white ring-atc-live/50' : 'bg-[#1d2535]/95 text-white ring-white/[0.12]'
      } ${shown.action ? 'pr-2.5' : 'pr-4'}`}
    >
      <span className="min-w-0">{shown.message}</span>
      {shown.action && (
        <button
          type="button"
          className="pressable shrink-0 rounded-full bg-white px-3 py-1.5 text-footnote font-semibold text-black"
          onClick={() => {
            shown.action?.run()
            setToast(null)
          }}
        >
          {shown.action.label}
        </button>
      )}
    </div>
  )
}
