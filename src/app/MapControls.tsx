/**
 * Floating map controls: 3D view, layers, re-frame the airfield, north-up,
 * and zoom buttons on screens with a pointer. Also the "Back to automatic
 * map" pill that appears once the user has moved the map themselves.
 */
import { Box, Compass, Layers, Locate, Minus, Plus, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { mapHandle } from '../live/session'
import { usePlayhead } from '../playback/playheadStore'
import { GlassButton } from '../ui/Panel'

/** Map bearing, for the compass needle. Zero when north is up. */
function useBearing() {
  const [bearing, setBearing] = useState(0)
  useEffect(() => {
    let raf = 0
    const read = () => {
      const b = mapHandle.current?.getBearing() ?? 0
      setBearing((prev) => (Math.abs(prev - b) > 0.5 ? b : prev))
      raf = requestAnimationFrame(read)
    }
    raf = requestAnimationFrame(read)
    return () => cancelAnimationFrame(raf)
  }, [])
  return bearing
}

export function MapControls() {
  const tilt = usePlayhead((s) => s.tilt)
  const panel = usePlayhead((s) => s.panel)
  const setTilt = usePlayhead((s) => s.setTilt)
  const setPanel = usePlayhead((s) => s.setPanel)
  const setCameraMode = usePlayhead((s) => s.setCameraMode)
  const setFollowing = usePlayhead((s) => s.setFollowing)
  const bearing = useBearing()

  const home = () => {
    setFollowing(false)
    setCameraMode('auto')
    mapHandle.home?.()
  }

  return (
    <div className="pointer-events-none absolute right-3 top-[calc(max(0.75rem,var(--safe-top))+3.75rem)] z-20 flex flex-col gap-2">
      <GlassButton label={tilt ? 'Flat view' : '3D view'} active={tilt} onClick={() => setTilt(!tilt)}>
        <Box className="size-5" />
      </GlassButton>
      <GlassButton label="Map layers" active={panel === 'layers'} onClick={() => setPanel(panel === 'layers' ? null : 'layers')}>
        <Layers className="size-5" />
      </GlassButton>
      <GlassButton label="Show the whole airfield" onClick={home}>
        <Locate className="size-5" />
      </GlassButton>
      {Math.abs(bearing) > 1 && !tilt && (
        <GlassButton label="North up" onClick={() => mapHandle.current?.easeTo({ bearing: 0, duration: 500 })} className="animate-pop">
          <Compass className="size-5 transition-transform" style={{ transform: `rotate(${-bearing - 45}deg)` }} />
        </GlassButton>
      )}
      <div className="hidden flex-col gap-2 pt-2 [@media(hover:hover)]:flex">
        <GlassButton label="Zoom in" onClick={() => mapHandle.current?.zoomIn({ duration: 250 })}>
          <Plus className="size-5" />
        </GlassButton>
        <GlassButton label="Zoom out" onClick={() => mapHandle.current?.zoomOut({ duration: 250 })}>
          <Minus className="size-5" />
        </GlassButton>
      </div>
    </div>
  )
}

/** Offered once the user has taken the map, when nothing is selected. */
export function AutoMapPill() {
  const show = usePlayhead((s) => s.cameraMode === 'manual' && !s.selectedIcao)
  const setCameraMode = usePlayhead((s) => s.setCameraMode)
  if (!show) return null
  return (
    <div className="flex w-full justify-start px-4 pb-1 md:w-[min(92vw,40rem)] md:px-1">
      <button
        type="button"
        className="pointer-events-auto flex animate-pop items-center gap-1.5 rounded-full bg-atc-blue px-3.5 py-2 text-[13px] font-bold text-white shadow-lg transition hover:brightness-110 active:scale-95"
        onClick={() => setCameraMode('auto')}
      >
        <Sparkles className="size-4" />
        Back to automatic map
      </button>
    </div>
  )
}
