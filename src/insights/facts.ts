/**
 * Route and context facts for the flight detail, worked out only from data
 * the app actually has: the route's distance, who operates the flight, the
 * aircraft type's published figures, and how often this flight and its
 * airline have been seen here today (from the history). The `flightFacts` AI
 * task may reword and pick among these, never add to them.
 */
import type { FlightInfo, RouteAirport } from '../api/types'
import { airlineInfo, flightDesignator, parseCallsign } from '../airline/airlines'
import type { TypeFacts } from '../aircraft/types'
import { greatCircleNm } from '../flight/route'
import type { HistoryEntry } from '../live/history/store'

export type Fact = { id: string; text: string }

const place = (a: RouteAirport) => {
  const code = a.iata ?? a.icao
  const city = a.city ?? a.name
  return city && code ? `${city} (${code})` : (code ?? city ?? '')
}

const KM_PER_NM = 1.852

export type FactsData = {
  callsign: string
  info: FlightInfo | null | undefined
  /** Best name for the aircraft ("Boeing 737-800"). */
  aircraftTitle: string | null
  typeFacts: TypeFacts | null
  airport: string
  /** This airport's history (last 24 h), any order. */
  history: HistoryEntry[]
  icao24: string
  now: number
}

/** Everything we can say for sure, most interesting first. */
export function buildFacts(d: FactsData): Fact[] {
  const out: Fact[] = []
  const o = d.info?.origin
  const t = d.info?.destination

  // The route, and how far it is.
  if (o && t && o.lat != null && o.lon != null && t.lat != null && t.lon != null) {
    const nm = greatCircleNm({ lat: o.lat, lon: o.lon }, { lat: t.lat, lon: t.lon })
    if (nm > 20) {
      const r = (n: number) => (n >= 1000 ? Math.round(n / 10) * 10 : Math.round(n)).toLocaleString('en-US')
      out.push({ id: 'route', text: `${place(o)} to ${place(t)} is about ${r(nm)} nautical miles (${r(nm * KM_PER_NM)} km) in a straight line.` })
    }
  }

  // Who flies it: a regional airline flying for a mainline brand.
  const des = flightDesignator(d.callsign)
  if (des?.operator && des.operator.icao !== des.brand.icao) out.push({ id: 'operator', text: `${des.operator.name} operates this flight for ${des.brand.name}; passengers know it as ${des.text}.` })
  else if (des) out.push({ id: 'designator', text: `On tickets and departure boards, ${d.callsign} is flight ${des.text}.` })

  // The aircraft type's published figures.
  const f = d.typeFacts
  if (f) {
    const name = d.aircraftTitle ?? `${f.manufacturer} ${f.name}`
    const bits = [f.seats ? `seats ${f.seats} passengers` : null, f.rangeNm ? `can fly about ${f.rangeNm.toLocaleString('en-US')} nautical miles` : null].filter(Boolean)
    if (f.firstFlight) out.push({ id: 'typeAge', text: `The ${name} first flew in ${f.firstFlight}.` })
    if (bits.length) out.push({ id: 'typeSize', text: `A typical ${name} ${bits.join(' and ')}.` })
    if (f.spanM && f.lengthM) out.push({ id: 'typeDims', text: `The ${name} is ${f.lengthM} m long with a ${f.spanM} m wingspan.` })
  }

  // Seen here today: this flight's own calls and movements, and its airline's other flights.
  const since = d.now - 24 * 3_600_000
  const today = d.history.filter((e) => e.airport === d.airport && e.at >= since)
  const mine = today.filter((e) => e.ids.includes(d.icao24) || e.callsigns.includes(d.callsign))
  const calls = mine.filter((e) => e.source === 'radio').length
  const moves = mine.filter((e) => e.source === 'event' && (e.eventKind === 'landed' || e.eventKind === 'departed')).length
  if (calls >= 2) out.push({ id: 'heard', text: `${d.callsign} has been heard on the radio here ${calls} times in the last 24 hours${moves ? `, with ${moves} takeoff${moves === 1 ? '' : 's'} or landing${moves === 1 ? '' : 's'} logged` : ''}.` })
  const prefix = parseCallsign(d.callsign)?.prefix
  const airline = airlineInfo(prefix)
  if (prefix && airline) {
    const flights = new Set(today.filter((e) => e.source === 'event').flatMap((e) => e.callsigns).filter((c) => c.startsWith(prefix) && /^\D{3}\d/.test(c)))
    flights.delete(d.callsign)
    if (flights.size >= 3) out.push({ id: 'airlineToday', text: `${flights.size} other ${airline.name} flights have taken off or landed here in the last 24 hours (that the app saw).` })
  }

  // The airframe's registration and owner when the database has them and they say something.
  const reg = d.info?.registration
  const owner = d.info?.owner
  if (reg && owner && airline && !owner.toLowerCase().includes(airline.name.toLowerCase().split(' ')[0])) out.push({ id: 'owner', text: `The airframe, ${reg}, is registered to ${owner}.` })
  return out
}
