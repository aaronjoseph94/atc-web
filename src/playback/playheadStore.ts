/**
 * Global UI + playhead state (Zustand).
 *
 * One store holds the "clock" (`mode`, `tMs`, `playing`), the current
 * airport/station, the selected aircraft, the camera mode and which overlay
 * is open. Every component that needs to stay in sync (map, subtitles,
 * station bar, sheets) subscribes to the slices it needs via selectors.
 */
import { create } from 'zustand'
import { airportForStation, DEFAULT_AIRPORT, defaultStation, getAirport, resolveStation } from '../api/airports'
import type { ClipPack } from '../api/types'
import type { LiveEvent } from '../live/events'
import { useSettings } from '../settings/settingsStore'

export type PlayMode = 'live' | 'playback'

/** Health of the live traffic feed, surfaced in the top chrome and Settings. */
export type LiveStatus = 'idle' | 'loading' | 'ok' | 'error'

/** Which overlay panel is showing. Only one at a time. */
export type Panel = 'menu' | 'airports' | 'stations' | 'transcripts' | 'settings' | 'replay' | 'traffic' | 'weather' | 'layers' | 'help' | null

/** The flight card: hidden, the compact card above the station bar, or the full-screen detail. */
export type SheetState = 'closed' | 'card' | 'full'

/**
 * Who is steering the map. `auto`: the app frames the airfield and moves to
 * whoever is being talked about. `manual`: the user has dragged or zoomed and
 * the app leaves the view alone until asked back.
 */
export type CameraMode = 'auto' | 'manual'

export type Toast = { message: string; tone?: 'info' | 'error'; action?: { label: string; run: () => void } }

/** Speeds offered for replays without audio. */
export const RATES = [1, 2, 4, 8] as const
export type Rate = (typeof RATES)[number]

