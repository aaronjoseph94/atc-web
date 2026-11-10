/**
 * Chrome along the top of the map: clear/back on the left, the status pill in
 * the middle (LIVE with aircraft count, TRACK while locked onto a flight,
 * REPLAY during playback); search and the menu on the right where no side
 * panel is showing (phones, or the panel tucked away).
 */
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, MoreHorizontal, PanelRightOpen, RotateCw, Search, WifiOff, X } from 'lucide-react'
import { useNow } from '../hooks/useNow'
import { agoLabel } from '../playback/Timeline'
import { usePlayhead } from '../playback/playheadStore'
import { useDock, useDockActive, useIsWide } from '../ui/layout'
import { GlassButton } from '../ui/Panel'

function StatusPill() {
  const mode = usePlayhead((s) => s.mode)
  const status = usePlayhead((s) => s.liveStatus)
  const count = usePlayhead((s) => s.liveCount)
  const following = usePlayhead((s) => s.following && !!s.selectedIcao)
  const clip = usePlayhead((s) => s.clip)
  // Only a rewind shows the replay's time ("3 min ago"), and only to the second; a scene's pill never changes.
  const tMs = usePlayhead((s) => (s.mode === 'playback' && s.clip?.kind === 'rewind' ? Math.floor(s.tMs / 1000) * 1000 : 0))
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const setPanel = usePlayhead((s) => s.setPanel)
  const queryClient = useQueryClient()
  const retrying = useIsFetching({ queryKey: ['aircraft', airportIcao] }) > 0
  const now = useNow(5000)

  const pill = 'pointer-events-auto flex h-9 items-center gap-2 rounded-full px-3.5 text-footnote font-semibold shadow-float'

  if (mode === 'playback') {
    const label = clip?.kind === 'rewind' && clip.startedAt != null ? agoLabel(now - (clip.startedAt + tMs)) : 'Replay'
    return (
      <span className={`${pill} motion-pop bg-atc-magenta text-white tabular-nums`} role="status">
        {label}
      </span>
    )
  }
  if (following) {
    return (
      <span className={`${pill} motion-pop bg-atc-card font-bold tracking-[0.06em] text-white`} role="status">
        TRACK
      </span>
    )
  }
  if (status === 'error') {
    return (
      <button
        type="button"
        className={`${pill} pressable motion-pop glass-chip pl-2 text-white ring-1 ring-white/[0.13] hover:bg-atc-glass-hover/90`}
        onClick={() => void queryClient.invalidateQueries({ queryKey: ['aircraft', airportIcao] })}
        aria-label="Live traffic is offline. Try again"
        disabled={retrying}
      >
        <span className="grid size-5 place-items-center rounded-full bg-white/15">
          <WifiOff className="size-3" strokeWidth={2.5} />
        </span>
        Feed offline
        <span className="flex items-center gap-1 text-white/70">
          <RotateCw className={`size-3.5 ${retrying ? 'animate-spin' : ''}`} />
          {retrying ? 'Retrying' : 'Retry'}
        </span>
      </button>
    )
  }
  return (
    <button type="button" className={`${pill} pressable glass-chip pl-2 text-white ring-1 ring-white/[0.13] hover:bg-atc-glass-hover/90`} onClick={() => setPanel('traffic')} aria-label={`Live. ${count} aircraft. Open traffic list`}>
      <span className="flex h-5 items-center gap-1 rounded-full bg-atc-live-badge pl-1.5 pr-2 text-caption2 font-bold tracking-[0.06em] text-white">
        <span className="size-1.5 animate-pulse-dot rounded-full bg-white" />
        LIVE
      </span>
      <span className="tabular-nums text-white/80">{status === 'ok' ? `${count} aircraft` : 'Connecting…'}</span>
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
  // On wide screens with the side panel tucked away, a button brings it back.
  const wide = useIsWide()
  const collapsed = useDock((s) => s.collapsed)
  const setCollapsed = useDock((s) => s.setCollapsed)
  const docked = useDockActive()

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 pt-[max(0.75rem,var(--safe-top))] md:px-4">
      <div className="flex items-center gap-2">
        {selected ? (
          <GlassButton label="Clear selection" shortcut="Esc" tooltip="right" onClick={() => select(null)} className="motion-pop">
            <X className="size-5" />
          </GlassButton>
        ) : mode === 'playback' ? (
          <button
            type="button"
            className="motion-pop pressable glass-chip pointer-events-auto flex h-11 items-center gap-1 rounded-full pl-2 pr-3 text-white shadow-float ring-1 ring-white/[0.13] hover:bg-atc-glass-hover/90"
            onClick={exitPlayback}
            aria-label="Back to live traffic"
          >
            <ChevronLeft className="size-5" />
            <span className="rounded-full bg-atc-live-badge px-2 py-0.5 text-caption2 font-bold tracking-[0.06em]">LIVE</span>
          </button>
        ) : docked ? null : (
          <GlassButton label="Search traffic" shortcut="/" tooltip="right" onClick={() => setPanel('traffic')}>
            <Search className="size-5" />
          </GlassButton>
        )}
      </div>

      <StatusPill />

      <div className="flex justify-end gap-2">
        {wide && collapsed && (
          <GlassButton label="Show side panel" shortcut="]" onClick={() => setCollapsed(false)} className="motion-pop">
            <PanelRightOpen className="size-5" />
          </GlassButton>
        )}
        {!docked && (
          <GlassButton label="Menu" shortcut="M" tooltip={panel === 'menu' ? 'none' : 'left'} onClick={() => setPanel(panel === 'menu' ? null : 'menu')} active={panel === 'menu'}>
            <MoreHorizontal className="size-5" />
          </GlassButton>
        )}
      </div>
    </div>
  )
}
