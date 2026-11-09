/** GET /api/stations — static catalog of controller positions for every airport. */
import { jsonResponse } from '../../src/api/aircraftHandler'
import { allStations } from '../../src/api/airports'

export const onRequestGet: PagesFunction = async () => {
  return jsonResponse(allStations(), 200, 'public, max-age=3600')
}
