/** The "Back to automatic map" pill that appears once the user has moved the map themselves. */
import { Sparkles } from 'lucide-react'
import { usePlayhead } from '../playback/playheadStore'
import { useSettings } from '../settings/settingsStore'
import { usePresence } from '../ui/usePresence'

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
