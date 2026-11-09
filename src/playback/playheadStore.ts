/**
 * Global UI + playhead state (Zustand).
 *
 * One store holds the "clock" (`mode`, `tMs`, `playing`), the current
 * airport/station, the selected aircraft, and which overlay is open. Every
 * component that needs to stay in sync (map, karaoke, station bar, sheets)
 * subscribes to the slices it needs via selectors.
 */
import { create } from 'zustand'
import { airportForStation, DEFAULT_AIRPORT, getAirport } from '../api/airports'
import type { ClipPack } from '../api/types'
import { useSettings } from '../settings/settingsStore'

export type PlayMode = 'live' | 'playback'

/** Health of the live traffic feed, surfaced in the top chrome and Settings. */
export type LiveStatus = 'idle' | 'loading' | 'ok' | 'error'

/** Which full-screen/overlay panel is showing. Only one at a time. */
export type Panel = 'menu' | 'airports' | 'transcripts' | 'settings' | null

type PlayheadState = {
  mode: PlayMode
  airportIcao: string
  stationId: string
  /** Milliseconds from clip start (playback mode only). */
  tMs: number
  /** `performance.now()` when `tMs` was last anchored to the audio clock. */
  tSyncedAt: number
  playing: boolean
  clip: ClipPack | null
  /** Callsign currently transmitting (drives highlight + halo). */
  activeCallsign: string | null
  /** icao24 of the aircraft the user tapped. */
  selectedIcao: string | null
  sheetOpen: boolean
  panel: Panel
  toast: string | null
  liveStatus: LiveStatus
  liveCount: number
  liveUpdatedAt: number | null

  setAirport: (icao: string) => void
  setStationId: (id: string) => void
  setTMs: (tMs: number) => void
  setPlaying: (playing: boolean) => void
  setClip: (clip: ClipPack | null) => void
  setActiveCallsign: (cs: string | null) => void
  setSelectedIcao: (icao: string | null) => void
  setSheetOpen: (open: boolean) => void
  setPanel: (panel: Panel) => void
  setToast: (msg: string | null) => void
  setLive: (status: LiveStatus, count?: number) => void
  enterPlayback: (clip: ClipPack) => void
  exitPlayback: () => void
}

/** Startup airport honours the persisted Settings preference. */
const startAirport = getAirport(useSettings.getState().defaultAirport || DEFAULT_AIRPORT)

export const usePlayhead = create<PlayheadState>((set) => ({
  mode: 'live',
  airportIcao: startAirport.icao,
  stationId: startAirport.stations[0]?.id ?? 'ord-tower-28r',
  tMs: 0,
  tSyncedAt: 0,
  playing: false,
  clip: null,
  activeCallsign: null,
  selectedIcao: null,
  sheetOpen: false,
  panel: null,
  toast: null,
  liveStatus: 'idle',
  liveCount: 0,
  liveUpdatedAt: null,

  // Switching airport always returns to live and clears per-airport selection.
  setAirport: (icao) => {
    const apt = getAirport(icao)
    set({
      airportIcao: apt.icao,
      stationId: apt.stations[0]?.id ?? 'ord-tower-28r',
      selectedIcao: null,
      activeCallsign: null,
      sheetOpen: false,
      panel: null,
      mode: 'live',
      playing: false,
      tMs: 0,
      tSyncedAt: performance.now(),
      liveStatus: 'loading',
      liveCount: 0,
    })
  },
  setStationId: (stationId) => set({ stationId }),
  setTMs: (tMs) => set({ tMs, tSyncedAt: typeof performance !== 'undefined' ? performance.now() : Date.now() }),
  // Re-anchor on play/pause so a pause doesn't get added back in as a skip.
  setPlaying: (playing) => set({ playing, tSyncedAt: typeof performance !== 'undefined' ? performance.now() : Date.now() }),
  setClip: (clip) => set({ clip }),
  setActiveCallsign: (activeCallsign) => set({ activeCallsign }),
  setSelectedIcao: (selectedIcao) => set({ selectedIcao }),
  setSheetOpen: (sheetOpen) => set({ sheetOpen }),
  setPanel: (panel) => set({ panel }),
  setToast: (toast) => set({ toast }),
  setLive: (liveStatus, count) =>
    set((s) => ({
      liveStatus,
      liveCount: count ?? s.liveCount,
      liveUpdatedAt: liveStatus === 'ok' ? Date.now() : s.liveUpdatedAt,
    })),

  // Playback jumps the map to the clip's airport and starts the clock at 0.
  enterPlayback: (clip) =>
    set({
      mode: 'playback',
      clip,
      tMs: 0,
      tSyncedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      playing: true,
      stationId: clip.stationId,
      airportIcao: airportForStation(clip.stationId)?.icao ?? DEFAULT_AIRPORT,
      selectedIcao: null,
      sheetOpen: false,
      panel: null,
    }),

  exitPlayback: () =>
    set({
      mode: 'live',
      playing: false,
      tMs: 0,
      tSyncedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      activeCallsign: null,
      selectedIcao: null,
      sheetOpen: false,
    }),
}))

/**
 * Playback time for the current frame. While playing, the audio element only
 * reports `tMs` a few times a second; between those reports we advance with
 * the wall clock so aircraft don't step.
 */
export function playbackInstant(s: {
  tMs: number
  playing: boolean
  tSyncedAt: number
  clip: { durationMs: number } | null
}): number {
  if (!s.playing) return s.tMs
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const t = s.tMs + Math.max(0, now - s.tSyncedAt)
  return s.clip ? Math.min(s.clip.durationMs, t) : t
}
