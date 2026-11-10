/**
 * Floating map controls: layers, re-frame the airfield, north-up (only once
 * the map has been turned), and zoom buttons on screens with a pointer. Each
 * shows its name and keyboard shortcut on hover. Also the "Back to automatic
 * map" pill that appears once the user has moved the map themselves.
 */
import { Compass, Layers, Locate, Minus, Plus, Sparkles } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { mapHandle } from '../live/session'
import { usePlayhead } from '../playback/playheadStore'
import { GlassButton } from '../ui/Panel'
import { usePresence } from '../ui/usePresence'
import { cameraNudge } from './camera'
import { useMap } from './useMap'

/** Map bearing, for the compass needle. Zero when north is up. Updates only while the map turns. */
function useBearing() {
  const map = useMap()
  const [bearing, setBearing] = useState(0)
  useEffect(() => {
    if (!map) return
    const read = () => {
      const b = map.getBearing()
      setBearing((prev) => (Math.abs(prev - b) > 0.5 || (b === 0 && prev !== 0) ? b : prev))
    }
    read()
    map.on('rotate', read)
    return () => {
      map.off('rotate', read)
    }
  }, [map])
  return bearing
}

export function MapControls() {
  const panel = usePlayhead((s) => s.panel)
  const setPanel = usePlayhead((s) => s.setPanel)
  const setCameraMode = usePlayhead((s) => s.setCameraMode)
  const setFollowing = usePlayhead((s) => s.setFollowing)
  const bearing = useBearing()
  const turned = Math.abs(bearing) > 1
  const compass = usePresence(turned, 200)

  const home = () => {
    setFollowing(false)
    setCameraMode('auto')
    mapHandle.home?.()
  }

  return (
    <div className="pointer-events-none absolute right-3 top-[calc(max(0.75rem,var(--safe-top))+3.75rem)] z-20 flex flex-col gap-2.5 md:right-4">
      <GlassButton label="Map layers" shortcut="L" active={panel === 'layers'} onClick={() => setPanel(panel === 'layers' ? null : 'layers')}>
        <Layers className="size-5" />
      </GlassButton>
      <GlassButton label="Show the whole airfield" shortcut="H" onClick={home}>
        <Locate className="size-5" />
      </GlassButton>
      {compass.mounted && (
        <GlassButton label="North up" shortcut="N" onClick={cameraNudge.northUp} className="motion-pop" closing={compass.closing}>
          {/* The needle (the icon's north-east point) keeps pointing at true north as the map turns. */}
          <Compass className="size-5" style={{ transform: `rotate(${-bearing - 45}deg)` }} />
        </GlassButton>
      )}
      <div className="hidden flex-col overflow-visible pt-1.5 [@media(hover:hover)]:flex">
        <div className="pointer-events-auto flex flex-col rounded-full bg-atc-glass/75 shadow-float ring-1 ring-white/[0.13] backdrop-blur-xl">
          <ZoomButton label="Zoom in" shortcut="+" onClick={() => cameraNudge.zoom(1)}>
            <Plus className="size-5" />
          </ZoomButton>
          <span className="mx-2.5 h-px bg-white/10" aria-hidden />
          <ZoomButton label="Zoom out" shortcut="−" onClick={() => cameraNudge.zoom(-1)}>
            <Minus className="size-5" />
          </ZoomButton>
        </div>
      </div>
    </div>
  )
}

/** Half of the stacked zoom pill. */
function ZoomButton({ label, shortcut, onClick, children }: { label: string; shortcut: string; onClick: () => void; children: ReactNode }) {
  return (
    <GlassButton label={label} shortcut={shortcut} onClick={onClick} className="!bg-transparent !shadow-none !ring-0 !backdrop-blur-none hover:!bg-white/10">
      {children}
    </GlassButton>
  )
}

/** Offered once the user has taken the map, when nothing is selected. */
export function AutoMapPill() {
  const show = usePlayhead((s) => s.cameraMode === 'manual' && !s.selectedIcao)
  const setCameraMode = usePlayhead((s) => s.setCameraMode)
  const { mounted, closing } = usePresence(show, 200)
  if (!mounted) return null
  return (
    <div className="flex w-full justify-start px-4 pb-2 md:w-[min(92vw,40rem)] md:px-1">
      <button
        type="button"
        data-closing={closing ? '' : undefined}
        className="motion-pop pressable pointer-events-auto flex h-9 origin-bottom-left items-center gap-1.5 rounded-full bg-atc-blue pl-3 pr-3.5 text-footnote font-semibold text-white shadow-float hover:brightness-110"
        onClick={() => setCameraMode('auto')}
      >
        <Sparkles className="size-4" />
        Back to automatic map
      </button>
    </div>
  )
}
