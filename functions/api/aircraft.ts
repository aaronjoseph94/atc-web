import { fetchAircraftForAirport, jsonResponse } from '../../src/api/aircraftHandler'

type PagesContext = {
  request: Request
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const url = new URL(context.request.url)
  const airport = url.searchParams.get('airport') ?? 'ORD'
  try {
    const aircraft = await fetchAircraftForAirport(airport)
    return jsonResponse(aircraft)
  } catch {
    return jsonResponse([], 200, 'public, max-age=4')
  }
}
