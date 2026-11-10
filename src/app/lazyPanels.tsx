/**
 * Sheets nobody needs for the first paint (Settings, Map style and labels,
 * Help), split out of the main bundle. Each is fetched when it is first
 * opened, or quietly a few seconds after start-up so that first open is
 * still instant, and stays mounted after that so it can animate out.
 */
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react'
import { usePlayhead, type Panel } from '../playback/playheadStore'

/** After start-up has settled, fetch the split-out sheets in the background. */
const PREFETCH_MS = 5000

function lazyPanel(panel: Exclude<Panel, null>, load: () => Promise<ComponentType>): ComponentType {
  const Lazy = lazy(() => load().then((C) => ({ default: C })))
  let prefetched = false
  return function LazyPanel() {
    const open = usePlayhead((s) => s.panel === panel)
    const [wanted, setWanted] = useState(open)
    if (open && !wanted) setWanted(true)
    useEffect(() => {
      if (prefetched) return
      prefetched = true
      const id = window.setTimeout(() => void load().catch(() => {}), PREFETCH_MS)
      return () => window.clearTimeout(id)
    }, [])
    if (!wanted) return null
    return (
      <Suspense fallback={null}>
        <Lazy />
      </Suspense>
    )
  }
}

export const SettingsView = lazyPanel('settings', () => import('../settings/SettingsView').then((m) => m.SettingsView))
export const LayersPanel = lazyPanel('layers', () => import('./LayersPanel').then((m) => m.LayersPanel))
export const HelpPanel = lazyPanel('help', () => import('./HelpPanel').then((m) => m.HelpPanel))
