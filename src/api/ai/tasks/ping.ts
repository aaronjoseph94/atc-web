/** A tiny task for checking by hand that the server's key works (the cheapest request there is). */
import type { AiTask } from '../tasks'

export const ping: AiTask<Record<string, never>> = {
  name: 'ping',
  system: 'You check that an API connection works. Reply with the JSON requested and nothing else.',
  prompt: () => 'Reply with {"ok": true}.',
  schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
  effort: 'low',
  maxTokens: 1000,
  timeoutMs: 15_000,
  cacheS: 0,
}
