import type { Station } from './types'

export type AirportGroup = 'US' | 'Canada'

export type AirportBbox = {
  lamin: number
  lomin: number
  lamax: number
  lomax: number
}

export type AirportConfig = {
  icao: string
  name: string
  group: AirportGroup
  center: [number, number]
  zoom: number
  bbox: AirportBbox
  stations: Station[]
}

function station(airport: string, name: string, suffix: string, label: string): Station {
  return {
    id: `${airport.toLowerCase()}-${suffix}`,
    airport,
    name,
    label,
  }
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
  pad?: { dLat?: number; dLon?: number },
): AirportConfig {
  return {
    icao,
    name,
    group,
    center: [lon, lat],
    zoom,
    bbox: bboxAround(lat, lon, pad?.dLat, pad?.dLon),
    stations,
  }
}

/** Static free airport catalog — bbox/center for OpenSky + map camera. */
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
  ], { dLat: 0.08, dLon: 0.1 }),
  apt('DEN', 'Denver International', 'US', 39.8561, -104.6737, 11.7, [
    station('DEN', 'Denver', 'tower', 'Tower'),
    station('DEN', 'Denver', 'ground', 'Ground'),
  ], { dLat: 0.08, dLon: 0.1 }),
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
]

export const DEFAULT_AIRPORT = 'ORD'

const byIcao = new Map(AIRPORTS.map((a) => [a.icao, a]))

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
