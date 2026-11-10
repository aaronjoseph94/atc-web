/**
 * Learn mode, for words the built-in glossary doesn't have: a short
 * plain-English explanation of one aviation or ATC term. Keyed by the term
 * alone, so the answer is cached for a month and shared by everyone.
 */
import type { AiTask } from '../tasks'
import { need, objectSchema } from './inputs'

export type ExplainTermInput = { term: string }
export type ExplainTermResult = { explanation: string; known: boolean }

export const explainTerm: AiTask<ExplainTermInput> = {
  name: 'explainTerm',
  system: [
    'You explain air traffic control and aviation terms to curious non-pilots who are listening to live tower radio and reading airport weather.',
    'Answer in plain English, in one to three short sentences (at most 60 words). No markdown, no lists, no preamble, do not repeat the term as a heading.',
    'Say what it means and, when useful, why pilots or controllers use it. Use North American usage first, and mention the ICAO/international equivalent only if it differs in a way listeners will hear.',
    'Be accurate. If the term is not a real aviation, ATC or aviation-weather term you recognise (or is a proper name such as a waypoint, airline callsign or person), set "known" to false and say briefly that it is not a standard term, suggesting what it might be only if that is very likely. Never invent a definition.',
  ].join('\n'),
  prompt: (input) => `Term: "${need(input?.term, 60, 'term')}"`,
  schema: objectSchema({ explanation: { type: 'string' }, known: { type: 'boolean' } }),
  effort: 'low',
  maxTokens: 2000,
  timeoutMs: 20_000,
  cacheS: 30 * 86_400,
  maxInputChars: 200,
}
