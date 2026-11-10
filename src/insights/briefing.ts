/**
 * The airport briefing: what is going on at the airport right now, in two or
 * three lines, from the live picture (traffic by phase, runways in use, the
 * weather, the last twenty minutes of the tower log).
 *
 * `buildBriefing` gathers the numbers (rounded, so that repeated asks within
 * a few minutes are identical and hit the AI cache), `fallbackBriefing` says
 * them with a template when no AI is available.
 */
import type { BriefingInput } from '../api/ai/tasks/airportBriefing'
import type { Aircraft, Atis, Metar } from '../api/types'
import { flightPhase } from '../flight/describe'
import { runwayRelation, type LiveEvent } from '../live/events'
import type { ActiveRunways } from '../live/runwayUse'
import type { RunwayEndGeometry } from '../map/airportDiagram'
import { describeSky, describeWeather, formatVisibility } from '../weather/decode'
import { forecastHeadline, localClock, windText, windsOnRunways, type Clock } from './weatherBrief'

export type TrafficCounts = BriefingInput['traffic']

/** The traffic list's groups, counted: arriving, departing, taxiing, parked, passing through. */
export function countTraffic(aircraft: Aircraft[], ends: RunwayEndGeometry[], elevationFt: number): TrafficCounts {
  const out: TrafficCounts = { arriving: 0, departing: 0, taxiing: 0, parked: 0, overflying: 0 }
  for (const a of aircraft) {
    // Tugs and service vehicles carry transponders too.
    if (a.category?.startsWith('C')) continue
    const phase = flightPhase({ ...a, altitudeFt: a.altitudeFt == null || a.onGround ? a.altitudeFt : a.altitudeFt - elevationFt })
    if (phase === 'parked') out.parked++
    else if (phase === 'taxiing' || phase === 'rolling') out.taxiing++
    else if (phase === 'final' || phase === 'descending' || runwayRelation(a, ends, elevationFt)?.kind === 'final') out.arriving++
    else if (phase === 'takeoff' || phase === 'climbing') out.departing++
    else out.overflying++
  }
  return out
}

/** Exact up to ten, then to the nearest five: "about 25" is all a briefing needs, and it keeps asks identical. */
export const roundCount = (n: number) => (n <= 10 ? n : Math.round(n / 5) * 5)

/** Morning, evening… at the airport, from the sun's clock (longitude), so no time-zone table is needed. */
export function partOfDay(now: number, lon: number): string {
  const h = (((new Date(now).getUTCHours() + new Date(now).getUTCMinutes() / 60 + lon / 15) % 24) + 24) % 24
  if (h < 5) return 'night'
  if (h < 9) return 'early morning'
  if (h < 12) return 'morning'
  if (h < 14) return 'midday'
  if (h < 17.5) return 'afternoon'
  if (h < 21.5) return 'evening'
  return 'night'
}

export type BriefingData = {
  airport: { icao: string; name: string; center: [number, number]; elevationFt: number }
  aircraft: Aircraft[]
  ends: RunwayEndGeometry[]
  /** Tower log, any order. */
  events: LiveEvent[]
  runways: ActiveRunways | null
  metar: Metar | null
  taf: string | null
  atis: Atis[]
  now: number
  clock?: Clock
}

/** How far back "recent" reaches. */
export const RECENT_MIN = 20

const ago = (ms: number) => {
  const min = Math.max(1, Math.round(ms / 60_000))
  return `${min} min ago`
}

