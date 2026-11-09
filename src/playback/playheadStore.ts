import { create } from 'zustand'
import { DEFAULT_AIRPORT, getAirport } from '../api/airports'
import type { ClipPack } from '../api/types'

export type PlayMode = 'live' | 'playback'

type PlayheadState = {
  mode: PlayMode
  airportIcao: string
  tMs: number
  playing: boolean
  clipId: string | null
  clip: ClipPack | null
  activeCallsign: string | null
  selectedIcao: string | null
  stationId: string
  sheetOpen: boolean
  menuOpen: boolean
  airportsOpen: boolean
  transcriptsOpen: boolean
  toast: string | null

  setMode: (mode: PlayMode) => void
  setAirport: (icao: string) => void
  setTMs: (tMs: number) => void
  setPlaying: (playing: boolean) => void
  setClip: (clip: ClipPack | null) => void
  setActiveCallsign: (cs: string | null) => void
  setSelectedIcao: (icao: string | null) => void
  setStationId: (id: string) => void
  setSheetOpen: (open: boolean) => void
  setMenuOpen: (open: boolean) => void
  setAirportsOpen: (open: boolean) => void
  setTranscriptsOpen: (open: boolean) => void
  setToast: (msg: string | null) => void
  enterPlayback: (clip: ClipPack) => void
  exitPlayback: () => void
}

export const usePlayhead = create<PlayheadState>((set) => ({
  mode: 'live',
  airportIcao: DEFAULT_AIRPORT,
  tMs: 0,
  playing: false,
  clipId: null,
  clip: null,
  activeCallsign: null,
  selectedIcao: null,
  stationId: getAirport(DEFAULT_AIRPORT).stations[0]?.id ?? 'ord-tower-28r',
  sheetOpen: false,
  menuOpen: false,
  airportsOpen: false,
  transcriptsOpen: false,
  toast: null,

  setMode: (mode) => set({ mode }),
  setAirport: (icao) => {
    const apt = getAirport(icao)
    set({
      airportIcao: apt.icao,
      stationId: apt.stations[0]?.id ?? 'ord-tower-28r',
      selectedIcao: null,
      activeCallsign: null,
      sheetOpen: false,
      airportsOpen: false,
      menuOpen: false,
      mode: 'live',
      playing: false,
      tMs: 0,
    })
  },
  setTMs: (tMs) => set({ tMs }),
  setPlaying: (playing) => set({ playing }),
  setClip: (clip) => set({ clip, clipId: clip?.id ?? null }),
  setActiveCallsign: (activeCallsign) => set({ activeCallsign }),
  setSelectedIcao: (selectedIcao) => set({ selectedIcao }),
  setStationId: (stationId) => set({ stationId }),
  setSheetOpen: (sheetOpen) => set({ sheetOpen }),
  setMenuOpen: (menuOpen) => set({ menuOpen }),
  setAirportsOpen: (airportsOpen) => set({ airportsOpen }),
  setTranscriptsOpen: (transcriptsOpen) => set({ transcriptsOpen }),
  setToast: (toast) => set({ toast }),

  enterPlayback: (clip) =>
    set({
      mode: 'playback',
      clip,
      clipId: clip.id,
      tMs: 0,
      playing: true,
      stationId: clip.stationId,
      airportIcao: 'ORD',
      menuOpen: false,
      airportsOpen: false,
      transcriptsOpen: false,
    }),

  exitPlayback: () =>
    set({
      mode: 'live',
      playing: false,
      tMs: 0,
      activeCallsign: null,
    }),
}))
