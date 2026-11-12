/**
 * The side panel's tabs: Now, Radio, Traffic, Weather, on one segmented bar
 * with a pill that glides to the chosen one. Each carries what is worth
 * knowing before opening it: a dot on Now when something was flagged, how
 * many calls came in on Radio since it was last open, how many aircraft are
 * in view, and the airport's flight category colour on Weather.
 *
 * A proper tab list: arrow keys move along it, only the chosen tab is in the
 * tab order, and each tab names the panel it controls.
 */
import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { CATEGORY_COLOR } from '../../station/StationBar'
import { CountDot } from '../../ui/kit'
import { DOCK_TABS, type DockTab } from '../../ui/layout'
import { TAB_ICON, TAB_KEY, TAB_LABEL, tabBadge, tabId, tabPanelId, useTabSignals, type TabBadge } from './tabs'

/** A tab's badge, drawn: a dot, a count of what is new, a plain count, or the weather category's colour. */
export function TabBadgeMark({ badge }: { badge: TabBadge | null }) {
  if (!badge) return null
  if (badge.kind === 'dot') return <CountDot attention />
  if (badge.kind === 'unread') return <CountDot attention>{badge.text}</CountDot>
  if (badge.kind === 'count') return <span aria-hidden className="text-caption2 font-medium tabular-nums text-white/50">{badge.text}</span>
  return <span aria-hidden className="size-2 shrink-0 rounded-full ring-1 ring-black/30" style={{ background: CATEGORY_COLOR[badge.category] }} />
}

export function PanelTabs({ tab, onPick }: { tab: DockTab; onPick: (t: DockTab) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null)
  const signals = useTabSignals()

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const btn = el.querySelector<HTMLElement>(`[data-view="${tab}"]`)
      if (btn) setPill((p) => (p && p.x === btn.offsetLeft && p.w === btn.offsetWidth ? p : { x: btn.offsetLeft, w: btn.offsetWidth }))
    }
    measure()
    // Tabs change width as counts and fonts arrive, so watch them as well as the strip.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    el.querySelectorAll('[role="tab"]').forEach((t) => ro.observe(t))
    return () => ro.disconnect()
  }, [tab])

  // Arrow keys move along the tabs, Home and End jump to the ends, as a tab list should.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const i = DOCK_TABS.indexOf(tab)
    const n = DOCK_TABS.length
    const next = e.key === 'ArrowRight' ? DOCK_TABS[(i + 1) % n] : e.key === 'ArrowLeft' ? DOCK_TABS[(i - 1 + n) % n] : e.key === 'Home' ? DOCK_TABS[0] : e.key === 'End' ? DOCK_TABS[n - 1] : null
    if (!next) return
    e.preventDefault()
    e.stopPropagation()
    onPick(next)
    box.current?.querySelector<HTMLElement>(`[data-view="${next}"]`)?.focus()
  }

  return (
    <div className="@container shrink-0 px-3">
      <div ref={box} role="tablist" aria-label="Side panel" className="relative flex rounded-full bg-white/[0.06] p-1 ring-1 ring-inset ring-white/[0.04]" onKeyDown={onKeyDown}>
        {pill && (
          <span
            aria-hidden
            className="absolute inset-y-1 left-0 rounded-full bg-white/[0.14] shadow-[0_1px_6px_rgba(0,0,0,0.35),inset_0_0_0_1px_rgb(255_255_255/0.06)] transition-[translate,width] duration-[var(--duration-base)] ease-[var(--ease-out)]"
            style={{ translate: `${pill.x}px 0`, width: pill.w }}
          />
        )}
        {DOCK_TABS.map((t) => {
          const active = t === tab
          const Icon = TAB_ICON[t]
          const badge = tabBadge(t, active, signals)
          // The Radio tab's icon takes the speaker's colour while somebody is on the air.
          const onAir = t === 'transcripts' && signals.air.speaking
          return (
            <button
              key={t}
              type="button"
              role="tab"
              id={tabId(t)}
              data-view={t}
              aria-selected={active}
              aria-controls={tabPanelId(t)}
              aria-keyshortcuts={TAB_KEY[t]}
              aria-label={`${TAB_LABEL[t]}${badge?.said ?? ''}`}
              tabIndex={active ? 0 : -1}
              className={`relative flex h-8 flex-auto items-center justify-center gap-1 whitespace-nowrap rounded-full px-1.5 text-footnote font-semibold transition-colors duration-[var(--duration-fast)] ${active ? 'text-white' : 'text-white/60 hover:text-white/90'}`}
              onClick={() => onPick(t)}
            >
              <Icon aria-hidden className="mr-px hidden size-[15px] shrink-0 transition-colors duration-[var(--duration-base)] @[23rem]:block" style={onAir ? { color: signals.air.colors.light } : undefined} strokeWidth={2.25} />
              <span>{TAB_LABEL[t]}</span>
              <TabBadgeMark badge={badge} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