export function buildBriefing(d: BriefingData): BriefingInput {
  const since = d.now - RECENT_MIN * 60_000
  const recent = d.events.filter((e) => e.at >= since && e.at <= d.now)
  const count = (k: LiveEvent['kind']) => recent.filter((e) => e.kind === k).length
  const traffic = countTraffic(d.aircraft, d.ends, d.airport.elevationFt)
  const m = d.metar
  const winds = windsOnRunways(m, d.ends, d.runways)
  const cross = [...winds].sort((a, b) => b.crosswindKt - a.crosswindKt)[0]
  const notable = [...recent]
    .filter((e) => e.kind === 'goaround' || e.kind === 'emergency')
    .sort((a, b) => b.at - a.at)
    .slice(0, 4)
    // Rounded to five minutes so the input (and the cached answer) doesn't change every minute.
    .map((e) => `${e.text.replace(/\.$/, '')} (${ago(Math.ceil((d.now - e.at) / 300_000) * 300_000)})`)
  const r = d.runways
  const useful = r && r.basis !== 'none'
  return {
    airport: d.airport.icao,
    name: d.airport.name,
    partOfDay: partOfDay(d.now, d.airport.center[0]),
    traffic: { arriving: roundCount(traffic.arriving), departing: roundCount(traffic.departing), taxiing: roundCount(traffic.taxiing), parked: roundCount(traffic.parked), overflying: roundCount(traffic.overflying) },
    recent: { windowMin: RECENT_MIN, landings: roundCount(count('landed')), takeoffs: roundCount(count('departed')), goArounds: count('goaround'), emergencies: count('emergency') },
    runways: {
      landing: useful ? (r.basis === 'wind' ? r.favoured : r.landing) : [],
      departing: useful && r.basis !== 'wind' ? r.departing : [],
      basis: r?.basis ?? 'none',
    },
    weather: m
      ? {
          category: m.flightCategory,
          wind: windText(m),
          visibility: formatVisibility(m.visibilitySm, m.visibilityPlus),
          sky: describeSky(m.clouds),
          weather: describeWeather(m.weather),
          crosswind: cross && cross.crosswindKt >= 8 ? `${cross.crosswindKt} kt on ${cross.ident}` : null,
        }
      : null,
    forecast: forecastHeadline(d.taf, d.now, d.clock ?? localClock),
    atis: d.atis.length ? d.atis.map((a) => `Information ${a.code}: ${a.text}`).join(' ').slice(0, 500) : null,
    notable,
  }
}

const join = (list: string[]) => (list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The template briefing, used without AI (and while the AI answers). */
export function fallbackBriefing(b: BriefingInput): string {
  const t = b.traffic
  const moving = t.arriving + t.departing + t.taxiing
  const out: string[] = []

  // How busy, and with what.
  const mood = moving >= 25 ? 'Busy' : moving >= 10 ? 'Steady traffic' : moving >= 3 ? 'Light traffic' : 'Quiet'
  const parts = [t.arriving && `${t.arriving} arriving`, t.departing && `${t.departing} departing`, t.taxiing && `${t.taxiing} taxiing`].filter((x): x is string => !!x)
  out.push(parts.length ? `${mood} ${b.partOfDay} at ${b.airport}: ${join(parts)}.` : `Quiet at ${b.airport} right now, with nothing moving.`)

  // Runways.
  const rw = b.runways
  if (rw.basis === 'wind' && rw.landing.length) out.push(`The wind favours runway${rw.landing.length > 1 ? 's' : ''} ${join(rw.landing)}.`)
  else if (rw.landing.length || rw.departing.length) {
    const same = rw.landing.length && rw.landing.join() === rw.departing.join()
    if (same) out.push(`Landing and departing ${join(rw.landing)}.`)
    else out.push([rw.landing.length ? `Landing ${join(rw.landing)}` : '', rw.departing.length ? `departing ${join(rw.departing)}` : ''].filter(Boolean).join(', ').replace(/^d/, 'D') + '.')
  }

  // Weather, only as it affects flying.
  const w = b.weather
  if (w) {
    const bits: string[] = []
    if (w.category === 'IFR' || w.category === 'LIFR') bits.push(`${w.sky ?? 'Low cloud'}, so arrivals are on instruments`)
    if (w.wind && /gusting|at (?:[2-9]\d|1[5-9]) kt/.test(w.wind)) bits.push(`wind ${w.wind}`)
    if (w.crosswind && Number.parseInt(w.crosswind, 10) >= 15) bits.push(`a ${w.crosswind.replace(' on ', ' crosswind on ')}`)
    if (w.weather && /thunder|snow|freezing|fog/i.test(w.weather)) bits.push(w.weather.toLowerCase())
    if (bits.length) out.push(`${bits.join(', ').replace(/^./, (c) => c.toUpperCase())}.`)
    else if (w.category === 'VFR') out.push(`Good flying weather${w.wind ? `, wind ${w.wind}` : ''}.`)
  }
  if (b.forecast) out.push(`${b.forecast}.`)

  // Anything unusual lately.
  if (b.notable.length) out.push(`${b.notable[0]}.`)
  else if (b.recent.goArounds || b.recent.emergencies) out.push(`In the last ${b.recent.windowMin} minutes: ${join([b.recent.goArounds ? plural(b.recent.goArounds, 'go-around') : '', b.recent.emergencies ? plural(b.recent.emergencies, 'emergency', 'emergencies') : ''].filter(Boolean))}.`)

  return out.slice(0, 4).join(' ')
}
