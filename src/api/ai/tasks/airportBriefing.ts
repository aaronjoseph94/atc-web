/**
 * The airport briefing: two or three sentences on what is going on at the
 * airport right now (how busy, which runways, what the weather is doing to
 * operations, anything unusual), from the live numbers the app worked out.
 * The browser rounds its inputs, so the answer is cached for ten minutes and
 * repeated opens of the same airport share it.
 */
import type { AiTask } from '../tasks'
import { arr, facts, need, num, obj, objectSchema, str } from './inputs'

export type BriefingInput = {
  airport: string
  name: string
  partOfDay: string
  traffic: { arriving: number; departing: number; taxiing: number; parked: number; overflying: number }
  recent: { windowMin: number; landings: number; takeoffs: number; goArounds: number; emergencies: number }
  runways: { landing: string[]; departing: string[]; basis: string }
  weather: { category: string | null; wind: string | null; visibility: string | null; sky: string | null; weather: string | null; crosswind: string | null } | null
  forecast: string | null
  atis: string | null
  notable: string[]
}

export type BriefingResult = { summary: string }

const list = (v: unknown) => arr(v, 6).map((x) => str(x, 8)).filter(Boolean)

export const airportBriefing: AiTask<BriefingInput> = {
  name: 'airportBriefing',
  system: [
    'You write the live briefing card of an air traffic control listening app: two or three short sentences (at most 55 words) telling someone who just opened an airport what is going on there right now.',
    'Cover, in this order and only when the data supports it: how busy it is and with what (arrivals, departures), the runway configuration ("landing 28C and 27R, departing 28R"), and the weather only as it affects operations (gusty crosswind, low cloud meaning instrument approaches, a change on the way). End with anything unusual from the notable list (go-arounds, emergencies).',
    'Use ONLY the facts given. Never invent numbers, airlines, reasons, delays or runway names. If the runway basis is "wind", say the wind favours those runways rather than that they are in use. If traffic counts are small, say it is quiet. Numbers are approximate counts of aircraft visible on the map near the airport.',
    'Tone: a knowledgeable friend, plain English, no jargon without a hint of its meaning, no markdown, no exclamation marks, no greeting. Use the airport code as given.',
  ].join('\n'),
  prompt: (input) => {
    const i = obj(input)
    const t = obj(i.traffic)
    const r = obj(i.recent)
    const rw = obj(i.runways)
    const w = i.weather ? obj(i.weather) : null
    return facts([
      ['Airport', `${need(i.airport, 8, 'airport')} (${str(i.name, 80)})`],
      ['Local part of day', str(i.partOfDay, 20)],
      ['On the map now', `${num(t.arriving) ?? 0} arriving, ${num(t.departing) ?? 0} departing, ${num(t.taxiing) ?? 0} taxiing, ${num(t.parked) ?? 0} parked, ${num(t.overflying) ?? 0} passing overhead`],
      [`Last ${num(r.windowMin) ?? 20} minutes`, `${num(r.landings) ?? 0} landings, ${num(r.takeoffs) ?? 0} takeoffs, ${num(r.goArounds) ?? 0} go-arounds, ${num(r.emergencies) ?? 0} emergencies`],
      ['Landing runways', list(rw.landing)],
      ['Departure runways', list(rw.departing)],
      ['Runway basis', str(rw.basis, 10)],
      ['Flight category', w && str(w.category, 6)],
      ['Wind', w && str(w.wind, 60)],
      ['Crosswind on runways in use', w && str(w.crosswind, 80)],
      ['Visibility', w && str(w.visibility, 30)],
      ['Sky', w && str(w.sky, 60)],
      ['Weather', w && str(w.weather, 60)],
      ['Forecast', str(i.forecast, 160)],
      ['ATIS', str(i.atis, 500)],
      ['Notable recent events', arr(i.notable, 5).map((x) => str(x, 120)).filter(Boolean).join(' | ')],
    ])
  },
  schema: objectSchema({ summary: { type: 'string' } }),
  effort: 'low',
  maxTokens: 2500,
  timeoutMs: 25_000,
  cacheS: 600,
  maxInputChars: 4000,
}
