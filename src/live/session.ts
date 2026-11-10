/**
 * The live traffic session: one position buffer, one recorder and one event
 * memory shared by the map (which feeds them) and the panels that read them
 * (traffic list, flight card, replay). Module-level because there is exactly
 * one map and one airport on screen at a time.
 */
import type { Map as MapLibreMap } from 'maplibre-gl'
import { LivePositionBuffer } from '../map/livePositions'
import type { EventState } from './events'
import { LiveRecorder } from './recorder'

export const liveBuffer = new LivePositionBuffer()
export const liveRecorder = new LiveRecorder()
export const eventState: EventState = new Map()

/** Forget everything about the previous airport. */
export function resetLiveSession() {
  liveBuffer.clear()
  liveRecorder.clear()
  eventState.clear()
}

/** The live map instance, for controls that sit outside the map component. */
export const mapHandle: { current: MapLibreMap | null; home: (() => void) | null } = { current: null, home: null }
