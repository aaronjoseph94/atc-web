/**
 * Smart alerts: one line on why an unusual event (a go-around, an emergency
 * squawk, a rejected takeoff) probably happened, but only from what the
 * radio or the weather actually says. Otherwise it says the reason wasn't
 * given, so an alert never carries a made-up story.
 */
import type { AiTask } from '../tasks'
import { arr, facts, need, obj, objectSchema, str } from './inputs'

export type ExplainAlertInput = {
  kind: string
  title: string
  detail: string
  callsign: string | null
  aircraft: string | null
  runway: string | null
  radio: { time: string; speaker: string; text: string }[]
  weather: string | null
}

export type ExplainAlertResult = { why: string; basis: 'radio' | 'weather' | 'none' }

export const explainAlert: AiTask<ExplainAlertInput> = {
  name: 'explainAlert',
  system: [
    'You add one short line (at most 22 words) to an alert in an air traffic control listening app, explaining why the event most likely happened.',
    'Base it ONLY on the radio calls and weather given. If a radio call states or clearly implies the reason (e.g. "going around, wind shear", "traffic on the runway", "engine failure"), say it plainly and set basis to "radio". If the radio is silent but the weather given is a common cause (strong gusts, low cloud at minimums), say it is consistent with that weather and set basis to "weather".',
    'Otherwise set basis to "none" and say the reason was not given on the frequency, adding at most a few words of neutral context (e.g. that go-arounds are routine). Never invent a cause, a fault, a medical issue or a quote. Plain English, no markdown, no speculation about people.',
  ].join('\n'),
  prompt: (input) => {
    const i = obj(input)
    const radio = arr(i.radio, 6)
      .map(obj)
      .map((r) => `- ${str(r.time, 8)} ${str(r.speaker, 12) || 'radio'}: "${str(r.text, 200)}"`)
    return [
      facts([
        ['Event', `${need(i.kind, 16, 'kind')}: ${str(i.title, 100)}`],
        ['Detail', str(i.detail, 200)],
        ['Callsign', str(i.callsign, 12)],
        ['Aircraft', str(i.aircraft, 60)],
        ['Runway', str(i.runway, 8)],
        ['Weather', str(i.weather, 200)],
      ]),
      radio.length ? `Radio calls by or to this aircraft around then:\n${radio.join('\n')}` : 'Radio calls: none transcribed',
    ].join('\n')
  },
  schema: objectSchema({ why: { type: 'string' }, basis: { type: 'string', enum: ['radio', 'weather', 'none'] } }),
  effort: 'low',
  maxTokens: 2000,
  timeoutMs: 20_000,
  cacheS: 3600,
  maxInputChars: 4000,
}
