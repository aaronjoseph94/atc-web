/**
 * One look for tower-log events (takeoffs, landings, go-arounds…) wherever
 * they appear: a tinted circle with the icon drawn in the event's colour.
 * Colours come from `eventStyle`; emergencies stay a solid red disc, as they should shout.
 */
import { eventStyle } from './eventStyle'

/** The round badge; `size` in px (the icon is a little over half of it). */
export function EventBadge({ kind, size = 28, className = '' }: { kind: string | null | undefined; size?: number; className?: string }) {
  const s = eventStyle(kind)
  const Icon = s.icon
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        color: s.solid ? '#fff' : s.color,
        // A soft wash of the colour with a slightly stronger rim keeps it readable on any panel tone.
        background: s.solid ? s.color : `color-mix(in srgb, ${s.color} 22%, transparent)`,
        boxShadow: s.solid ? undefined : `inset 0 0 0 1px color-mix(in srgb, ${s.color} 38%, transparent)`,
      }}
    >
      <Icon style={{ width: Math.round(size * 0.57), height: Math.round(size * 0.57) }} strokeWidth={2.25} />
    </span>
  )
}
