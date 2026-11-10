/**
 * Smart alerts on screen: at most two small cards under the top bar, each
 * with what happened, the AI's one-line reason when it has one (sparkled),
 * a button to look at the aircraft, and a close button. They go away on
 * their own; emergencies stay longer.
 */
import { ArrowLeftRight, OctagonX, RotateCcw, Siren, Split, X, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { liveBuffer } from '../live/session'
import { usePlayhead } from '../playback/playheadStore'
import { usePresence } from '../ui/usePresence'
import { AiMark } from './AiMark'
import type { Alert } from './alerts'
import type { AlertKind } from './insightSettings'
import { useInsights } from './insightsStore'

const STYLE: Record<AlertKind, { icon: LucideIcon; color: string }> = {
  emergency: { icon: Siren, color: '#FF3B30' },
  goaround: { icon: RotateCcw, color: '#FF9F0A' },
  rto: { icon: OctagonX, color: '#FF6B4A' },
  runway: { icon: ArrowLeftRight, color: '#64D2FF' },
  diversion: { icon: Split, color: '#BF5AF2' },
}

export function AlertStack() {
  const showing = useInsights((s) => s.showing)
  const alerts = useInsights((s) => s.alerts)
  const list = showing.map((id) => alerts.find((a) => a.id === id)).filter((a): a is Alert => !!a)
  if (!list.length) return null
  return (
    <div role="region" aria-label="Alerts" className="pointer-events-none absolute inset-x-0 top-[calc(max(0.75rem,var(--safe-top))+3.6rem)] z-[61] flex flex-col items-center gap-2 px-3">
      {list.map((a) => (
        <AlertCard key={a.id} alert={a} />
      ))}
    </div>
  )
}

function AlertCard({ alert }: { alert: Alert }) {
  const why = useInsights((s) => s.why[alert.id])
  const hide = useInsights((s) => s.hide)
  const [leaving, setLeaving] = useState(false)
  const { mounted, closing } = usePresence(!leaving, 200)
  const s = STYLE[alert.kind]
  const Icon = s.icon
  const canShow = !!alert.icao24 && !!liveBuffer.get(alert.icao24)

  // Away on their own; an emergency (or one that just got its reason) stays a little longer.
  useEffect(() => {
    const id = window.setTimeout(() => setLeaving(true), alert.kind === 'emergency' ? 20_000 : why ? 12_000 : 15_000)
    return () => window.clearTimeout(id)
  }, [alert.kind, why])
  useEffect(() => {
    if (!mounted) hide(alert.id)
  }, [mounted, hide, alert.id])
  if (!mounted) return null

  return (
    <div
      role={alert.kind === 'emergency' ? 'alert' : 'status'}
      data-closing={closing ? '' : undefined}
      className="motion-pop glass-pop pointer-events-auto flex w-full max-w-[26rem] origin-top items-start gap-3 rounded-2xl py-2.5 pl-3 pr-2 text-white shadow-pop ring-1 ring-white/[0.12]"
    >
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full" style={{ color: alert.kind === 'emergency' ? '#fff' : s.color, background: alert.kind === 'emergency' ? s.color : `color-mix(in srgb, ${s.color} 22%, transparent)` }} aria-hidden>
        <Icon className="size-[18px]" strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-subhead font-semibold">
          {alert.title}
          {alert.count > 1 && <span className="ml-1.5 text-caption font-medium text-white/50">×{alert.count}</span>}
        </p>
        <p className="mt-0.5 line-clamp-2 text-footnote text-white/70">{alert.body}</p>
        {why && (
          <p className="mt-1 flex items-start gap-1 text-footnote text-[#DCD3FF]">
            <AiMark className="mt-[3px]" />
            <span className="min-w-0">{why}</span>
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <button type="button" aria-label="Dismiss alert" className="pressable grid size-7 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white" onClick={() => setLeaving(true)}>
          <X className="size-4" />
        </button>
        {canShow && (
          <button
            type="button"
            className="pressable rounded-full bg-white px-2.5 py-1 text-caption font-semibold text-black"
            onClick={() => {
              usePlayhead.getState().select(alert.icao24)
              setLeaving(true)
            }}
          >
            Show
          </button>
        )}
      </div>
    </div>
  )
}
