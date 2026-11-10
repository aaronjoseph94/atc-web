/**
 * Root layout. The map fills the viewport; everything else is layered on top:
 *
 *   top chrome   — clear/back, status pill, menu; map controls down the right edge
 *   bottom stack — "back to automatic map", subtitles, then the flight card
 *                  or the yellow station bar (mobile: edge-to-edge, desktop: floating)
 *   overlays     — channel switcher, flight detail, panels, menu, toast
 */
import { useEffect, useRef, useState } from 'react'
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
import { usePresence } from '../ui/usePresence'
import { WeatherPanel } from '../weather/WeatherPanel'
import { AirportPicker } from './AirportPicker'
import { HelpPanel } from './HelpPanel'
import { LayersPanel } from './LayersPanel'
import { AutoMapPill, MapControls } from './MapControls'
import { Menu } from './Menu'
import { ReplayPanel } from './ReplayPanel'
import { TopBar } from './TopBar'
import { TrafficPanel } from './TrafficPanel'
import { TranscriptsView } from './TranscriptsView'

export function AppShell() {
  const mode = usePlayhead((s) => s.mode)
  const sheet = usePlayhead((s) => s.sheet)
  const tracking = usePlayhead((s) => s.following && !!s.selectedIcao)
  const reduceMotion = useSettings((s) => s.reduceMotion)
  const stack = useRef<HTMLDivElement>(null)

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
      <AudioEngine />
      <MapView />

      {/* Tint over the top of the map: neutral, purple while tracking a flight, magenta in a replay. */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b to-transparent transition-colors duration-500 ${
          mode === 'playback' ? 'from-atc-magenta/55' : tracking ? 'from-atc-card/60' : 'from-black/55'
        }`}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-[#070b14]/90 via-[#070b14]/45 to-transparent" />

      <TopBar />
      <MapControls />

      <div ref={stack} id="bottom-stack" className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center md:bottom-6 md:px-6">
        <Hint />
        <AutoMapPill />
        <Subtitles />
        <WaitingStrip />
        {sheet === 'closed' ? <StationBar /> : <FlightCard />}
      </div>

      <StationSheet />
      <FlightDetail />
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
    </div>
  )
}

/** The thin purple strip between transmissions in a replay with audio. */
function WaitingStrip() {
  const show = usePlayhead((s) => s.mode === 'playback' && s.playing && !!s.clip?.audioUrl && s.sheet === 'closed' && !getActiveCue(s.clip.cues, s.tMs))
  const { mounted, closing } = usePresence(show, 200)
  if (!mounted) return null
  return (
    <div className={`flex w-full items-center justify-center gap-2 bg-atc-magenta px-4 py-1.5 text-xs font-semibold text-white md:mb-2 md:w-auto md:rounded-full ${closing ? 'animate-fade-out' : 'animate-fade'}`}>
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
  if (seen || !ready || selected) return null
  return (
    <div className="mb-2 flex w-full justify-center px-4">
      <button
        type="button"
        className="pointer-events-auto animate-rise rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-black shadow-xl transition active:scale-95"
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
      className={`absolute left-1/2 top-[calc(max(0.75rem,var(--safe-top))+3.5rem)] z-[60] flex w-max max-w-[min(92vw,26rem)] -translate-x-1/2 items-center gap-3 rounded-2xl px-4 py-2.5 text-sm font-medium shadow-2xl ring-1 backdrop-blur-xl ${
        shown.tone === 'error' ? 'bg-[#3a1418]/95 text-white ring-atc-live/50' : 'bg-[#1b2333]/95 text-white ring-white/15'
      } ${closing ? 'animate-fade-out' : 'animate-pop'}`}
    >
      <span className="min-w-0">{shown.message}</span>
      {shown.action && (
        <button
          type="button"
          className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-bold text-black active:scale-95"
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
