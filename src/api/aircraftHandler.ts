import { getAirportBbox } from './airports'
import { normalizeOpenSkyStates, type OpenSkyState } from './normalizeAircraft'
import type { Aircraft } from './types'

export async function fetchAircraftForAirport(airport: string): Promise<Aircraft[]> {
  const bbox = getAirportBbox(airport)
  const url =
    `https://opensky-network.org/api/states/all` +
    `?lamin=${bbox.lamin}&lomin=${bbox.lomin}&lamax=${bbox.lamax}&lomax=${bbox.lomax}`

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`OpenSky ${res.status}`)
  }
  const data = (await res.json()) as { states?: OpenSkyState[] | null }
  return normalizeOpenSkyStates(data.states)
}

export function jsonResponse(body: unknown, status = 200, cache = 'public, max-age=8') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cache,
      'Access-Control-Allow-Origin': '*',
    },
  })
}
