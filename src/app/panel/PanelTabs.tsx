/**
 * The side panel's tabs: Now, Radio, Traffic, Weather, on one segmented bar
 * with a pill that glides to the chosen one. Plain words, no icons (the rail
 * carries the icons when the panel is tucked away). A tab says what is worth
 * knowing before opening it: a dot on Now when something was flagged, how
 * many calls came in on Radio since it was last open (and the speaker's
 * light while somebody is talking), how many aircraft are in view.
 *
 * While a flight's page covers the tabs' content no tab reads as chosen, and
 * picking any of them goes back to it.
 *
 * A proper tab list: arrow keys move along it, only the chosen tab is in the
 * tab order, and each tab names the panel it controls.
 */
import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { CountDot, Lamp } from '../../ui/kit'
import { DOCK_TABS, type DockTab } from '../../ui/layout'
import { Ticker } from '../../ui/Ticker'
import { TAB_KEY, TAB_LABEL, tabBadge, tabId, tabPanelId, useTabSignals, type TabBadge } from './tabs'

/**
 * A tab's badge, drawn: a dot, a count of what is new, or a plain count.
 * The dot and the count of what's new pop in when there is news; counts
 * change only the digits that moved.
 */
export function TabBadgeMark({ badge }: { badge: TabBadge | null }) {
  if (!badge) return null
  if (badge.kind === 'dot') return <CountDot attention className="badge-pop" />
  const count = <Ticker variant="digits" value={Number.parseInt(badge.text, 10) || 0} format={() => badge.text} />
  if (badge.kind === 'unread') return <CountDot attention className="badge-pop">{count}</CountDot>
  return <span aria-hidden className="text-caption2 font-medium tabular-nums text-white/45">{count}</span>
}

export function PanelTabs({ tab, flightShown = false, onPick }: { tab: DockTab; flightShown?: boolean; onPick: (t: DockTab) => void }) {
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
    <div ref={box} role="tablist" aria-label="Side panel" className="relative flex min-w-0 flex-1 rounded-full bg-white/[0.06] p-[3px]" onKeyDown={onKeyDown}>
      {pill && (
        <span
          aria-hidden
          className={`absolute inset-y-[3px] left-0 rounded-full bg-white/[0.13] shadow-[0_1px_4px_rgb(0_0_0/0.3)] transition-[translate,width,opacity] duration-[var(--duration-base)] ease-[var(--ease-out)] ${flightShown ? 'opacity-0' : ''}`}
          style={{ translate: `${pill.x}px 0`, width: pill.w }}
        />
      )}
      {DOCK_TABS.map((t) => {
        const active = t === tab && !flightShown
        const badge = tabBadge(t, active, signals)
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
            tabIndex={t === tab ? 0 : -1}
            className={`relative flex h-[30px] min-w-0 flex-auto items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2 text-footnote font-semibold transition-colors duration-[var(--duration-fast)] ${active ? 'text-white' : 'text-white/55 hover:text-white/90'}`}
            onClick={() => onPick(t)}
          >
            <span>{TAB_LABEL[t]}</span>
            {onAir && <Lamp state="speaking" color={signals.air.colors.base} />}
            <TabBadgeMark badge={badge} />
          </button>
        )
      })}
    </div>
  )
}
