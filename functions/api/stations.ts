import { STATIONS } from '../../src/api/stations'
import { jsonResponse } from '../../src/api/aircraftHandler'

export async function onRequestGet(): Promise<Response> {
  return jsonResponse(STATIONS, 200, 'public, max-age=3600')
}
