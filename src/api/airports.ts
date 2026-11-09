/**
 * Static airport catalog. Each entry drives the map camera (center/zoom),
 * the traffic query area (radius for readsb providers, bbox for OpenSky)
 * and the list of controller stations shown in the station bar.
 */
import { getElevationFt, getFrequency, getReferencePoint, getRunwayBounds } from './airportData'
import type { Station, StationKind } from './types'

export type AirportGroup = 'US' | 'Canada'

/** Lat/lon bounding box in OpenSky parameter naming. */
export type AirportBbox = {
  lamin: number
  lomin: number
  lamax: number
  lomax: number
}

export type AirportConfig = {
  /** IATA-style 3-letter code used throughout the UI (ORD, YYZ, …). */
  icao: string
  name: string
  group: AirportGroup
  /** `[lon, lat]` — MapLibre ordering. */
  center: [number, number]
  zoom: number
  bbox: AirportBbox
  /** Query radius in nautical miles for point-based providers. */
  radiusNm: number
  /** Field elevation, feet above sea level. */
  elevationFt: number
  /** `[[west, south], [east, north]]` framing every runway. */
  bounds: [[number, number], [number, number]]
  stations: Station[]
}

/** Optional per-airport sizing for busy or sprawling fields. */
type AirportPad = { dLat?: number; dLon?: number; radiusNm?: number }

/** Build a station; the published frequency is looked up from OurAirports data. */
function station(airport: string, name: string, suffix: string, label: string, kind?: StationKind): Station {
  // Ground positions are the only hand-listed ones that aren't towers.
  const resolved: StationKind = kind ?? (suffix.startsWith('ground') ? 'GND' : 'TWR')
  return {
    id: `${airport.toLowerCase()}-${suffix}`,
    airport,
    name,
    label,
    kind: resolved,
    frequencyMhz: getFrequency(airport, resolved)?.mhz,
  }
}

/**
 * Approach / Departure / ATIS positions exist at every airport in the
 * catalog but aren't worth hand-listing; add them when a frequency is known.
 */
function autoStations(airport: string, name: string): Station[] {
  const extra: [StationKind, string, string][] = [
    ['APP', 'approach', 'Approach'],
    ['DEP', 'departure', 'Departure'],
    ['ATIS', 'atis', 'ATIS (weather)'],
  ]
  return extra
    .filter(([kind]) => getFrequency(airport, kind))
    .map(([kind, suffix, label]) => station(airport, name, suffix, label, kind))
}

function bboxAround(lat: number, lon: number, dLat = 0.06, dLon = 0.08): AirportBbox {
  return {
    lamin: lat - dLat,
    lomin: lon - dLon,
    lamax: lat + dLat,
    lomax: lon + dLon,
  }
}

function apt(
  icao: string,
  name: string,
  group: AirportGroup,
  lat: number,
  lon: number,
  zoom: number,
  stations: Station[],
  pad?: AirportPad,
): AirportConfig {
  return {
    icao,
    name,
    group,
    center: [lon, lat],
    zoom,
    bbox: bboxAround(lat, lon, pad?.dLat, pad?.dLon),
    radiusNm: pad?.radiusNm ?? 12,
    elevationFt: getElevationFt(icao),
    bounds: getRunwayBounds(icao) ?? [
      [lon - 0.03, lat - 0.02],
      [lon + 0.03, lat + 0.02],
    ],
    stations: [...stations, ...autoStations(icao, stations[0]?.name ?? name)],
  }
}

/**
 * Catalog entry positioned from the OurAirports snapshot (centre of the
 * runway complex), with the standard Tower + Ground pair.
 */
function std(icao: string, name: string, short: string, group: AirportGroup, zoom = 12.2, pad?: AirportPad): AirportConfig {
  const b = getRunwayBounds(icao)
  const ref = getReferencePoint(icao) ?? [0, 0]
  const lon = b ? (b[0][0] + b[1][0]) / 2 : ref[0]
  const lat = b ? (b[0][1] + b[1][1]) / 2 : ref[1]
  return apt(
    icao,
    name,
    group,
    Math.round(lat * 1e4) / 1e4,
    Math.round(lon * 1e4) / 1e4,
    zoom,
    [station(icao, short, 'tower', 'Tower'), station(icao, short, 'ground', 'Ground')],
    pad,
  )
}

