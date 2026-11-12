/**
 * Floating map controls: only north-up, and only once the map has been
 * turned. (Map overlays live in the menu; zooming is by gesture, wheel or the
 * + and − keys; H re-frames the airfield.) Also the "Back to automatic map"
 * pill that appears once the user has moved the map themselves.
 */
import { Compass, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { usePlayhead } from '../playback/playheadStore'
import { useSettings } from '../settings/settingsStore'
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
  const bearing = useBearing()
  const turned = Math.abs(bearing) > 1
  const compass = usePresence(turned, 200)
  if (!compass.mounted) return null
  return (
    <div className="pointer-events-none absolute right-3 top-[calc(max(0.75rem,var(--safe-top))+3.75rem)] z-20 flex flex-col gap-2.5 md:right-4">
      <GlassButton label="North up" shortcut="N" onClick={cameraNudge.northUp} className="motion-pop" closing={compass.closing}>
        {/* The needle (the icon's north-east point) keeps pointing at true north as the map turns. */}
        <Compass className="size-5" style={{ transform: `rotate(${-bearing - 45}deg)` }} />
      </GlassButton>
    </div>
  )
}

/** Offered once the user has taken the map, when nothing is selected. */
export function AutoMapPill() {
  // Not with "Automatic camera" turned off in Settings: the map starts out manual then, and offering
  // the automatic map on every launch would nag about a choice the user made on purpose.
  const autoCamera = useSettings((s) => s.autoCamera)
  const show = usePlayhead((s) => s.cameraMode === 'manual' && !s.selectedIcao) && autoCamera
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
