/**
 * Flight story: a short paragraph of this flight's life at the airport so
 * far, from the phases the app watched (pushback, taxi, takeoff… or
 * approach, touchdown, gate), the tower log and any radio calls. Cached
 * briefly; the browser asks again only when a new phase or call arrives.
 */
import type { AiTask } from '../tasks'
import { arr, facts, need, obj, objectSchema, str } from './inputs'

export type FlightStoryInput = {
  callsign: string
  flight: string | null
  airline: string | null
  aircraft: string | null
  from: string | null
  to: string | null
  airport: string
  role: string
  steps: { time: string; what: string; runway: string | null }[]
  events: { time: string; text: string }[]
  radio: { time: string; speaker: string; text: string }[]
  now: string | null
}

export type FlightStoryResult = { story: string }

export const flightStory: AiTask<FlightStoryInput> = {
  name: 'flightStory',
  system: [
    'You write the "story so far" of one flight at an airport for an air traffic control listening app: a single short paragraph of two to four sentences (at most 70 words), past tense for what happened and present tense for what it is doing now.',
    'Tell it in order, using the times given, e.g. "United 1534, an Airbus A320 bound for Denver, pushed back at 14:02 and taxied out to runway 28R, where it waited on the runway for a landing to clear. It was airborne at 14:19 and is climbing away."',
    'Use ONLY the phases, events and radio calls given. Never invent times, runways, gates, reasons, passengers or destinations. If radio calls are given, weave in what the controller asked in plain words (explain jargon such as "line up and wait" as waiting on the runway). If little is known, keep it to one or two sentences.',
    'Plain English, no markdown, no headings, no quotes longer than five words.',
  ].join('\n'),
  prompt: (input) => {
    const i = obj(input)
    const steps = arr(i.steps, 16)
      .map(obj)
      .map((s) => `- ${str(s.time, 10)} ${str(s.what, 40)}${s.runway ? ` (runway ${str(s.runway, 6)})` : ''}`)
    const events = arr(i.events, 8)
      .map(obj)
      .map((e) => `- ${str(e.time, 10)} ${str(e.text, 140)}`)
    const radio = arr(i.radio, 10)
      .map(obj)
      .map((r) => `- ${str(r.time, 10)} ${str(r.speaker, 12) || 'radio'}: "${str(r.text, 200)}"`)
    return [
      facts([
        ['Callsign', need(i.callsign, 12, 'callsign')],
        ['Flight', str(i.flight, 60)],
        ['Airline', str(i.airline, 60)],
        ['Aircraft', str(i.aircraft, 60)],
        ['From', str(i.from, 60)],
        ['To', str(i.to, 60)],
        ['This airport', str(i.airport, 8)],
        ['Role here', str(i.role, 16)],
        ['Doing now', str(i.now, 160)],
      ]),
      steps.length ? `Phases seen (oldest first):\n${steps.join('\n')}` : 'Phases seen: none yet',
      events.length ? `Tower log:\n${events.join('\n')}` : '',
      radio.length ? `Radio calls:\n${radio.join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  },
  schema: objectSchema({ story: { type: 'string' } }),
  effort: 'low',
  maxTokens: 2500,
  timeoutMs: 25_000,
  cacheS: 180,
  maxInputChars: 8000,
}
