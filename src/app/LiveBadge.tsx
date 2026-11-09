/**
 * Centre pill in the top chrome: LIVE (with aircraft count / feed state) or
 * PLAYBACK. Doubles as a quick health indicator for the data feed.
 */
import { usePlayhead } from '../playback/playheadStore'

export function LiveBadge() {
  const mode = usePlayhead((s) => s.mode)
  const status = usePlayhead((s) => s.liveStatus)
  const count = usePlayhead((s) => s.liveCount)

  if (mode === 'playback') {
    return (
      <span className="pointer-events-auto rounded-full bg-atc-purple px-3 py-1.5 text-[11px] font-bold tracking-wider text-white shadow">
        PLAYBACK
      </span>
    )
  }

  const detail =
    status === 'ok'
      ? `${count} aircraft`
      : status === 'error'
        ? 'feed offline'
        : 'connecting…'

  return (
    <span className="pointer-events-auto flex items-center gap-2 rounded-full bg-black/55 py-1.5 pl-2.5 pr-3 text-[11px] font-semibold shadow backdrop-blur-md">
      <span
        className={`size-2 rounded-full ${
          status === 'error' ? 'bg-atc-muted' : 'animate-pulse-dot bg-atc-live shadow-[0_0_8px_#ef4444]'
        }`}
      />
      <span className="font-bold tracking-wider text-white">LIVE</span>
      <span className="text-white/60">{detail}</span>
    </span>
  )
}
