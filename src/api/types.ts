/**
 * Shared domain types. Everything the UI renders is one of these shapes,
 * regardless of which upstream data provider produced it.
 */

/** A single aircraft position, normalized from any ADS-B provider. */
export type Aircraft = {
  /** 24-bit ICAO transponder address, lowercase hex (stable identity). */
  icao24: string
  /**
   * When the position was measured (epoch ms, the feed's clock). The map uses
   * it to date each report, so aircraft are drawn where they are now rather
   * than where they were when the (seconds-old) report was made.
   */
  positionTime?: number
  /** Flight callsign (e.g. `UAL2099`); falls back to the hex when unknown. */
  callsign: string
  lat: number
  lon: number
  /** True track in degrees (0–360, clockwise from north). */
  heading: number
  /**
   * False when the feed sent no track or heading at all (common for parked
   * aircraft). The icon then shouldn't pretend to point north.
   */
  headingKnown?: boolean
  altitudeFt: number | null
  speedKt: number | null
  onGround: boolean
  /** ICAO aircraft type designator (e.g. `B738`) when the provider supplies it. */
  type?: string | null
  /** Tail number / registration when the provider supplies it. */
  registration?: string | null
  /** Barometric vertical rate in ft/min (positive = climbing). */
  verticalRateFpm?: number | null
  /** ADS-B emitter category (`A1` light … `A5` heavy, `A7` rotorcraft, `C1`/`C2` ground vehicles). */
  category?: string | null
  /** Transponder code as four octal digits. */
  squawk?: string | null
  /** Declared emergency (`general`, `nordo`, `minfuel`, …); null when none. */
  emergency?: string | null
  /** Altitude dialled into the autopilot, when broadcast. */
  selectedAltitudeFt?: number | null
}

/** What `/api/aircraft` resolved to, including which feed answered. */
export type AircraftSnapshot = {
  aircraft: Aircraft[]
  /** Name of the feed that answered, or null when every feed failed. */
  provider: string | null
  /** Upstream failure summary when every feed failed. */
  error: string | null
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
  /** Explicit surface flag; when absent, altitude below 50 ft counts as ground. */
  onGround?: boolean
}

/**
 * A playable "clip pack": audio + transcript cues + aircraft tracks that
 * all share one timeline (`tMs` is milliseconds from clip start).
 */
export type ClipPack = {
  id: string
  /** `scene`: a bundled clip with audio. `rewind`: live traffic recorded this session (no audio). */
  kind?: 'scene' | 'rewind'
  /** Epoch milliseconds of `tMs = 0`, for replays of real traffic. */
  startedAt?: number
  stationId: string
  audioUrl: string
  durationMs: number
  title: string
  /** One-sentence scene description for the clip picker. */
  description?: string
  /** Catalog airport code the clip takes place at. */
  airport?: string
  cues: TranscriptCue[]
  /**
   * Keyed by callsign (scenes) or transponder address (rewinds); cues refer to
   * the same key. An aircraft is drawn only between its first and last sample.
   */
  tracks: Record<string, TrackSample[]>
  /** Optional details per track key, for silhouettes and the flight card. */
  aircraft?: Record<string, { callsign?: string; type?: string; registration?: string; category?: string }>
}

/** Entry in `/clips/index.json`. */
export type ClipSummary = {
  id: string
  title: string
  description?: string
  airport: string
  stationId: string
  durationMs: number
}

/** Controller position kind (`CLB` = Class B/C airspace advisories, `OTH` = everything else). */
export type StationKind = 'TWR' | 'GND' | 'APP' | 'DEP' | 'ATIS' | 'CLD' | 'CLB' | 'OTH'

/** A controller position (Tower for one runway, a Ground sector, …) at an airport. */
export type Station = {
  id: string
  airport: string
  /** Short airport name, e.g. `Chicago O'Hare`. */
  name: string
  /** Full label for the station bar, e.g. `Tower (Rwy 10L-28R)`. */
  label: string
  /** Just the position, as listed inside its group: `Rwy 10L-28R`, `Center Inbound`. */
  position: string
  kind: StationKind
  /** Published VHF frequency in MHz, when known. */
  frequencyMhz?: number
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

export type FlightCategory = 'VFR' | 'MVFR' | 'IFR' | 'LIFR'

/** Decoded surface observation (METAR) for an airport. */
export type Metar = {
  raw: string
  /** ISO timestamp of the observation. */
  observedAt: string
  /** Degrees true the wind blows FROM; null when calm or variable. */
  windDirDeg: number | null
  windVariable: boolean
  windKt: number | null
  gustKt: number | null
  /** Statute miles; `visibilityPlus` marks "10 or more". */
  visibilitySm: number | null
  visibilityPlus: boolean
  tempC: number | null
  dewpointC: number | null
  /** Altimeter setting in inches of mercury. */
  altimeterInHg: number | null
  flightCategory: FlightCategory | null
  clouds: { cover: string; baseFt: number | null }[]
  /** Present-weather codes such as `-RA BR`. */
  weather: string | null
}

/** One digital ATIS broadcast (US airports that publish D-ATIS). */
export type Atis = {
  /** Information letter (A–Z). */
  code: string
  kind: 'combined' | 'arrival' | 'departure'
  text: string
  updatedAt: string | null
}

export type Weather = {
  airport: string
  icao: string
  metar: Metar | null
  atis: Atis[]
  /** Raw terminal forecast (TAF), where one is issued. */
  taf?: string | null
  fetchedAt: string
}

// ---------------------------------------------------------------------------
// Flight details (route, airframe)
// ---------------------------------------------------------------------------

export type RouteAirport = {
  iata: string | null
  icao: string | null
  name: string | null
  city: string | null
  lat: number | null
  lon: number | null
}

export type FlightInfo = {
  callsign: string | null
  airline: string | null
  origin: RouteAirport | null
  destination: RouteAirport | null
  /** Marketing type name, e.g. `A321 231SL`. */
  typeName: string | null
  manufacturer: string | null
  registration: string | null
  owner: string | null
}
