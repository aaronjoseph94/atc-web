/**
 * What a feedback report carries besides the person's words: where they were
 * in the app, which build, the screen size, and recent errors. All of it is
 * shown in the sheet before sending. Public flight data only (the selected
 * flight's callsign and type); nothing about the person.
 */
import { version } from '../../package.json'
import { getAirport, resolveStation } from '../api/airports'
import type { FeedbackContext } from '../api/ai/tasks/triageFeedback'
import { liveBuffer } from '../live/session'
import { usePlayhead } from '../playback/playheadStore'
import { recentErrors } from './errorLog'

/** `0.1.0 · index-BX2c9a`: the package version and, on a built site, the bundle's hash. */
export function appVersion(): string {
  const src = typeof document === 'undefined' ? '' : (document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.src ?? '')
  const build = /\/assets\/([\w-]+)\.js/.exec(src)?.[1]
  return build ? `${version} · ${build}` : `${version} · dev`
}

export function collectContext(): FeedbackContext {
  const s = usePlayhead.getState()
  const airport = getAirport(s.airportIcao)
  const station = resolveStation(airport, s.stationId)
  const sel = s.selectedIcao ? liveBuffer.get(s.selectedIcao) : null
  return {
    airport: airport.icao,
    station: station ? `${station.name} ${station.label}`.trim() : null,
    flight: s.selectedIcao ? { callsign: sel?.callsign ?? null, type: sel?.type ?? null } : null,
    mode: s.mode,
    panel: s.panel,
    version: appVersion(),
    viewport: typeof window === 'undefined' ? null : `${window.innerWidth}×${window.innerHeight} @${Math.round((window.devicePixelRatio || 1) * 100) / 100}x`,
    userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
    errors: recentErrors(),
  }
}
