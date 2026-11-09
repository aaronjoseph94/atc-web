/**
 * Typed access to the committed OurAirports snapshot (`airportData.json`,
 * public domain, refreshed with `npm run data:airports`).
 *
 * Provides real VHF frequencies for the station bar / flight card and runway
 * threshold positions for on-map runway labels.
 */
import raw from './airportData.json'

export type FrequencyType = 'TWR' | 'GND' | 'APP' | 'DEP' | 'ATIS' | 'CLD' | 'CLB' | 'OTH'

export type Frequency = {
  type: FrequencyType
  /** Position name: `Rwy 10L-28R`, `Center Inbound`, `South (150°–219°)`. */
  description: string
  mhz: number
  /** False for secondary/backup frequencies. */
  primary?: boolean
}

export type RunwayEnd = {
  /** Runway designator, e.g. `28R`. */
  ident: string
  lat: number
  lon: number
  /** True heading in degrees, when published. */
  hdg: number | null
  /** Distance the landing threshold is moved in from the pavement end, feet. */
  displacedFt?: number
}

export type Runway = {
  lengthFt: number | null
  widthFt: number | null
  /** Surface as published (`ASP`, `CON`, …). */
  surface?: string | null
  le: RunwayEnd
  he: RunwayEnd
}

type AirportRecord = {
  icao: string
  /** Airport reference point. */
  lat: number | null
  lon: number | null
  elevationFt: number | null
  frequencies: Frequency[]
  runways: Runway[]
}

const DATA = raw as { source: string; fetchedAt: string; faaCycle?: string | null; airports: Record<string, AirportRecord> }

export const AIRPORT_DATA_SOURCE = DATA.source
export const AIRPORT_DATA_DATE = DATA.fetchedAt
/** Effective date of the FAA data cycle the US frequencies came from. */
export const FAA_CYCLE_DATE = DATA.faaCycle ?? null

/** Display order of the groups in the channel switcher. */
export const FREQUENCY_ORDER: FrequencyType[] = ['TWR', 'GND', 'CLD', 'APP', 'DEP', 'CLB', 'ATIS', 'OTH']

/** Friendly names for frequency types, for non-aviation readers. */
export const FREQUENCY_LABEL: Record<FrequencyType, string> = {
  TWR: 'Tower',
  GND: 'Ground',
  APP: 'Approach',
  DEP: 'Departure',
  ATIS: 'ATIS',
  CLD: 'Clearance',
  CLB: 'Airspace advisories',
  OTH: 'Other',
}

/** One-line explanation of what each controller position does. */
export const FREQUENCY_ROLE: Record<FrequencyType, string> = {
  TWR: 'Clears aircraft to take off and land',
  GND: 'Guides aircraft between gates and runways',
  APP: 'Sequences arriving aircraft toward the runway',
  DEP: 'Guides departing aircraft away from the airport',
  ATIS: 'Recorded weather and runway information',
  CLD: 'Issues the route clearance before pushback',
  CLB: 'Advises small aircraft crossing the busy airspace',
  OTH: 'Special-purpose frequency',
}

function record(iata: string): AirportRecord | undefined {
  return DATA.airports[iata.toUpperCase()]
}

/** ICAO 4-letter code (KORD, CYYZ) for a catalog airport. */
export function icaoCode(iata: string): string | undefined {
  return record(iata)?.icao
}

export function getFrequencies(iata: string): Frequency[] {
  return record(iata)?.frequencies ?? []
}

/** First published frequency of a type (lowest MHz), or `undefined`. */
export function getFrequency(iata: string, type: FrequencyType): Frequency | undefined {
  return getFrequencies(iata).find((f) => f.type === type)
}

export function getRunways(iata: string): Runway[] {
  return record(iata)?.runways ?? []
}

/** Field elevation in feet above sea level (0 when unknown). */
export function getElevationFt(iata: string): number {
  return record(iata)?.elevationFt ?? 0
}

/** Published airport reference point as `[lon, lat]`, when known. */
export function getReferencePoint(iata: string): [number, number] | null {
  const r = record(iata)
  return r?.lat != null && r.lon != null ? [r.lon, r.lat] : null
}

/**
 * Box around every runway end as `[[west, south], [east, north]]`: the area
 * the camera should frame to show the whole airfield.
 */
export function getRunwayBounds(iata: string): [[number, number], [number, number]] | null {
  const runways = getRunways(iata)
  if (!runways.length) return null
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const r of runways) {
    for (const end of [r.le, r.he]) {
      w = Math.min(w, end.lon)
      e = Math.max(e, end.lon)
      s = Math.min(s, end.lat)
      n = Math.max(n, end.lat)
    }
  }
  return [
    [w, s],
    [e, n],
  ]
}

/**
 * Runway designator as painted on the pavement. US runways drop the leading
 * zero ("4L"); everywhere else keeps it ("05").
 */
export function paintedDesignator(ident: string, icao: string | undefined): string {
  return icao?.startsWith('K') || icao?.startsWith('P') ? ident.replace(/^0/, '') : ident
}

/** Format MHz the way controllers say it: three decimals max, no trailing zeros past two. */
export function formatMhz(mhz: number): string {
  const s = mhz.toFixed(3)
  return s.endsWith('0') ? s.slice(0, -1) : s
}
