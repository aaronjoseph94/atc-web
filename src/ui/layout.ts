/**
 * Desktop layout: on wide screens (≥ 1024 px) a side panel is docked on the
 * right, hosting the selected flight or the Transcript / Traffic / Weather
 * tabs. Phones and tablets keep the floating sheets.
 *
 * Width, collapsed state and last tab are a per-viewer convenience, kept in
 * localStorage (and fine to lose).
 */
import { useSyncExternalStore } from 'react'
import { create } from 'zustand'

export type DockTab = 'transcripts' | 'traffic' | 'weather'
export const DOCK_TABS: DockTab[] = ['transcripts', 'traffic', 'weather']

/** Viewport width from which the side panel docks. */
export const DOCK_BREAKPOINT = 1024
export const DOCK_MIN = 360
export const DOCK_MAX = 480
export const DOCK_DEFAULT = 400
/** Gap between the panel and the window edge. */
export const DOCK_INSET = 12
/** The map keeps at least this much width beside the panel. */
const MAP_MIN = 600

/** Panel width allowed for this viewport: within [min, max], leaving the map room to breathe. */
export function clampDockWidth(want: number, viewport: number): number {
  const roomy = Math.min(DOCK_MAX, viewport - MAP_MIN - DOCK_INSET * 2)
  return Math.round(Math.max(DOCK_MIN, Math.min(roomy, want)))
}

/** Space the panel takes from the right of the map area (0 while hidden). */
export function dockReserve(active: boolean, width: number, viewport: number): number {
  return active ? clampDockWidth(width, viewport) + DOCK_INSET : 0
}

const KEY = 'atc.dock'

type Saved = { width: number; collapsed: boolean; tab: DockTab }

function load(): Saved {
  const fallback: Saved = { width: DOCK_DEFAULT, collapsed: false, tab: 'transcripts' }
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null
    if (!raw) return fallback
    return {
      width: typeof raw.width === 'number' && Number.isFinite(raw.width) ? raw.width : fallback.width,
      collapsed: raw.collapsed === true,
      tab: DOCK_TABS.includes(raw.tab as DockTab) ? (raw.tab as DockTab) : fallback.tab,
    }
  } catch {
    return fallback
  }
}

type DockState = Saved & {
  /** Being dragged wider or narrower right now (transitions pause). */
  resizing: boolean
  setWidth: (width: number) => void
  setCollapsed: (collapsed: boolean) => void
  setTab: (tab: DockTab) => void
  setResizing: (resizing: boolean) => void
}

export const useDock = create<DockState>((set) => ({
  ...load(),
  resizing: false,
  setWidth: (width) => set({ width }),
  setCollapsed: (collapsed) => set({ collapsed }),
  setTab: (tab) => set({ tab }),
  setResizing: (resizing) => set({ resizing }),
}))

// Persist the three remembered fields whenever they change.
useDock.subscribe((s, prev) => {
  if (s.width === prev.width && s.collapsed === prev.collapsed && s.tab === prev.tab) return
  try {
    localStorage.setItem(KEY, JSON.stringify({ width: s.width, collapsed: s.collapsed, tab: s.tab }))
  } catch {
    // Not remembered next time; harmless.
  }
})

const wideQuery = () => (typeof matchMedia === 'undefined' ? null : matchMedia(`(min-width: ${DOCK_BREAKPOINT}px)`))

function subscribeWide(cb: () => void) {
  const q = wideQuery()
  q?.addEventListener('change', cb)
  return () => q?.removeEventListener('change', cb)
}

/** True on screens wide enough for the docked side panel. */
export function useIsWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => !!wideQuery()?.matches,
    () => false,
  )
}

/** The side panel is showing (wide screen and not collapsed). */
export function useDockActive(): boolean {
  const wide = useIsWide()
  const collapsed = useDock((s) => s.collapsed)
  return wide && !collapsed
}

/** Same as `useDockActive`, for code outside React (keyboard handlers, store subscriptions). */
export function dockActiveNow(): boolean {
  return !!wideQuery()?.matches && !useDock.getState().collapsed
}

/** Fired on `window` when the space the panel takes changes (the map re-frames around it). */
export const DOCK_EVENT = 'atc:dock'

/** Current reserve on the right, as published in the `--dock-w` CSS variable. */
export function readDockReserve(): number {
  if (typeof document === 'undefined') return 0
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-w')) || 0
}
