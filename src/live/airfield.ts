/**
 * What the live traffic says about the airfield right now: the runways in
 * use and which gates have an aircraft parked at them. Worked out by
 * `RunwayGateLayer` every couple of seconds and read by the panels.
 */
import { create } from 'zustand'
import type { GateMatch } from './gates'
import type { ActiveRunways } from './runwayUse'

type AirfieldState = {
  runways: ActiveRunways | null
  /** Gate id → the aircraft parked there. */
  gates: Map<string, GateMatch>
}

export const useAirfield = create<AirfieldState>(() => ({ runways: null, gates: new Map() }))
