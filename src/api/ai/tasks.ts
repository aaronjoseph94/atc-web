/**
 * The AI tasks the app can ask for, by name. Each feature registers its task
 * here (instructions, the JSON shape of the answer, effort and limits); the
 * single `/api/ai` endpoint runs them. Keep each task's `system` text stable:
 * it is cached by Claude, so editing it per request would waste the cache.
 *
 * Add a task: create `src/api/ai/tasks/<name>.ts` exporting a `AiTask`, then
 * list it in `TASKS` below.
 */
import type { RunAiArgs } from './run'
import { airportBriefing } from './tasks/airportBriefing'
import { catchUp } from './tasks/catchUp'
import { explainAlert } from './tasks/explainAlert'
import { explainSighting } from './tasks/explainSighting'
import { explainTerm } from './tasks/explainTerm'
import { flightFacts } from './tasks/flightFacts'
import { flightStory } from './tasks/flightStory'
import { ping } from './tasks/ping'
import { radioCleanup } from './tasks/radioCleanup'
import { weatherBrief } from './tasks/weatherBrief'

export type AiTask<In = unknown> = {
  name: string
  /** Stable instructions (cached). */
  system: string
  /** Turn the browser's input into the changing prompt; throw `Error` for bad input. */
  prompt: (input: In) => string
  /** JSON Schema of the answer, or undefined for plain text. */
  schema?: Record<string, unknown>
  effort?: RunAiArgs['effort']
  maxTokens?: number
  timeoutMs?: number
  /** Seconds an identical request's answer may be served from the edge cache (0 = never). */
  cacheS?: number
  /** Largest accepted input, in characters of JSON (default 20 000). */
  maxInputChars?: number
}

export const TASKS: Record<string, AiTask<never>> = {
  [airportBriefing.name]: airportBriefing as AiTask<never>,
  [catchUp.name]: catchUp as AiTask<never>,
  [explainAlert.name]: explainAlert as AiTask<never>,
  [explainSighting.name]: explainSighting as AiTask<never>,
  [explainTerm.name]: explainTerm as AiTask<never>,
  [flightFacts.name]: flightFacts as AiTask<never>,
  [flightStory.name]: flightStory as AiTask<never>,
  [ping.name]: ping as AiTask<never>,
  [radioCleanup.name]: radioCleanup as AiTask<never>,
  [weatherBrief.name]: weatherBrief as AiTask<never>,
}
