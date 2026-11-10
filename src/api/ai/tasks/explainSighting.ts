/**
 * One line on why an aircraft spotted near an airport is worth a look
 * (src/discovery). Asked once per type and airport, and cached for a day,
 * so the input carries nothing about the individual flight beyond whether it
 * is military: never a registration, never anything about who is aboard.
 */
import type { AiTask } from '../tasks'

export type ExplainSightingInput = {
  /** ICAO type designator, e.g. `A124`. */
  type: string
  /** Everyday name, e.g. `Antonov An-124 Ruslan`. */
  name: string
  /** Airport code as the app shows it, e.g. `ORD`. */
  airport: string
  airportName: string
  /** `gateway` (long-haul hub), `hub` (mostly narrow-body) or `slot` (short-haul only). */
  airportClass: string
  /** Why the app's rules flagged it, e.g. "Rare here", "Military: US Air Mobility Command (Reach)". */
  reasons: string[]
}

export type ExplainSightingResult = { line: string }

const MAX_LINE = 180

export function buildExplainSightingPrompt(input: ExplainSightingInput): string {
  if (!input || typeof input.type !== 'string' || !/^[A-Z0-9]{2,4}$/i.test(input.type)) throw new Error('type must be an ICAO type designator')
  if (typeof input.airport !== 'string' || !/^[A-Z0-9]{3,4}$/i.test(input.airport)) throw new Error('airport must be an airport code')
  const reasons = (Array.isArray(input.reasons) ? input.reasons : []).filter((r) => typeof r === 'string').slice(0, 6).map((r) => r.slice(0, 120))
  return [
    `Aircraft type: ${input.type.toUpperCase()} (${String(input.name ?? '').slice(0, 80)})`,
    `Airport: ${input.airport.toUpperCase()}, ${String(input.airportName ?? '').slice(0, 80)} (kind: ${String(input.airportClass ?? 'hub').slice(0, 10)})`,
    `Flagged because: ${reasons.join('; ') || 'unusual type here'}`,
    '',
    'Write the line.',
  ].join('\n')
}

/** Keep only a sensible single line; null when the answer is unusable. */
export function parseExplainSighting(json: unknown): ExplainSightingResult | null {
  const line = (json as { line?: unknown } | null)?.line
  if (typeof line !== 'string') return null
  const one = line.replace(/\s+/g, ' ').trim()
  if (one.length < 8) return null
  return { line: one.length > MAX_LINE ? `${one.slice(0, MAX_LINE - 1).trimEnd()}…` : one }
}

export const explainSighting: AiTask<ExplainSightingInput> = {
  name: 'explainSighting',
  system: [
    'You write one short line for aviation fans watching live traffic at an airport, saying why a particular aircraft type is worth a look there.',
    'Rules:',
    '- One sentence, at most 25 words, plain English, no emoji, no exclamation marks.',
    '- Say what makes the type notable (size, role, rarity, age, how few exist) and, when it helps, why it is unusual at this kind of airport.',
    '- Only well-established facts about the type. Never invent a specific flight, route, date, cargo, operator, owner or passenger.',
    '- Never speculate about who owns, charters or is aboard an aircraft, and never mention registrations.',
    '- If the type designator looks like a data error (for example an aircraft that no longer exists), say so briefly.',
    'Answer with the JSON requested and nothing else.',
  ].join('\n'),
  prompt: buildExplainSightingPrompt,
  schema: { type: 'object', properties: { line: { type: 'string' } }, required: ['line'], additionalProperties: false },
  effort: 'low',
  maxTokens: 2000,
  timeoutMs: 20_000,
  cacheS: 86_400,
  maxInputChars: 1500,
}
