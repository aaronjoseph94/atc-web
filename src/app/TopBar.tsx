/**
 * Chrome along the top of the map: clear/back on the left, the status pill in
 * the middle (LIVE with aircraft count, TRACK while locked onto a flight,
 * REPLAY during playback), traffic search and the menu on the right.
 */
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, MoreHorizontal, Search, X } from 'lucide-react'
import { useNow } from '../hooks/useNow'
import { agoLabel } from '../playback/Timeline'
import { usePlayhead } from '../playback/playheadStore'
import { GlassButton } from '../ui/Panel'

function StatusPill() {
  const mode = usePlayhead((s) => s.mode)
  const status = usePlayhead((s) => s.liveStatus)
  const count = usePlayhead((s) => s.liveCount)
  const following = usePlayhead((s) => s.following && !!s.selectedIcao)
  const clip = usePlayhead((s) => s.clip)
  const tMs = usePlayhead((s) => s.tMs)
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const setPanel = usePlayhead((s) => s.setPanel)
  const queryClient = useQueryClient()
  const now = useNow(5000)

  const pill = 'pointer-events-auto flex h-9 items-center gap-2 rounded-full px-3.5 text-xs font-bold shadow-lg transition active:scale-95'

  if (mode === 'playback') {
    const label = clip?.kind === 'rewind' && clip.startedAt != null ? agoLabel(now - (clip.startedAt + tMs)) : 'Replay'
    return (
      <span className={`${pill} bg-atc-magenta text-white`} role="status">
        {label}
      </span>
    )
  }
  if (following) {
    return (
      <span className={`${pill} animate-pop bg-atc-card tracking-wider text-white`} role="status">
        TRACK
      </span>
    )
  }
  if (status === 'error') {
    return (
      <button type="button" className={`${pill} bg-[#1b2333]/85 text-white ring-1 ring-white/15 backdrop-blur-xl`} onClick={() => void queryClient.invalidateQueries({ queryKey: ['aircraft', airportIcao] })}>
        <span className="size-2 rounded-full bg-atc-muted" />
        Feed offline. Tap to retry
      </button>
    )
  }
  return (
    <button type="button" className={`${pill} bg-[#1b2333]/75 text-white ring-1 ring-white/15 backdrop-blur-xl hover:bg-[#263043]/85`} onClick={() => setPanel('traffic')} aria-label={`Live. ${count} aircraft. Open traffic list`}>
      <span className="rounded bg-atc-live px-1.5 py-0.5 text-[10px] tracking-wider text-white">
        <span className="mr-1 inline-block size-1.5 animate-pulse-dot rounded-full bg-white align-middle" />
        LIVE
      </span>
      <span className="tabular-nums text-white/75">{status === 'ok' ? `${count} aircraft` : 'Connecting…'}</span>
    </button>
  )
}

export function TopBar() {
  const mode = usePlayhead((s) => s.mode)
  const selected = usePlayhead((s) => !!s.selectedIcao)
  const panel = usePlayhead((s) => s.panel)
  const select = usePlayhead((s) => s.select)
  const setPanel = usePlayhead((s) => s.setPanel)
  const exitPlayback = usePlayhead((s) => s.exitPlayback)

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 pt-[max(0.75rem,var(--safe-top))]">
      <div className="flex items-center gap-2">
        {selected ? (
          <GlassButton label="Clear selection" onClick={() => select(null)} className="animate-pop">
            <X className="size-5" />
          </GlassButton>
        ) : mode === 'playback' ? (
          <button
            type="button"
            className="pointer-events-auto flex h-11 animate-pop items-center gap-1 rounded-full bg-[#1b2333]/75 pl-2 pr-3 text-white shadow-lg ring-1 ring-white/15 backdrop-blur-xl transition hover:bg-[#263043]/85 active:scale-95"
            onClick={exitPlayback}
            aria-label="Back to live traffic"
          >
            <ChevronLeft className="size-5" />
            <span className="rounded bg-atc-live px-1.5 py-0.5 text-[10px] font-bold tracking-wider">LIVE</span>
          </button>
        ) : (
          <GlassButton label="Search traffic" onClick={() => setPanel('traffic')}>
            <Search className="size-5" />
          </GlassButton>
        )}
      </div>

      <StatusPill />

      <div className="flex justify-end">
        <GlassButton label="Menu" onClick={() => setPanel(panel === 'menu' ? null : 'menu')} active={panel === 'menu'}>
          <MoreHorizontal className="size-5" />
        </GlassButton>
      </div>
    </div>
  )
}