/** All supported airports, in display order (US first, then Canada). */
export const AIRPORTS: AirportConfig[] = [
  apt('ATL', 'Hartsfield–Jackson Atlanta', 'US', 33.6407, -84.4277, 12.2, [
    station('ATL', 'Atlanta', 'tower', 'Tower'),
    station('ATL', 'Atlanta', 'ground', 'Ground'),
  ]),
  apt('LAX', 'Los Angeles International', 'US', 33.9425, -118.4081, 12.1, [
    station('LAX', 'Los Angeles', 'tower-n', 'Tower (North)'),
    station('LAX', 'Los Angeles', 'ground', 'Ground'),
  ]),
  apt('DFW', 'Dallas/Fort Worth International', 'US', 32.8998, -97.0403, 11.8, [
    station('DFW', 'Dallas/Fort Worth', 'tower-e', 'Tower (East)'),
    station('DFW', 'Dallas/Fort Worth', 'ground', 'Ground'),
  ], { dLat: 0.08, dLon: 0.1, radiusNm: 15 }),
  apt('DEN', 'Denver International', 'US', 39.8561, -104.6737, 11.7, [
    station('DEN', 'Denver', 'tower', 'Tower'),
    station('DEN', 'Denver', 'ground', 'Ground'),
  ], { dLat: 0.08, dLon: 0.1, radiusNm: 15 }),
  apt('ORD', "Chicago O'Hare International", 'US', 41.9742, -87.9073, 12.3, [
    station('ORD', "Chicago O'Hare", 'tower-28r', 'Tower (Rwy 10L-28R)'),
    station('ORD', "Chicago O'Hare", 'ground-south', 'Ground (South Secondary)'),
  ]),
  apt('JFK', 'John F. Kennedy International', 'US', 40.6413, -73.7781, 12.2, [
    station('JFK', 'New York JFK', 'tower', 'Tower'),
    station('JFK', 'New York JFK', 'ground', 'Ground'),
  ]),
  apt('MCO', 'Orlando International', 'US', 28.4312, -81.3081, 12.0, [
    station('MCO', 'Orlando', 'tower', 'Tower'),
    station('MCO', 'Orlando', 'ground', 'Ground'),
  ]),
  apt('LAS', 'Harry Reid International', 'US', 36.084, -115.1537, 12.1, [
    station('LAS', 'Las Vegas', 'tower', 'Tower'),
    station('LAS', 'Las Vegas', 'ground', 'Ground'),
  ]),
  apt('CLT', 'Charlotte Douglas International', 'US', 35.214, -80.9431, 12.2, [
    station('CLT', 'Charlotte', 'tower', 'Tower'),
    station('CLT', 'Charlotte', 'ground', 'Ground'),
  ]),
  apt('MIA', 'Miami International', 'US', 25.7959, -80.287, 12.2, [
    station('MIA', 'Miami', 'tower', 'Tower'),
    station('MIA', 'Miami', 'ground', 'Ground'),
  ]),
  apt('SEA', 'Seattle–Tacoma International', 'US', 47.4502, -122.3088, 12.3, [
    station('SEA', 'Seattle', 'tower', 'Tower'),
    station('SEA', 'Seattle', 'ground', 'Ground'),
  ]),
  apt('EWR', 'Newark Liberty International', 'US', 40.6895, -74.1745, 12.3, [
    station('EWR', 'Newark', 'tower', 'Tower'),
    station('EWR', 'Newark', 'ground', 'Ground'),
  ]),
  apt('SFO', 'San Francisco International', 'US', 37.6213, -122.379, 12.3, [
    station('SFO', 'San Francisco', 'tower', 'Tower'),
    station('SFO', 'San Francisco', 'ground', 'Ground'),
  ]),
  apt('PHX', 'Phoenix Sky Harbor International', 'US', 33.4373, -112.0078, 12.2, [
    station('PHX', 'Phoenix', 'tower', 'Tower'),
    station('PHX', 'Phoenix', 'ground', 'Ground'),
  ]),
  apt('IAH', 'George Bush Intercontinental', 'US', 29.9902, -95.3368, 12.0, [
    station('IAH', 'Houston', 'tower', 'Tower'),
    station('IAH', 'Houston', 'ground', 'Ground'),
  ]),
  apt('LGA', 'LaGuardia', 'US', 40.7769, -73.874, 12.6, [
    station('LGA', 'LaGuardia New York', 'tower', 'Tower'),
    station('LGA', 'LaGuardia New York', 'ground', 'Ground'),
  ]),
  std('BOS', 'Boston Logan International', 'Boston', 'US', 12.4),
  std('MSP', 'Minneapolis–Saint Paul International', 'Minneapolis', 'US'),
  std('DTW', 'Detroit Metropolitan Wayne County', 'Detroit', 'US', 12.0),
  std('PHL', 'Philadelphia International', 'Philadelphia', 'US'),
  std('SLC', 'Salt Lake City International', 'Salt Lake City', 'US'),
  std('DCA', 'Ronald Reagan Washington National', 'Washington National', 'US', 13.0),
  std('IAD', 'Washington Dulles International', 'Dulles', 'US', 11.8, { dLat: 0.08, dLon: 0.1, radiusNm: 15 }),
  std('SAN', 'San Diego International', 'San Diego', 'US', 13.0),
  std('FLL', 'Fort Lauderdale–Hollywood International', 'Fort Lauderdale', 'US', 12.6),
  std('MDW', 'Chicago Midway International', 'Chicago Midway', 'US', 13.2),
  std('PDX', 'Portland International', 'Portland', 'US'),
  std('AUS', 'Austin–Bergstrom International', 'Austin', 'US'),
  std('BNA', 'Nashville International', 'Nashville', 'US'),
  apt('YYZ', 'Toronto Pearson International', 'Canada', 43.6777, -79.6248, 12.2, [
    station('YYZ', 'Toronto Pearson', 'tower', 'Tower'),
    station('YYZ', 'Toronto Pearson', 'ground', 'Ground'),
  ]),
  apt('YVR', 'Vancouver International', 'Canada', 49.1967, -123.1815, 12.2, [
    station('YVR', 'Vancouver', 'tower', 'Tower'),
    station('YVR', 'Vancouver', 'ground', 'Ground'),
  ]),
  apt('YUL', 'Montréal–Trudeau International', 'Canada', 45.4706, -73.7408, 12.2, [
    station('YUL', 'Montréal', 'tower', 'Tower'),
    station('YUL', 'Montréal', 'ground', 'Ground'),
  ]),
  apt('YYC', 'Calgary International', 'Canada', 51.1215, -114.0076, 12.1, [
    station('YYC', 'Calgary', 'tower', 'Tower'),
    station('YYC', 'Calgary', 'ground', 'Ground'),
  ]),
  apt('YEG', 'Edmonton International', 'Canada', 53.3097, -113.58, 12.0, [
    station('YEG', 'Edmonton', 'tower', 'Tower'),
    station('YEG', 'Edmonton', 'ground', 'Ground'),
  ]),
  std('YOW', 'Ottawa Macdonald–Cartier International', 'Ottawa', 'Canada'),
  std('YWG', 'Winnipeg Richardson International', 'Winnipeg', 'Canada'),
  std('YHZ', 'Halifax Stanfield International', 'Halifax', 'Canada'),
]

export const DEFAULT_AIRPORT = 'ORD'

const byIcao = new Map(AIRPORTS.map((a) => [a.icao, a]))

/** Case-insensitive lookup; unknown codes resolve to the default airport. */
export function getAirport(icao: string): AirportConfig {
  return byIcao.get(icao.toUpperCase()) ?? byIcao.get(DEFAULT_AIRPORT)!
}

export function getAirportBbox(icao: string): AirportBbox {
  return getAirport(icao).bbox
}

export function airportsByGroup(): Record<AirportGroup, AirportConfig[]> {
  return {
    US: AIRPORTS.filter((a) => a.group === 'US'),
    Canada: AIRPORTS.filter((a) => a.group === 'Canada'),
  }
}

export function allStations(): Station[] {
  return AIRPORTS.flatMap((a) => a.stations)
}

/** Find the airport that owns a station id (e.g. `ord-tower-28r` → ORD). */
export function airportForStation(stationId: string): AirportConfig | undefined {
  return AIRPORTS.find((a) => a.stations.some((s) => s.id === stationId))
}
