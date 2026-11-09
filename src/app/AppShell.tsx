import { MoreHorizontal, X } from 'lucide-react'
import { useEffect } from 'react'
import { getClip } from '../api/client'
import { FlightSheet } from '../flight/FlightSheet'
import { MapView } from '../map/MapView'
import { AudioEngine, PlaybackScrubber } from '../playback/AudioEngine'
import { usePlayhead } from '../playback/playheadStore'
import { StationBar } from '../station/StationBar'
import { KaraokeOverlay } from '../transcript/KaraokeOverlay'
import { AirportPicker } from './AirportPicker'
import { OverflowMenu } from './OverflowMenu'
import { TranscriptsView } from './TranscriptsView'

export function AppShell() {
  const mode = usePlayhead((s) => s.mode)
  const toast = usePlayhead((s) => s.toast)
  const setToast = usePlayhead((s) => s.setToast)
  const setMenuOpen = usePlayhead((s) => s.setMenuOpen)
  const setClip = usePlayhead((s) => s.setClip)
  const setSheetOpen = usePlayhead((s) => s.setSheetOpen)
  const setSelectedIcao = usePlayhead((s) => s.setSelectedIcao)

  useEffect(() => {
    void getClip('ord-tower-demo')
      .then(setClip)
      .catch(() => {})
  }, [setClip])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(id)
  }, [toast, setToast])

  return (
    <div className="relative mx-auto flex h-full max-w-3xl flex-col overflow-hidden bg-atc-bg">
      <AudioEngine />

      <div className="relative min-h-0 flex-1">
        <MapView />

        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between px-3 pt-[max(0.65rem,var(--safe-top))]">
          <button
            type="button"
            aria-label="Clear selection"
            className="pointer-events-auto rounded-full bg-black/45 p-2.5 backdrop-blur-md"
            onClick={() => {
              setSelectedIcao(null)
              setSheetOpen(false)
            }}
          >
            <X className="size-5" />
          </button>

          <div className="flex flex-col items-center gap-2">
            <span
              className={`rounded px-2 py-0.5 text-[11px] font-bold tracking-wide text-white ${
                mode === 'live' ? 'bg-atc-live' : 'bg-atc-purple'
              }`}
            >
              {mode === 'live' ? 'LIVE' : 'PLAYBACK'}
            </span>
            <span className="rounded-full bg-atc-purple/90 px-2.5 py-1 text-[11px] font-semibold shadow">
              ATC.com
            </span>
          </div>

          <button
            type="button"
            aria-label="Open menu"
            className="pointer-events-auto rounded-full bg-black/45 p-2.5 backdrop-blur-md"
            onClick={() => setMenuOpen(true)}
          >
            <MoreHorizontal className="size-5" />
          </button>
        </div>

        <PlaybackScrubber />
        <KaraokeOverlay />
        <FlightSheet />
        <OverflowMenu />
        <AirportPicker />
        <TranscriptsView />
      </div>

      <StationBar />

      {toast && (
        <div className="absolute bottom-36 left-1/2 z-50 max-w-xs -translate-x-1/2 rounded-xl bg-black/80 px-3 py-2 text-center text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
