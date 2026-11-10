/**
 * Root layout. The map fills the viewport; everything else is layered on top:
 *
 *   top chrome   — clear/back, status pill, menu; map controls down the right edge
 *   bottom stack — "back to automatic map", subtitles, then the flight card
 *                  or the yellow station bar (mobile: edge-to-edge, desktop: floating)
 *   overlays     — channel switcher, flight detail, panels, menu, toast
 *
 * On wide screens (≥ 1024 px) a side panel docks on the right (DesktopPanel)
 * with the selected flight or the Transcript / Traffic / Weather tabs. The map
 * still runs underneath it, but all the floating chrome lives in `#map-chrome`,
 * a box that stops where the panel starts, so nothing hides behind it.
 */
import { memo, useEffect, useRef, useState } from 'react'
import { FlightCard, FlightDetail } from '../flight/FlightSheet'
import { useLiveCaptions } from '../hooks/useLiveCaptions'
import { useShortcuts } from '../hooks/useShortcuts'
import { useUrlSync } from '../hooks/useUrlSync'
import { useRadio } from '../live/radio/radioStore'
import { MapView } from '../map/MapView'
import { AudioEngine } from '../playback/AudioEngine'
import { getActiveCue } from '../playback/interpolate'
import { usePlayhead } from '../playback/playheadStore'
import { SettingsView } from '../settings/SettingsView'
import { useSettings } from '../settings/settingsStore'
import { StationBar } from '../station/StationBar'
import { StationSheet } from '../station/StationSheet'
import { Subtitles } from '../transcript/Subtitles'
import { useHapticFeedback } from '../ui/useHapticFeedback'
import { DURATION } from '../ui/motion'
import { installGlass, watchMapFrames } from '../ui/glass'
import { useDockActive, useIsWide } from '../ui/layout'
import { MapStatus } from '../ui/MapStatus'
import { installScrollFades } from '../ui/scrollFade'
import { usePresence } from '../ui/usePresence'
import { WeatherPanel } from '../weather/WeatherPanel'
import { AirportPicker } from './AirportPicker'
import { HelpPanel } from './HelpPanel'
import { LayersPanel } from './LayersPanel'
import { DesktopPanel } from './DesktopPanel'
import { AutoMapPill, MapControls } from './MapControls'
import { MapGestures } from './MapGestures'
import { Menu } from './Menu'
import { ReplayPanel } from './ReplayPanel'
import { RunwayInfo } from './RunwayInfo'
import { TopBar } from './TopBar'
import { TrafficPanel } from './TrafficPanel'
import { TranscriptsView } from './TranscriptsView'
import { useMap } from './useMap'

// Decide on glass before the first paint, and turn on scroll-edge fades for the whole document.
installGlass()
installScrollFades()

