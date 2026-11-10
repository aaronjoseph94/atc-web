import { useEffect } from 'react'
import { mapHandle } from '../live/session'
import { cameraNudge } from '../app/camera'
import { usePlayhead, type Panel } from '../playback/playheadStore'

/** Shown in the help panel; the handler below is the source of truth for behaviour. */
export const SHORTCUTS: [string, string][] = [
  ['/', 'Search traffic'],
  ['A', 'Change airport'],
  ['C', 'Switch channel'],
  ['T', 'Transcript or tower log'],
  ['W', 'Weather and ATIS'],
  ['R', 'Replay'],
  ['L', 'Map layers'],
  ['M', 'Menu'],
  ['F', 'Follow the selected flight'],
  ['H', 'Show the whole airfield'],
  ['N', 'Turn the map north up'],
  ['+ −', 'Zoom in or out'],
  ['Space', 'Play or pause a replay'],
  ['← →', 'Skip 5 seconds in a replay'],
  ['Esc', 'Close, or clear the selection'],
  ['?', 'This list'],
  // Handled by the side panel itself (DesktopPanel); listed only where that panel exists.
  [']', 'Hide or show the side panel'],
]

/** Shortcuts that only do something on wide screens, where the side panel docks. */
export const WIDE_ONLY_SHORTCUTS = new Set([']'])

const PANEL_KEYS: Record<string, Panel> = { '/': 'traffic', a: 'airports', c: 'stations', t: 'transcripts', w: 'weather', r: 'replay', l: 'layers', m: 'menu', '?': 'help' }

/** Global keyboard shortcuts. Ignored while typing or while a dialog is handling keys itself. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      const s = usePlayhead.getState()
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key

      if (key === 'Escape') {
        // Dialogs close themselves; with none open, Escape lets go of the flight.
        if (s.panel) return
        if (s.sheet === 'full') s.setSheet('card')
        else if (s.selectedIcao) s.select(null)
        return
      }
      // Everything else is for the bare map; don't fight an open dialog.
      if (s.panel && key !== '?') return
      if (s.sheet === 'full') return

      const panel = PANEL_KEYS[key]
      if (panel) {
        e.preventDefault()
        s.setPanel(panel)
        return
      }
      switch (key) {
        case 'n':
          cameraNudge.northUp()
          break
        case '+':
        case '=':
          cameraNudge.zoom(1)
          break
        case '-':
        case '_':
          cameraNudge.zoom(-1)
          break
        case 'f':
          if (s.selectedIcao) s.setFollowing(!s.following)
          break
        case 'h':
        case '0':
          s.setFollowing(false)
          s.setCameraMode('auto')
          mapHandle.home?.()
          break
        case ' ':
          if (s.mode !== 'playback' || (el && el.tagName === 'BUTTON')) return
          e.preventDefault()
          s.setPlaying(!s.playing)
          break
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (s.mode !== 'playback' || !s.clip || el?.getAttribute('role') === 'slider') return
          // The map uses arrow keys to pan when it has focus.
          if (el?.closest('.maplibregl-canvas-container')) return
          e.preventDefault()
          const step = key === 'ArrowLeft' ? -5000 : 5000
          s.setTMs(Math.max(0, Math.min(s.clip.durationMs, s.tMs + step)))
          break
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
