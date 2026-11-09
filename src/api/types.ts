/**
 * Shared domain types. Everything the UI renders is one of these shapes,
 * regardless of which upstream data provider produced it.
 */

/** A single aircraft position, normalized from any ADS-B provider. */
export type Aircraft = {
  /** 24-bit ICAO transponder address, lowercase hex (stable identity). */
  icao24: string
  /** Flight callsign (e.g. `UAL2099`); falls back to the hex when unknown. */
  callsign: string
  lat: number
  lon: number
  /** True track in degrees (0–360, clockwise from north). */
  heading: number
  altitudeFt: number | null
  speedKt: number | null
  onGround: boolean
  /** ICAO aircraft type designator (e.g. `B738`) when the provider supplies it. */
  type?: string | null
  /** Tail number / registration when the provider supplies it. */
  registration?: string | null
  /** Barometric vertical rate in ft/min (positive = climbing). */
  verticalRateFpm?: number | null
}

/** One timed transcript line inside a clip pack. */
export type TranscriptCue = {
  id: string
  startMs: number
  endMs: number
  text: string
  callsign?: string
  speaker?: string
}

/** A recorded aircraft position used to replay movement during playback. */
export type TrackSample = {
  tMs: number
  lat: number
  lon: number
  heading: number
  altitudeFt?: number
  speedKt?: number
}

/**
 * A playable "clip pack": audio + transcript cues + aircraft tracks that
 * all share one timeline (`tMs` is milliseconds from clip start).
 */
export type ClipPack = {
  id: string
  stationId: string
  audioUrl: string
  durationMs: number
  title: string
  cues: TranscriptCue[]
  /** Keyed by callsign. */
  tracks: Record<string, TrackSample[]>
}

/** Controller position kind; maps onto OurAirports frequency types. */
export type StationKind = 'TWR' | 'GND' | 'APP' | 'DEP' | 'ATIS' | 'CLD'

/** A controller position (Tower, Ground, …) at an airport. */
export type Station = {
  id: string
  airport: string
  name: string
  label: string
  kind: StationKind
  /** Published VHF frequency in MHz (from OurAirports), when known. */
  frequencyMhz?: number
}
