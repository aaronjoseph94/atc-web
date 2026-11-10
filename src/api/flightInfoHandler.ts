/**
 * Shared logic for `GET /api/flight` (Pages Function + Vite dev plugin).
 *
 * Looks up where a flight is going and what the airframe is, from adsbdb.com,
 * a free, key-less community database: the scheduled route for a callsign and
 * the airframe details for a transponder address, in one request.
 *
 * Routes come from schedules, not from the aircraft, so they can be wrong for
 * diversions or re-used flight numbers; the UI labels them "scheduled".
 */
import { getJson } from './aircraftHandler'
import type { FlightInfo, RouteAirport } from './types'

const TIMEOUT_MS = 6000

type AdsbdbAirport = {
  iata_code?: string
  icao_code?: string
  name?: string
  municipality?: string
  latitude?: number
  longitude?: number
}

export type AdsbdbResponse = {
  response?:
    | string
    | {
        aircraft?: {
          type?: string
          manufacturer?: string
          registration?: string
          registered_owner?: string
        }
        flightroute?: {
          callsign?: string
          airline?: { name?: string }
          origin?: AdsbdbAirport
          destination?: AdsbdbAirport
        }
      }
}

const HEX = /^[0-9a-f]{6}$/
const CALLSIGN = /^[A-Z0-9]{3,8}$/

/** Sanitize query input; anything that isn't a plausible id becomes null. */
export function parseFlightQuery(hex: string | null, callsign: string | null) {
  const h = (hex ?? '').trim().toLowerCase()
  const c = (callsign ?? '').trim().toUpperCase()
  return {
    hex: HEX.test(h) ? h : null,
    // A callsign equal to the hex is our "unknown callsign" fallback, not a flight number.
    callsign: CALLSIGN.test(c) && c.toLowerCase() !== h ? c : null,
  }
}

function routeAirport(a: AdsbdbAirport | undefined): RouteAirport | null {
  if (!a || (!a.iata_code && !a.icao_code)) return null
  return {
    iata: a.iata_code || null,
    icao: a.icao_code || null,
    name: a.name || null,
    city: a.municipality || null,
    lat: typeof a.latitude === 'number' ? a.latitude : null,
    lon: typeof a.longitude === 'number' ? a.longitude : null,
  }
}

/** Turn the upstream payload into a `FlightInfo`. Pure; unit-tested. */
export function buildFlightInfo(callsign: string | null, db: AdsbdbResponse | null): FlightInfo {
  const r = db && typeof db.response === 'object' ? db.response : undefined
  const ac = r?.aircraft
  const route = r?.flightroute

  return {
    callsign: route?.callsign ?? callsign,
    airline: route?.airline?.name || null,
    origin: routeAirport(route?.origin),
    destination: routeAirport(route?.destination),
    typeName: ac?.type || null,
    manufacturer: ac?.manufacturer || null,
    registration: ac?.registration || null,
    owner: ac?.registered_owner || null,
  }
}

/** Fetch route + airframe. Never throws; unknown parts come back null. */
export async function fetchFlightInfo(hex: string | null, callsign: string | null): Promise<FlightInfo> {
  const dbUrl = hex
    ? `https://api.adsbdb.com/v0/aircraft/${hex}${callsign ? `?callsign=${callsign}` : ''}`
    : callsign
      ? `https://api.adsbdb.com/v0/callsign/${callsign}`
      : null
  const db = dbUrl
    ? await getJson<AdsbdbResponse>(dbUrl, AbortSignal.timeout(TIMEOUT_MS)).catch(() =>
        // adsbdb 404s the whole request when the airframe is unknown; the route may still exist.
        hex && callsign ? getJson<AdsbdbResponse>(`https://api.adsbdb.com/v0/callsign/${callsign}`, AbortSignal.timeout(TIMEOUT_MS)).catch(() => null) : null,
      )
    : null
  return buildFlightInfo(callsign, db)
}
