/**
 * The side panel docked on the right on wide screens (≥ 1024 px): the app's
 * control room.
 *
 * Top to bottom: one row with the four tabs (Now, Radio, Traffic, Weather),
 * the menu and the hide button; then the chosen tab. The airport, channel,
 * weather and play/pause are not repeated here: the yellow station bar under
 * the map has them. Selecting a flight slides its page in under the tab row;
 * "back" (or any tab) returns to the tabs with the flight still selected,
 * folded into a purple strip above them.
 *
 * The same components the phone shows as sheets render here in their
 * `docked` mode. The panel can be dragged wider or narrower by its left
 * edge, and tucked away (`]`, or the button in its top row) to a slim rail
 * that keeps the tab badges in view.
 *
 * Requests to open those panels (keyboard shortcuts, the menu, the status
 * pill, the weather chip) are routed here instead of opening a modal, and
 * the space the panel (or its rail) takes is published as `--dock-w` so the
 * map chrome and the camera keep clear of it.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { FlightDetail } from '../flight/FlightDetail'
import { usePlayhead } from '../playback/playheadStore'
import { WeatherPanel } from '../weather/WeatherPanel'
import { clampDockWidth, DOCK_DEFAULT, DOCK_EVENT, DOCK_TABS, dockActiveNow, dockReserve, useDock, type DockTab } from '../ui/layout'
import { usePresence } from '../ui/usePresence'
import { FlightChip } from './panel/FlightChip'
import { NowTab } from './panel/NowTab'
import { PanelHeader } from './panel/PanelHeader'
import { PanelRail } from './panel/PanelRail'
import { usePanel } from './panel/panelStore'
import { TAB_LABEL, tabId, tabPanelId } from './panel/tabs'
import { TrafficPanel } from './TrafficPanel'
import { TranscriptsView } from './TranscriptsView'

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
 * Keeps the outgoing tab mounted for its exit while the new one comes in,
 * so tabs cross-fade instead of cutting.
 */
function useSwap(tab: DockTab) {
  const [state, setState] = useState<{ current: DockTab; leaving: DockTab | null; dir: number }>({ current: tab, leaving: null, dir: 1 })
  if (state.current !== tab) setState({ current: tab, leaving: state.current, dir: DOCK_TABS.indexOf(tab) >= DOCK_TABS.indexOf(state.current) ? 1 : -1 })
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
  const vw = useViewportWidth()
  const w = clampDockWidth(width, vw)
  const aside = useRef<HTMLElement>(null)

  // A new selection brings the flight's page in; going back to the tabs keeps the selection (and the camera on it).
  const [showFlight, setShowFlight] = useState(!!selected)
  const [lastSelected, setLastSelected] = useState(selected)
  if (selected !== lastSelected) {
    setLastSelected(selected)
    if (selected) setShowFlight(true)
  }
  const flightShown = !!selected && showFlight
  const swap = useSwap(tab)
  const body = usePresence(!collapsed, 260)
  const flightLayer = usePresence(flightShown && !collapsed, 240)
  // The tabs rest (unmounted) once the flight's page has covered them, so nothing ticks underneath.
  const tabsBody = usePresence(!flightShown, 320)

  // Publish the space the panel takes; the map re-frames once a resize is let go, not on every pixel.
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--dock-w', `${dockReserve(!collapsed, w, vw)}px`)
    document.documentElement.classList.toggle('dock-resizing', resizing)
    document.documentElement.classList.toggle('dock-rail-on', collapsed)
    if (!resizing) window.dispatchEvent(new Event(DOCK_EVENT))
  }, [collapsed, w, vw, resizing])
  useEffect(
    () => () => {
      document.documentElement.style.setProperty('--dock-w', '0px')
      document.documentElement.classList.remove('dock-resizing', 'dock-rail-on')
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

  // What counts as "seen": calls while the Radio tab is showing, alerts while Now is. Marked on the way in and on the way out.
  const radioShowing = !collapsed && !flightShown && tab === 'transcripts'
  const nowShowing = !collapsed && !flightShown && tab === 'now'
  useEffect(() => {
    if (!radioShowing) return
    usePanel.getState().markRadioSeen()
    return () => usePanel.getState().markRadioSeen()
  }, [radioShowing])
  useEffect(() => {
    if (!nowShowing) return
    usePanel.getState().markAlertsSeen()
    return () => usePanel.getState().markAlertsSeen()
  }, [nowShowing])

  // Stable, so the memoised panes below don't re-render with the panel (while it is dragged wider, say).
  const pick = useCallback(
    (t: DockTab) => {
      setTab(t)
      setShowFlight(false)
    },
    [setTab],
  )
  const back = useCallback(() => setShowFlight(false), [])
  const open = (t?: DockTab) => {
    if (t) pick(t)
    setCollapsed(false)
  }

  return (
    <>
      <aside
        ref={aside}
        aria-label="Side panel"
        data-collapsed={collapsed ? '' : undefined}
        inert={collapsed}
        style={{ width: w }}
        className="dock glass-sheet grain absolute bottom-3 right-3 top-[max(0.75rem,var(--safe-top))] z-30 flex flex-col overflow-hidden rounded-[1.6rem] shadow-pop ring-1 ring-white/[0.09]"
      >
        <ResizeHandle width={w} vw={vw} />
        <PanelHeader tab={tab} flightShown={flightShown} onPick={pick} onCollapse={() => setCollapsed(true)} />
        <div className="relative min-h-0 flex-1">
          {body.mounted && tabsBody.mounted && (
            <div className="dock-tabs flex h-full flex-col" data-under={flightShown ? '' : undefined} inert={flightShown}>
              {selected && !flightShown && <FlightChip onOpen={() => setShowFlight(true)} />}
              <div className="relative grid min-h-0 flex-1" style={{ ['--pane-dir' as string]: swap.dir }}>
                {[swap.current, swap.leaving].map((v) =>
                  v ? (
                    <div key={v} role="tabpanel" id={tabPanelId(v)} aria-labelledby={tabId(v)} className="dock-pane min-h-0 min-w-0 [grid-area:1/1]" data-closing={v === swap.leaving ? '' : undefined} inert={v === swap.leaving}>
                      <Pane view={v} onPick={pick} />
                    </div>
                  ) : null,
                )}
              </div>
            </div>
          )}
          {body.mounted && flightLayer.mounted && (
            <div className="dock-layer absolute inset-0" data-closing={flightLayer.closing ? '' : undefined} inert={flightLayer.closing}>
              <FlightDetail docked onBack={back} backLabel={TAB_LABEL[tab]} />
            </div>
          )}
        </div>
      </aside>
      <PanelRail shown={collapsed} onOpen={open} />
    </>
  )
}

/** One tab's content. Memoised so dragging the panel wider doesn't re-render a long list on every pixel. */
const Pane = memo(function Pane({ view, onPick }: { view: DockTab; onPick: (t: DockTab) => void }) {
  if (view === 'now') return <NowTab go={onPick} />
  if (view === 'transcripts') return <TranscriptsView docked />
  if (view === 'traffic') return <TrafficPanel docked />
  return <WeatherPanel docked />
})

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
