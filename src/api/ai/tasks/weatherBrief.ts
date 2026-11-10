/**
 * Weather made readable: one or two sentences on what the current METAR,
 * forecast and ATIS mean in practice for aircraft and for people watching
 * ("fog lifting by 10am; a crosswind on 31L strong enough that pilots will
 * notice"). Cached for fifteen minutes per airport and report.
 */
import type { AiTask } from '../tasks'
import { arr, facts, need, num, obj, objectSchema, str } from './inputs'

export type WeatherBriefInput = {
  airport: string
  metar: string | null
  decoded: { category: string | null; wind: string | null; visibility: string | null; sky: string | null; weather: string | null; temperature: string | null }
  forecast: { from: string; to: string; kind: string; text: string }[]
  atis: string | null
  runways: string[]
  winds: { runway: string; headKt: number; crossKt: number }[]
}

export type WeatherBriefResult = { summary: string }

export const weatherBrief: AiTask<WeatherBriefInput> = {
  name: 'weatherBrief',
  system: [
    "You explain what an airport's weather means in practice, for plane spotters and people listening to air traffic control, in one or two short sentences (at most 45 words).",
    'Focus on impact, not a recital of numbers: whether pilots are landing by sight or on instruments, crosswind or gusts pilots will notice on the runways in use (above about 15 kt of crosswind is notable, above 25 kt is strong), tailwind, low visibility or fog, storms, icing or snow, and how the forecast changes it (improving, worsening, by when). If it is simply good flying weather, say so in a few words.',
    "Use ONLY the reports and numbers given. Times in the raw METAR/TAF/ATIS are UTC; the forecast list gives the same periods in the viewer's local clock, and you must use those local times. Never invent conditions or times. Plain English, no markdown, no jargon unless explained in passing.",
  ].join('\n'),
  prompt: (input) => {
    const i = obj(input)
    const d = obj(i.decoded)
    const periods = arr(i.forecast, 8)
      .map(obj)
      .map((p) => `- ${str(p.from, 10)}–${str(p.to, 10)} ${str(p.kind, 12)}: ${str(p.text, 140)}`)
    const winds = arr(i.winds, 6)
      .map(obj)
      .map((w) => `${str(w.runway, 6)} headwind ${num(w.headKt) ?? 0} kt, crosswind ${num(w.crossKt) ?? 0} kt`)
    return [
      `Airport: ${need(i.airport, 8, 'airport')}`,
      facts([
        ['Flight category', str(d.category, 6)],
        ['Wind', str(d.wind, 60)],
        ['Visibility', str(d.visibility, 30)],
        ['Sky', str(d.sky, 60)],
        ['Weather', str(d.weather, 60)],
        ['Temperature', str(d.temperature, 40)],
        ['Runways in use', arr(i.runways, 6).map((x) => str(x, 6))],
        ['Wind on those runways', winds],
        ['Raw METAR', str(i.metar, 300)],
        ['ATIS', str(i.atis, 700)],
      ]),
      periods.length ? `Forecast periods (viewer's local time):\n${periods.join('\n')}` : 'Forecast: none issued',
    ].join('\n')
  },
  schema: objectSchema({ summary: { type: 'string' } }),
  effort: 'low',
  maxTokens: 2500,
  timeoutMs: 25_000,
  cacheS: 900,
  maxInputChars: 6000,
}
