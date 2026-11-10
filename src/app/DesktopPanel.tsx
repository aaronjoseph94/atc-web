/**
 * The side panel docked on the right on wide screens (≥ 1024 px).
 *
 * It shows the selected flight when there is one, otherwise one of three
 * tabs: Transcript, Traffic, Weather. The same components the phone shows
 * as sheets render here in their `docked` mode. It can be dragged wider or
 * narrower by its left edge, and tucked away (`]`, or the button in its
 * header); a button in the top bar brings it back.
 *
 * Requests to open those three panels (keyboard shortcuts, the menu, the
 * status pill, the weather chip) are routed here instead of opening a modal,
 * and the space it takes is published as `--dock-w` so the map chrome and
 * the camera keep clear of it.
 */
import { MoreHorizontal, PanelRightClose, Search, X } from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { AirlineLogo } from '../airline/AirlineLogo'
import { getAirport } from '../api/airports'
import { FlightDetail } from '../flight/FlightSheet'
import { BriefingCard } from '../insights/Briefing'
import { useFlight } from '../flight/useFlight'
import { usePlayhead } from '../playback/playheadStore'
import { WeatherPanel } from '../weather/WeatherPanel'
import { clampDockWidth, DOCK_DEFAULT, DOCK_EVENT, DOCK_TABS, dockActiveNow, dockReserve, useDock, type DockTab } from '../ui/layout'
import { Tooltip } from '../ui/Panel'
import { usePresence } from '../ui/usePresence'
import { TrafficPanel } from './TrafficPanel'
import { TranscriptsView } from './TranscriptsView'

type View = 'flight' | DockTab

const VIEWS: View[] = ['flight', ...DOCK_TABS]
const LABEL: Record<DockTab, string> = { transcripts: 'Transcript', traffic: 'Traffic', weather: 'Weather' }
const KEY: Record<DockTab, string> = { transcripts: 'T', traffic: '/', weather: 'W' }

const isTab = (p: unknown): p is DockTab => DOCK_TABS.includes(p as DockTab)