type PlayheadState = {
  mode: PlayMode
  airportIcao: string
  stationId: string
  /** Milliseconds from clip start (playback mode only). */
  tMs: number
  /** `performance.now()` when `tMs` was last anchored to the clock. */
  tSyncedAt: number
  playing: boolean
  /** Playback speed multiplier (only replays without audio go above 1). */
  rate: Rate
  clip: ClipPack | null
  /** Callsign currently transmitting (drives highlight + halo). */
  activeCallsign: string | null
  /** Who is speaking in the active cue: the controller or the pilot. */
  activeSpeaker: 'controller' | 'pilot' | null
  /** icao24 of the aircraft the user tapped. */
  selectedIcao: string | null
  /** Aircraft under the pointer (desktop) or highlighted from a list. */
  hoverIcao: string | null
  sheet: SheetState
  panel: Panel
  toast: Toast | null
  liveStatus: LiveStatus
  liveCount: number
  liveUpdatedAt: number | null
  /** Feed that answered the last poll. */
  liveProvider: string | null
  cameraMode: CameraMode
  /** Camera is locked onto the selected aircraft. */
  following: boolean
  /** Map is tilted into the 3D view. */
  tilt: boolean
  /** Tower log: detected takeoffs, landings and go-arounds, newest first. */
  events: LiveEvent[]
  /** The event currently shown as a caption in live mode. */
  caption: LiveEvent | null
  /** Where the user was before a replay took them to another airport. */
  returnTo: { airportIcao: string; stationId: string } | null

  setAirport: (icao: string) => void
  setStationId: (id: string) => void
  setTMs: (tMs: number) => void
  setPlaying: (playing: boolean) => void
  setRate: (rate: Rate) => void
  setClip: (clip: ClipPack | null) => void
  setActive: (callsign: string | null, speaker?: 'controller' | 'pilot' | null) => void
  /** Select an aircraft (opens the card and locks the camera on) or clear with null. */
  select: (icao: string | null) => void
  setHover: (icao: string | null) => void
  setSheet: (sheet: SheetState) => void
  setPanel: (panel: Panel) => void
  setToast: (toast: Toast | string | null) => void
  setLive: (status: LiveStatus, count?: number, provider?: string | null) => void
  setCameraMode: (mode: CameraMode) => void
  setFollowing: (following: boolean) => void
  setTilt: (tilt: boolean) => void
  addEvents: (events: LiveEvent[]) => void
  setCaption: (caption: LiveEvent | null) => void
  enterPlayback: (clip: ClipPack) => void
  exitPlayback: () => void
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Airport named in the URL (`/#/JFK`), else the persisted default. */
function initialAirport() {
  const fromUrl = typeof location !== 'undefined' ? /^#\/?([A-Za-z]{3})\b/.exec(location.hash)?.[1] : undefined
  const wanted = fromUrl?.toUpperCase() ?? useSettings.getState().defaultAirport ?? DEFAULT_AIRPORT
  return getAirport(wanted)
}

const startAirport = initialAirport()

/** Most events kept in the tower log. */
const MAX_EVENTS = 120

export const usePlayhead = create<PlayheadState>((set) => ({
  mode: 'live',
  airportIcao: startAirport.icao,
  stationId: defaultStation(startAirport)?.id ?? '',
  tMs: 0,
  tSyncedAt: 0,
  playing: false,
  rate: 1,
  clip: null,
  activeCallsign: null,
  activeSpeaker: null,
  selectedIcao: null,
  hoverIcao: null,
  sheet: 'closed',
  panel: null,
  toast: null,
  liveStatus: 'idle',
  liveCount: 0,
  liveUpdatedAt: null,
  liveProvider: null,
  cameraMode: useSettings.getState().autoCamera ? 'auto' : 'manual',
  following: false,
  tilt: false,
  events: [],
  caption: null,
  returnTo: null,

  // Switching airport always returns to live and clears per-airport state.
  setAirport: (icao) => {
    const apt = getAirport(icao)
    useSettings.getState().noteRecent(apt.icao)
    set({
      airportIcao: apt.icao,
      stationId: defaultStation(apt)?.id ?? '',
      selectedIcao: null,
      hoverIcao: null,
      activeCallsign: null,
      activeSpeaker: null,
      sheet: 'closed',
      panel: null,
      mode: 'live',
      playing: false,
      rate: 1,
      tMs: 0,
      tSyncedAt: now(),
      liveStatus: 'loading',
      liveCount: 0,
      cameraMode: 'auto',
      following: false,
      events: [],
      caption: null,
      returnTo: null,
    })
  },
  setStationId: (stationId) => set({ stationId }),
  setTMs: (tMs) => set({ tMs, tSyncedAt: now() }),
  // Re-anchor on play/pause so a pause doesn't get added back in as a skip.
  setPlaying: (playing) => set((s) => ({ playing, tMs: playbackInstant(s), tSyncedAt: now() })),
  setRate: (rate) => set((s) => ({ rate, tMs: playbackInstant(s), tSyncedAt: now() })),
  setClip: (clip) => set({ clip }),
  setActive: (activeCallsign, activeSpeaker = null) => set({ activeCallsign, activeSpeaker: activeCallsign ? activeSpeaker : null }),
  select: (selectedIcao) =>
    set((s) => ({
      selectedIcao,
      sheet: selectedIcao ? (s.sheet === 'full' ? 'full' : 'card') : 'closed',
      following: !!selectedIcao,
      // Clearing a selection hands the map back to the app.
      cameraMode: selectedIcao ? s.cameraMode : useSettings.getState().autoCamera ? 'auto' : s.cameraMode,
    })),
  setHover: (hoverIcao) => set({ hoverIcao }),
  setSheet: (sheet) => set({ sheet }),
  setPanel: (panel) => set({ panel }),
  setToast: (toast) => set({ toast: typeof toast === 'string' ? { message: toast } : toast }),
  setLive: (liveStatus, count, provider) =>
    set((s) => ({
      liveStatus,
      liveCount: count ?? s.liveCount,
      liveProvider: provider === undefined ? s.liveProvider : provider,
      liveUpdatedAt: liveStatus === 'ok' ? Date.now() : s.liveUpdatedAt,
    })),
  setCameraMode: (cameraMode) => set({ cameraMode }),
  setFollowing: (following) => set({ following }),
  setTilt: (tilt) => set({ tilt }),
  addEvents: (events) => set((s) => (events.length ? { events: [...events.toReversed(), ...s.events].slice(0, MAX_EVENTS) } : s)),
  setCaption: (caption) => set({ caption }),

  // Playback jumps the map to the clip's airport and starts the clock at 0.
  enterPlayback: (clip) => {
    const airport = airportForStation(clip.stationId) ?? getAirport(clip.airport ?? DEFAULT_AIRPORT)
    set((s) => ({
      // Remember where we came from the first time; scene-to-scene keeps the original.
      returnTo: s.returnTo ?? (s.mode === 'live' ? { airportIcao: s.airportIcao, stationId: s.stationId } : null),
      mode: 'playback',
      clip,
      tMs: 0,
      tSyncedAt: now(),
      playing: true,
      rate: 1,
      stationId: resolveStation(airport, clip.stationId)?.id ?? clip.stationId,
      airportIcao: airport.icao,
      selectedIcao: null,
      hoverIcao: null,
      activeCallsign: null,
      activeSpeaker: null,
      sheet: 'closed',
      panel: null,
      cameraMode: 'auto',
      following: false,
      caption: null,
    }))
  },

  // Back to live, at the airport and channel the user was on before the replay.
  exitPlayback: () =>
    set((s) => ({
      ...(s.returnTo && s.returnTo.airportIcao !== s.airportIcao ? { ...s.returnTo, liveStatus: 'loading' as const, liveCount: 0, events: [] } : s.returnTo ? { stationId: s.returnTo.stationId } : {}),
      returnTo: null,
      mode: 'live',
      playing: false,
      rate: 1,
      tMs: 0,
      tSyncedAt: now(),
      activeCallsign: null,
      activeSpeaker: null,
      selectedIcao: null,
      sheet: 'closed',
      following: false,
      cameraMode: 'auto',
    })),
}))

/**
 * Playback time for the current frame. While playing, the clock only reports
 * `tMs` a few times a second; between those reports we advance with the wall
 * clock (times the playback rate) so aircraft don't step.
 */
export function playbackInstant(s: {
  tMs: number
  playing: boolean
  tSyncedAt: number
  rate?: number
  clip: { durationMs: number } | null
}): number {
  if (!s.playing) return s.tMs
  const t = s.tMs + Math.max(0, now() - s.tSyncedAt) * (s.rate ?? 1)
  return s.clip ? Math.min(s.clip.durationMs, t) : t
}
