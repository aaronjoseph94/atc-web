/**
 * The models and providers the AI features may use, and the headers that
 * carry a device's pick from Settings > AI. No dependencies, so the browser
 * (Settings, src/ai/client.ts) and the server (./run.ts) share one list.
 *
 * Haiku is the default for everything; Sonnet is the one step up. Nothing
 * else (Opus included) can be chosen, by the owner's `AI_MODEL` or by a
 * request: anything not on this list means the default.
 */

export type AiProvider = 'anthropic' | 'openrouter'
/** `auto`: Claude's own API when its key is set, else OpenRouter. */
export type AiProviderChoice = AiProvider | 'auto'

/** The only models this site runs, with the names shown in Settings. */
export const CLAUDE_MODELS = [
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', short: 'Haiku' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', short: 'Sonnet' },
] as const
export type ClaudeModelId = (typeof CLAUDE_MODELS)[number]['id']
export const DEFAULT_CLAUDE_MODEL: ClaudeModelId = 'claude-haiku-5-5'

/** On OpenRouter, the same models under its own names. */
export const OPENROUTER_MODEL_FOR: Record<ClaudeModelId, string> = {
  'claude-haiku-5-5': 'anthropic/claude-haiku-5.5',
  'claude-sonnet-5-5': 'anthropic/claude-sonnet-5.5',
}

/** One of the allowed models, named by its Claude id or its OpenRouter id; null for anything else. */
export function allowedModel(name: string | null | undefined): ClaudeModelId | null {
  const n = (name ?? '').trim().toLowerCase()
  if (!n) return null
  return CLAUDE_MODELS.find((m) => m.id === n || OPENROUTER_MODEL_FOR[m.id] === n)?.id ?? null
}

/** `anthropic` / `claude`, `openrouter` or `auto`; null for anything else. */
export function allowedProvider(raw: string | null | undefined): AiProviderChoice | null {
  const v = (raw ?? '').trim().toLowerCase()
  return v === 'anthropic' || v === 'claude' ? 'anthropic' : v === 'openrouter' ? 'openrouter' : v === 'auto' ? 'auto' : null
}

/** A model id as people would say it ("Claude Haiku 5.5"); ids nobody listed are shown as they are. */
export function modelLabel(model: string): string {
  const id = allowedModel(model)
  return CLAUDE_MODELS.find((m) => m.id === id)?.label ?? model
}

/** A device's pick from Settings > AI (untrusted on the server). Missing or unknown parts mean the site's default. */
export type AiChoice = { provider?: string | null; model?: string | null }

/** The request headers that carry an `AiChoice` (never a key). */
export const AI_HEADERS = { provider: 'x-atc-ai-provider', model: 'x-atc-ai-model' } as const

/** A device's pick read from request headers, keeping only values the server accepts. */
export function optionsFromHeaders(get: (name: string) => string | null | undefined): AiChoice {
  const provider = allowedProvider(get(AI_HEADERS.provider))
  const model = allowedModel(get(AI_HEADERS.model))
  return { ...(provider ? { provider } : {}), ...(model ? { model } : {}) }
}

/** The headers for a device's pick; empty when it leaves both to the site. */
export function choiceHeaders(choice: AiChoice): Record<string, string> {
  const provider = allowedProvider(choice.provider)
  const model = allowedModel(choice.model)
  return { ...(provider ? { [AI_HEADERS.provider]: provider } : {}), ...(model ? { [AI_HEADERS.model]: model } : {}) }
}
