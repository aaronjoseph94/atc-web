/**
 * Shared logic for `GET /api/flight` (Pages Function + Vite dev plugin).
 *
 * Looks up where a flight is going and what the airframe is, from two free,
 * key-less community databases:
 *  - adsbdb.com: scheduled route for a callsign + airframe details for a
 *    transponder address, in one request.
 *  - airport-data.com: a thumbnail of the airframe with the photographer's
 *    name and a link back (both are shown, as the site asks).
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
          url_photo_thumbnail?: string | null
        }
        flightroute?: {
          callsign?: string
          airline?: { name?: string }
          origin?: AdsbdbAirport
          destination?: AdsbdbAirport
        }
      }
}

export type AirportDataThumb = { data?: { image?: string; link?: string; photographer?: string }[] }

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

/** Only https images from the two hosts we expect are passed to the browser. */
function safeImage(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && /(^|\.)airport-data\.com$/.test(u.hostname) ? u.href : null
  } catch {
    return null
  }
}

/** Merge the two upstream payloads into one `FlightInfo`. Pure; unit-tested. */
export function buildFlightInfo(
  callsign: string | null,
  db: AdsbdbResponse | null,
  thumb: AirportDataThumb | null,
): FlightInfo {
  const r = db && typeof db.response === 'object' ? db.response : undefined
  const ac = r?.aircraft
  const route = r?.flightroute
  const credited = thumb?.data?.[0]
  const creditedImage = safeImage(credited?.image)
  const fallbackImage = safeImage(ac?.url_photo_thumbnail)

  return {
    callsign: route?.callsign ?? callsign,
    airline: route?.airline?.name || null,
    origin: routeAirport(route?.origin),
    destination: routeAirport(route?.destination),
    typeName: ac?.type || null,
    manufacturer: ac?.manufacturer || null,
    registration: ac?.registration || null,
    owner: ac?.registered_owner || null,
    photo: creditedImage
      ? { thumbnail: creditedImage, link: credited?.link || null, photographer: credited?.photographer || null }
      : fallbackImage
        ? { thumbnail: fallbackImage, link: 'https://www.airport-data.com/', photographer: null }
        : null,
  }
}

/** Fetch route + airframe + photo. Never throws; unknown parts come back null. */
export async function fetchFlightInfo(hex: string | null, callsign: string | null): Promise<FlightInfo> {
  const dbUrl = hex
    ? `https://api.adsbdb.com/v0/aircraft/${hex}${callsign ? `?callsign=${callsign}` : ''}`
    : callsign
      ? `https://api.adsbdb.com/v0/callsign/${callsign}`
      : null

  const [db, thumb] = await Promise.all([
    dbUrl
      ? getJson<AdsbdbResponse>(dbUrl, AbortSignal.timeout(TIMEOUT_MS)).catch(() =>
          // adsbdb 404s the whole request when the airframe is unknown; the route may still exist.
          hex && callsign
            ? getJson<AdsbdbResponse>(`https://api.adsbdb.com/v0/callsign/${callsign}`, AbortSignal.timeout(TIMEOUT_MS)).catch(
                () => null,
              )
            : null,
        )
      : Promise.resolve(null),
    hex
      ? getJson<AirportDataThumb>(
          `https://airport-data.com/api/ac_thumb.json?m=${hex}&n=1`,
          AbortSignal.timeout(TIMEOUT_MS),
        ).catch(() => null)
      : Promise.resolve(null),
  ])

  return buildFlightInfo(callsign, db, thumb)
}