function useViewportWidth() {
  const [w, setW] = useState(() => window.innerWidth)
  useEffect(() => {
    const on = () => setW(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return w
}

/**
 * Keeps the outgoing view mounted for its exit while the new one comes in,
 * so tabs cross-fade instead of cutting.
 */
function useSwap(view: View) {
  const [state, setState] = useState<{ current: View; leaving: View | null; dir: number }>({ current: view, leaving: null, dir: 1 })
  if (state.current !== view) setState({ current: view, leaving: state.current, dir: VIEWS.indexOf(view) >= VIEWS.indexOf(state.current) ? 1 : -1 })
  useEffect(() => {
    if (!state.leaving) return
    const id = window.setTimeout(() => setState((s) => ({ ...s, leaving: null })), 200)
    return () => window.clearTimeout(id)
  }, [state.leaving])
  return state
}

export function DesktopPanel() {
  const width = useDock((s) => s.width)
  const collapsed = useDock((s) => s.collapsed)
  const tab = useDock((s) => s.tab)
  const resizing = useDock((s) => s.resizing)
  const setTab = useDock((s) => s.setTab)
  const setCollapsed = useDock((s) => s.setCollapsed)
  const selected = usePlayhead((s) => s.selectedIcao)
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const panel = usePlayhead((s) => s.panel)
  const setPanel = usePlayhead((s) => s.setPanel)
  const vw = useViewportWidth()
  const w = clampDockWidth(width, vw)
  const aside = useRef<HTMLElement>(null)
  // The search box is the panel's: typing shows the traffic list filtered by it.
  const [search, setSearch] = useState('')

  // A new selection takes the panel; picking a tab while one is selected keeps the selection (and the camera on it).
  const [showFlight, setShowFlight] = useState(!!selected)
  const [lastSelected, setLastSelected] = useState(selected)
  if (selected !== lastSelected) {
    setLastSelected(selected)
    if (selected) {
      setShowFlight(true)
      // Picked from the search results: the flight takes the panel, the search is done.
      setSearch('')
    }
  }
  const view: View = search ? 'traffic' : selected && showFlight ? 'flight' : tab
  const swap = useSwap(view)
  const body = usePresence(!collapsed, 260)

  // Publish the space the panel takes; the map re-frames once a resize is let go, not on every pixel.
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--dock-w', `${dockReserve(!collapsed, w, vw)}px`)
    document.documentElement.classList.toggle('dock-resizing', resizing)
    if (!resizing) window.dispatchEvent(new Event(DOCK_EVENT))
  }, [collapsed, w, vw, resizing])
  useEffect(
    () => () => {
      document.documentElement.style.setProperty('--dock-w', '0px')
      document.documentElement.classList.remove('dock-resizing')
      window.dispatchEvent(new Event(DOCK_EVENT))
    },
    [],
  )

  // Panel requests from anywhere (shortcuts, menu, status pill) land in the side panel.
  useEffect(() => {
    const route = (s: ReturnType<typeof usePlayhead.getState>, prevPanel: unknown) => {
      if (isTab(s.panel) && s.panel !== prevPanel) {
        const want = s.panel
        const dock = useDock.getState()
        dock.setTab(want)
        dock.setCollapsed(false)
        setShowFlight(false)
        s.setPanel(null)
        // "/" means search: put the cursor in the box.
        if (want === 'traffic') window.setTimeout(() => aside.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus({ preventScroll: true }), 60)
      }
      // The full flight view is the side panel here; keep the sheet state at "card" so keys and Escape behave.
      if (s.sheet === 'full' && dockActiveNow()) {
        s.setSheet('card')
        setShowFlight(true)
      }
    }
    route(usePlayhead.getState(), null)
    return usePlayhead.subscribe((s, prev) => route(s, prev.panel))
  }, [])

  // "]" tucks the panel away or brings it back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape in the panel's search box hands the keyboard back to the map (so shortcuts work again).
      if (e.key === 'Escape' && e.target instanceof HTMLInputElement && aside.current?.contains(e.target)) {
        e.target.blur()
        return
      }
      if (e.key !== ']' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      if (usePlayhead.getState().panel) return
      e.preventDefault()
      const dock = useDock.getState()
      dock.setCollapsed(!dock.collapsed)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pick = (v: View) => {
    setSearch('')
    if (v === 'flight') setShowFlight(true)
    else {
      setTab(v)
      setShowFlight(false)
    }
  }

  const iconBtn = 'has-tooltip pressable relative grid size-9 shrink-0 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white'

  return (
    <aside
      ref={aside}
      aria-label="Side panel"
      data-collapsed={collapsed ? '' : undefined}
      inert={collapsed}
      style={{ width: w }}
      className="dock glass-sheet grain absolute bottom-3 right-3 top-[max(0.75rem,var(--safe-top))] z-30 flex flex-col overflow-hidden rounded-[1.6rem] shadow-pop ring-1 ring-white/[0.09]"
    >
      <ResizeHandle width={w} vw={vw} />
      {/* Header: airport, search, menu, hide. */}
      <div className="flex shrink-0 items-center gap-1.5 px-3 pb-2 pt-3">
        <button
          type="button"
          className="display-tight pressable shrink-0 rounded-lg px-1.5 font-display text-[26px] leading-none hover:bg-white/10"
          onClick={() => setPanel('airports')}
          aria-label={`Side panel airport ${airportIcao}. Change airport`}
          aria-keyshortcuts="A"
        >
          {airportIcao}
        </button>
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full bg-white/[0.07] px-3 ring-1 ring-inset ring-transparent transition-shadow duration-[var(--duration-fast)] focus-within:ring-atc-yellow/70">
          <Search className="size-4 shrink-0 text-white/50" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search traffic"
            aria-label="Search traffic"
            aria-keyshortcuts="/"
            className="h-9 min-w-0 flex-1 bg-transparent text-footnote outline-none placeholder:text-white/45 [&::-webkit-search-cancel-button]:hidden"
          />
          {search && (
            <button type="button" aria-label="Clear search" className="pressable grid size-5 place-items-center rounded-full bg-white/15 text-white/80" onClick={() => setSearch('')}>
              <X className="size-3" strokeWidth={2.5} />
            </button>
          )}
        </label>
        <button
          type="button"
          aria-label="Menu"
          aria-keyshortcuts="M"
          aria-pressed={panel === 'menu' || undefined}
          className={`${iconBtn} ${panel === 'menu' ? 'bg-atc-yellow text-black hover:bg-atc-yellow hover:text-black' : ''}`}
          onClick={() => setPanel(panel === 'menu' ? null : 'menu')}
        >
          <MoreHorizontal className="size-[18px]" />
          {panel !== 'menu' && <Tooltip label="Menu" shortcut="M" side="bottom" />}
        </button>
        <button type="button" aria-label="Hide side panel" aria-keyshortcuts="]" className={iconBtn} onClick={() => setCollapsed(true)}>
          <PanelRightClose className="size-[18px]" />
          <Tooltip label="Hide panel" shortcut="]" side="left" />
        </button>
      </div>
      <div className="flex shrink-0 items-center px-3 pb-2">
        <Tabs view={view} selected={!!selected} onPick={pick} />
      </div>
      <BriefingCard docked />
      <div className="mx-3 h-px shrink-0 bg-white/[0.08]" />
      <div className="relative grid min-h-0 flex-1" style={{ ['--pane-dir' as string]: swap.dir }}>
        {body.mounted &&
          [swap.current, swap.leaving].map((v) =>
            v ? (
              <div key={v} className="dock-pane min-h-0 min-w-0 [grid-area:1/1]" data-closing={v === swap.leaving ? '' : undefined} inert={v === swap.leaving}>
                <Pane view={v} search={search} />
              </div>
            ) : null,
          )}
      </div>
    </aside>
  )
}

/** One view's content. Memoised so dragging the panel wider doesn't re-render a long list on every pixel. */
const Pane = memo(function Pane({ view, search }: { view: View; search: string }) {
  if (view === 'flight') return <FlightDetail docked />
  if (view === 'transcripts') return <TranscriptsView docked />
  if (view === 'traffic') return <TrafficPanel docked search={search} />
  return <WeatherPanel docked />
})

/** The tab strip: the selected flight (when there is one), then the three tabs, with a pill gliding between them. */
function Tabs({ view, selected, onPick }: { view: View; selected: boolean; onPick: (v: View) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null)
  const items: View[] = selected ? VIEWS : DOCK_TABS

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const btn = el.querySelectorAll<HTMLElement>('[role="tab"]')[items.indexOf(view)]
      if (btn) setPill((p) => (p && p.x === btn.offsetLeft && p.w === btn.offsetWidth ? p : { x: btn.offsetLeft, w: btn.offsetWidth }))
    }
    measure()
    // Tabs change width as logos and fonts load, so watch them as well as the strip.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    el.querySelectorAll('[role="tab"]').forEach((tab) => ro.observe(tab))
    return () => ro.disconnect()
  }, [view, items])

  // Arrow keys move along the tabs, as a tab list should.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    e.stopPropagation()
    const i = items.indexOf(view)
    const next = items[(i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length]
    onPick(next)
    box.current?.querySelector<HTMLElement>(`[data-view="${next}"]`)?.focus()
  }

  return (
    <div ref={box} role="tablist" aria-label="Side panel" className="relative flex min-w-0 flex-1 rounded-full bg-white/[0.07] p-1" onKeyDown={onKeyDown}>
      {pill && (
        <span
          aria-hidden
          className={`absolute inset-y-1 left-0 rounded-full shadow-[0_1px_6px_rgba(0,0,0,0.35)] transition-[translate,width,background-color] duration-[var(--duration-base)] ease-[var(--ease-out)] ${view === 'flight' ? 'bg-atc-card' : 'bg-white/[0.16]'}`}
          style={{ translate: `${pill.x}px 0`, width: pill.w }}
        />
      )}
      {items.map((v) => (
        <TabButton key={v} view={v} active={v === view} onPick={onPick}>
          {v === 'flight' ? <FlightTabLabel /> : LABEL[v]}
        </TabButton>
      ))}
    </div>
  )
}

