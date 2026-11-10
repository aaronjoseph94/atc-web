/**
 * Route and context facts for the flight detail. The browser works out the
 * facts itself (route distance, aircraft type figures, how often this flight
 * number was seen today, who operates it); the model only picks the most
 * interesting ones and words them nicely. It must not add anything.
 */
import type { AiTask } from '../tasks'
import { arr, need, obj, objectSchema, str } from './inputs'

export type FlightFactsInput = { callsign: string; facts: { id: string; text: string }[] }
export type FlightFactsResult = { facts: { id: string; text: string }[] }

export const flightFacts: AiTask<FlightFactsInput> = {
  name: 'flightFacts',
  system: [
    'You choose and phrase "did you know" facts about one flight for an air traffic control listening app.',
    'You are given a list of verified facts, each with an id. Pick the one to three most interesting for a curious listener and rewrite each as one short, friendly sentence (at most 22 words).',
    'STRICT RULES: use only the information in the facts given; keep every number, name and unit exactly as given (you may round only by saying "about"); never add facts from your own knowledge, never speculate, never combine facts into a new claim. Return each fact with the id it came from. Plain English, no markdown, no exclamation marks.',
  ].join('\n'),
  prompt: (input) => {
    const i = obj(input)
    const list = arr(i.facts, 8)
      .map(obj)
      .map((f) => ({ id: str(f.id, 24), text: str(f.text, 200) }))
      .filter((f) => f.id && f.text)
    if (!list.length) throw new Error('No facts given')
    return [`Flight: ${need(i.callsign, 12, 'callsign')}`, 'Facts:', ...list.map((f) => `- [${f.id}] ${f.text}`)].join('\n')
  },
  schema: objectSchema({ facts: { type: 'array', items: objectSchema({ id: { type: 'string' }, text: { type: 'string' } }) } }),
  effort: 'low',
  maxTokens: 2000,
  timeoutMs: 20_000,
  cacheS: 6 * 3600,
  maxInputChars: 3000,
}
