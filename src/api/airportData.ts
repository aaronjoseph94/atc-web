/**
 * Typed access to the committed OurAirports snapshot (`airportData.json`,
 * public domain, refreshed with `npm run data:airports`).
 *
 * Provides real VHF frequencies for the station bar / flight card and runway
 * threshold positions for on-map runway labels.
 */
import raw from './airportData.json'

export type FrequencyType = 'TWR' | 'GND' | 'APP' | 'ARR' | 'DEP' | 'ATIS' | 'CLD'

export type Frequency = {
  type: FrequencyType
  description: string
  mhz: number
}

export type RunwayEnd = {
  /** Runway designator, e.g. `28R`. */
  ident: string
  lat: number
  lon: number
  /** True heading in degrees, when published. */
  hdg: number | null
}

export type Runway = {
  lengthFt: number | null
  widthFt: number | null
  le: RunwayEnd
  he: RunwayEnd
}

type AirportRecord = { icao: string; frequencies: Frequency[]; runways: Runway[] }

const DATA = raw as { source: string; fetchedAt: string; airports: Record<string, AirportRecord> }

export const AIRPORT_DATA_SOURCE = DATA.source
export const AIRPORT_DATA_DATE = DATA.fetchedAt

/** Friendly names for frequency types, for non-aviation readers. */
export const FREQUENCY_LABEL: Record<FrequencyType, string> = {
  TWR: 'Tower',
  GND: 'Ground',
  APP: 'Approach',
  ARR: 'Approach',
  DEP: 'Departure',
  ATIS: 'Weather (ATIS)',
  CLD: 'Clearance',
}

/** One-line explanation of what each controller position does. */
export const FREQUENCY_ROLE: Record<FrequencyType, string> = {
  TWR: 'Clears aircraft to take off and land',
  GND: 'Guides aircraft between gates and runways',
  APP: 'Sequences arriving aircraft toward the runway',
  ARR: 'Sequences arriving aircraft toward the runway',
  DEP: 'Guides departing aircraft away from the airport',
  ATIS: 'Recorded weather and runway information',
  CLD: 'Issues the route clearance before pushback',
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

/** Format MHz the way controllers say it: three decimals max, no trailing zeros past two. */
export function formatMhz(mhz: number): string {
  const s = mhz.toFixed(3)
  return s.endsWith('0') ? s.slice(0, -1) : s
}