function TabButton({ view, active, onPick, children }: { view: View; active: boolean; onPick: (v: View) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      data-view={view}
      aria-selected={active}
      aria-keyshortcuts={view === 'flight' ? undefined : KEY[view]}
      tabIndex={active ? 0 : -1}
      className={`relative flex h-8 items-center justify-center gap-1.5 rounded-full px-2.5 text-footnote ${view === 'flight' ? 'max-w-[42%] shrink-0 pl-2 pr-3' : 'min-w-0 flex-1'} font-semibold transition-colors duration-[var(--duration-fast)] ${active ? 'text-white' : 'text-white/60 hover:text-white/90'}`}
      onClick={() => onPick(view)}
    >
      {children}
    </button>
  )
}

/** The selected flight's tab: its airline's mark and callsign. */
function FlightTabLabel() {
  const flight = useFlight()
  if (!flight) return <span className="truncate">Flight</span>
  return (
    <>
      <AirlineLogo callsign={flight.callsign} icao24={flight.icao24} height={13} maxWidth={20} className="shrink-0" />
      <span className="display-tight truncate font-display text-[15px] leading-none tracking-normal">{flight.callsign}</span>
    </>
  )
}

/** Drag the panel's left edge to resize it; double-click to reset. Also a keyboard-operable separator. */
function ResizeHandle({ width, vw }: { width: number; vw: number }) {
  const setWidth = useDock((s) => s.setWidth)
  const setResizing = useDock((s) => s.setResizing)
  const start = useRef<{ x: number; w: number } | null>(null)

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    start.current = { x: e.clientX, w: width }
    e.currentTarget.setPointerCapture(e.pointerId)
    setResizing(true)
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!start.current) return
    // Dragging left makes the panel wider.
    setWidth(clampDockWidth(start.current.w + (start.current.x - e.clientX), vw))
  }
  const end = () => {
    if (!start.current) return
    start.current = null
    setResizing(false)
  }
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const step = e.shiftKey ? 48 : 16
    if (e.key === 'ArrowLeft') setWidth(clampDockWidth(width + step, vw))
    else if (e.key === 'ArrowRight') setWidth(clampDockWidth(width - step, vw))
    else if (e.key === 'Home') setWidth(clampDockWidth(DOCK_DEFAULT, vw))
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize side panel"
      aria-valuenow={width}
      aria-valuemin={clampDockWidth(0, vw)}
      aria-valuemax={clampDockWidth(Infinity, vw)}
      tabIndex={0}
      className="group absolute inset-y-0 left-0 z-10 w-2.5 cursor-col-resize touch-none outline-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => setWidth(DOCK_DEFAULT)}
      onKeyDown={onKeyDown}
    >
      <span className="absolute left-1 top-1/2 h-12 w-[3px] -translate-y-1/2 rounded-full bg-white/0 transition-colors duration-[var(--duration-fast)] group-hover:bg-white/35 group-focus-visible:bg-white/60 group-active:bg-atc-yellow" />
    </div>
  )
}
