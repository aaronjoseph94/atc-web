/**
 * Root layout. The map fills the viewport; everything else is layered on top:
 *
 *   top chrome   — clear-selection, LIVE/PLAYBACK badge, menu
 *   bottom stack — flight sheet → karaoke → station bar (mobile: edge-to-edge,
 *                  desktop: floating card)
 *   overlays     — scrubber, menu, airport picker, transcripts, settings, toast
 */
import { MoreHorizontal, X } from 'lucide-react'
import { useEffect } from 'react'
import { getClip } from '../api/client'
import { FlightSheet } from '../flight/FlightSheet'
import { MapView } from '../map/MapView'
import { AudioEngine, PlaybackScrubber } from '../playback/AudioEngine'
import { usePlayhead } from '../playback/playheadStore'
import { SettingsView } from '../settings/SettingsView'
import { StationBar } from '../station/StationBar'
import { KaraokeOverlay } from '../transcript/KaraokeOverlay'
import { AirportPicker } from './AirportPicker'
import { LiveBadge } from './LiveBadge'
import { OverflowMenu } from './OverflowMenu'
import { TranscriptsView } from './TranscriptsView'

/** Demo clip preloaded so "Enter playback" is instant. */
const DEMO_CLIP = 'ord-tower-demo'

export function AppShell() {
  const toast = usePlayhead((s) => s.toast)
  const selectedIcao = usePlayhead((s) => s.selectedIcao)
  const setToast = usePlayhead((s) => s.setToast)
  const setPanel = usePlayhead((s) => s.setPanel)
  const setClip = usePlayhead((s) => s.setClip)
  const setSheetOpen = usePlayhead((s) => s.setSheetOpen)
  const setSelectedIcao = usePlayhead((s) => s.setSelectedIcao)

  useEffect(() => {
    void getClip(DEMO_CLIP).then(setClip).catch(() => {})
  }, [setClip])

  // Toasts auto-dismiss.
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(id)
  }, [toast, setToast])

  return (
    <div className="relative h-full w-full overflow-hidden bg-atc-bg">
      <AudioEngine />
      <MapView />

      {/* Legibility gradients over the map edges */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/60 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/50 to-transparent" />

      {/* Top chrome */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between px-3 pt-[max(0.75rem,var(--safe-top))]">
        <div className="w-11">
          {selectedIcao && (
            <button
              type="button"
              aria-label="Clear selection"
              className="pointer-events-auto animate-fade rounded-full bg-black/50 p-2.5 shadow backdrop-blur-md transition hover:bg-black/70"
              onClick={() => {
                setSelectedIcao(null)
                setSheetOpen(false)
              }}
            >
              <X className="size-5" />
            </button>
          )}
        </div>

        <LiveBadge />

        <button
          type="button"
          aria-label="Open menu"
          className="pointer-events-auto rounded-full bg-black/50 p-2.5 shadow backdrop-blur-md transition hover:bg-black/70"
          onClick={() => setPanel('menu')}
        >
          <MoreHorizontal className="size-5" />
        </button>
      </div>

      <PlaybackScrubber />

      {/* Bottom stack */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 md:bottom-6 md:px-6">
        <FlightSheet />
        <KaraokeOverlay />
        <StationBar />
      </div>

      <OverflowMenu />
      <AirportPicker />
      <TranscriptsView />
      <SettingsView />

      {toast && (
        <div
          role="status"
          className="absolute left-1/2 top-[max(4.5rem,calc(var(--safe-top)+3.5rem))] z-50 max-w-xs -translate-x-1/2 animate-rise rounded-xl bg-black/85 px-3 py-2 text-center text-sm text-white shadow-lg ring-1 ring-white/10"
        >
          {toast}
        </div>
      )}
    </div>
  )
}