export function AppShell() {
  const mode = usePlayhead((s) => s.mode)
  const sheet = usePlayhead((s) => s.sheet)
  const tracking = usePlayhead((s) => s.following && !!s.selectedIcao)
  const reduceMotion = useSettings((s) => s.reduceMotion)
  const stack = useRef<HTMLDivElement>(null)
  const wide = useIsWide()
  const docked = useDockActive()
  // With the side panel showing, the selected flight lives there and the station bar stays put.
  const cardOpen = sheet !== 'closed' && !docked
  const cardStack = usePresence(cardOpen, DURATION.exit + 80)
  const map = useMap()

  useShortcuts()
  useUrlSync()
  useLiveCaptions()
  useHapticFeedback()

  // Publish the bottom stack's height so the map attribution can sit above it.
  useEffect(() => {
    const el = stack.current
    if (!el) return
    const apply = () => {
      const root = document.documentElement
      root.style.setProperty('--bottom-stack', `${el.offsetHeight}px`)
      // On wider screens the attribution button sits in the map's bottom-right corner, beside the floating
      // bar. When the map area is too narrow for both (a 1024 px window with the side panel open), lift it
      // above the bar as on phones. The stack is as wide as the map area, so this re-runs when that changes.
      const bar = el.querySelector('[data-bar]')
      const room = bar ? el.getBoundingClientRect().right - bar.getBoundingClientRect().right : Infinity
      root.classList.toggle('attrib-lift', room < 56)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Drop the blur for the session if dragging the map runs slowly with it on.
  useEffect(() => (map ? watchMapFrames(map) : undefined), [map])

  // A live feed that stops answering says so in the status pill, and on the map itself when it is empty (MapStatus).

  return (
    <div className={`relative h-full w-full overflow-hidden bg-atc-bg ${reduceMotion ? 'reduce-motion' : ''}`}>
      <MapLayer />

      {/* Tint over the top of the map: neutral, purple while tracking a flight, magenta in a replay.
          Gradients can't be transitioned, so the three tints cross-fade. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/55 to-transparent" />
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-atc-card/60 to-transparent transition-opacity duration-500 ease-[var(--ease-in-out)] ${tracking && mode !== 'playback' ? 'opacity-100' : 'opacity-0'}`} />
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-atc-magenta/55 to-transparent transition-opacity duration-500 ease-[var(--ease-in-out)] ${mode === 'playback' ? 'opacity-100' : 'opacity-0'}`} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-[#070b14]/90 via-[#070b14]/45 to-transparent" />

      {/* Everything floating over the map, kept to the part of the screen the side panel leaves free. */}
      <div id="map-chrome" className="pointer-events-none absolute inset-y-0 left-0">
        <Chrome />
        <MapStatus />

        <div ref={stack} id="bottom-stack" className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center *:max-w-full md:bottom-6 md:px-6">
          <Hint />
          <AutoMapPill />
          <Subtitles />
          <WaitingStrip />
          {/* The flight card slides up over the station bar and back down to reveal it, as one stack. */}
          {/* Beside the side panel the bars are as wide as the map area allows. */}
          {/* On a phone the one column is the screen's width: an auto column would grow to fit the bar's untruncated channel name and push the play button off screen. */}
          <div data-bar className={`grid w-full justify-items-center ${wide ? 'grid-cols-[minmax(0,1fr)] lg:max-w-[40rem]' : 'max-md:grid-cols-[minmax(0,1fr)] md:w-auto'}`}>
            <div className={`pointer-events-none flex w-full justify-center self-end *:max-w-full [grid-area:1/1] ${wide ? '' : 'md:w-auto'} ${cardOpen ? 'invisible delay-[var(--duration-sheet)]' : ''} transition-[visibility]`} inert={cardOpen}>
              <StationBar />
            </div>
            <div className={`pointer-events-none flex w-full justify-center self-end *:max-w-full [grid-area:1/1] ${wide ? '' : 'md:w-auto'}`}>
              {/* Mounted only while a flight is selected (and while its card slides away). */}
              {cardStack.mounted && <FlightCard />}
            </div>
          </div>
        </div>
        <MapOverlays />
      </div>

      {wide && <DesktopPanel />}
      <Modals />
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

/** Things anchored to the map area: runway callouts, gesture ripples, the menu popover and toasts. */
const MapOverlays = memo(function MapOverlays() {
  return (
    <>
      <RunwayInfo />
      <MapGestures />
      {/* The chrome box lets clicks through to the map; the menu's own backdrop needs them back. */}
      <div className="pointer-events-auto contents">
        <Menu />
      </div>
      <Toast />
    </>
  )
})

/** Sheets and dialogs over the whole window. */
const Modals = memo(function Modals() {
  return (
    <>
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
    </>
  )
})

/** The full flight view, mounted only while it is open or closing (hidden, it would still tick with the flight). In the side panel instead when that is showing. */
function SelectedFlightDetail() {
  const docked = useDockActive()
  const { mounted } = usePresence(usePlayhead((s) => s.sheet === 'full') && !docked, DURATION.exit + 80)
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
  // The live radio has its own caption line (and an "On the air" row while someone talks); the hint must not sit on it.
  const radioCaption = useRadio((s) => !!s.caption || s.speaking || (s.pending > 0 && s.transcripts !== 'unavailable'))
  useEffect(() => {
    if (selected && !seen) update('hintSeen', true)
  }, [selected, seen, update])
  const { mounted, closing } = usePresence(!seen && ready && !radioCaption && !selected, 200)
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
      className={`motion-pop pointer-events-auto absolute left-1/2 top-[calc(max(0.75rem,var(--safe-top))+3.6rem)] z-[60] flex w-max max-w-[min(92%,26rem)] -translate-x-1/2 origin-top items-center gap-3 rounded-2xl py-2.5 pl-4 text-subhead font-medium shadow-pop ring-1 ${
        shown.tone === 'error' ? 'bg-[#3a1418]/95 text-white ring-atc-live/50 backdrop-blur-xl' : 'glass-pop text-white ring-white/[0.12]'
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
