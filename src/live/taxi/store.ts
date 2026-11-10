/**
 * Taxi routes on the map: one per aircraft, from the latest taxi clearance
 * heard for it. The map layer draws them, trims them as the aircraft moves,
 * and drops them when the aircraft reaches the end or they go stale.
 */
import { create } from 'zustand'
import type { LngLat } from '../../map/geo'
import type { TaxiClearance } from './parse'

/** A route is shown for at most this long. */
export const ROUTE_TTL_MS = 5 * 60_000

export type TaxiRoute = {
  id: string
  icao24: string
  callsign: string
  airport: string
  /** The call it came from, word for word. */
  text: string
  /** "Taxi to runway 31L via A, B · hold short of runway 4L". */
  summary: string
  clearance: TaxiClearance
  /** When the clearance was heard. */
  at: number
  coords: LngLat[]
  holds: { at: LngLat; bearing: number; label: string }[]
  runway: string | null
  /** Followed the named taxiways in order (false: a best guess). */
  exact: boolean
  missing: string[]
}

type TaxiState = {
  routes: TaxiRoute[]
  /** The route whose clearance is shown in the popup. */
  open: string | null
  add: (r: TaxiRoute) => void
  remove: (id: string) => void
  setOpen: (id: string | null) => void
  clear: () => void
}

export const useTaxi = create<TaxiState>((set) => ({
  routes: [],
  open: null,
  // A new clearance for the same aircraft replaces its old route.
  add: (r) => set((s) => ({ routes: [...s.routes.filter((x) => x.icao24 !== r.icao24 && x.airport === r.airport), r] })),
  remove: (id) => set((s) => ({ routes: s.routes.filter((x) => x.id !== id), open: s.open === id ? null : s.open })),
  setOpen: (open) => set({ open }),
  clear: () => set({ routes: [], open: null }),
}))
