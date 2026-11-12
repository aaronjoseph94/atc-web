/**
 * One way for every AI feature to call a model, on the server (Pages
 * Functions and the dev server share it).
 *
 * Providers:
 *  - Claude, through the official Anthropic SDK.
 *  - OpenRouter (the owner's choice for a second provider), through its own
 *    HTTP API; it reaches Claude and many other models with one key.
 *
 * Keys live on the server only, as Cloudflare secrets (`ANTHROPIC_API_KEY`,
 * `OPENROUTER_API_KEY`; see docs/ai-setup.md). The browser never sends or
 * stores one. `AI_PROVIDER` and `AI_MODEL` pick the provider and model for
 * everyone. The older single-key trio (`AI_API_KEY` / `AI_BASE_URL`) used by
 * the summary endpoint still works as a fallback.
 */
import Anthropic, { APIError, AuthenticationError, BadRequestError, RateLimitError } from '@anthropic-ai/sdk'

export type AiProvider = 'anthropic' | 'openrouter'

export type AiEnv = {
  ANTHROPIC_API_KEY?: string
  OPENROUTER_API_KEY?: string
  /** `anthropic`, `openrouter` or `auto` (default: Claude when its key is set, else OpenRouter). */
  AI_PROVIDER?: string
  /** Model for every task (Claude id, or an OpenRouter id when the provider is OpenRouter). */
  AI_MODEL?: string
  /** Legacy single-key setup (see summarizeHandler). */
  AI_API_KEY?: string
  AI_BASE_URL?: string
}

export type ResolvedAi = { provider: AiProvider; key: string; model: string }

/** The Claude models the owner can name in `AI_MODEL`, with the names shown in Settings. The default is the current Opus. */
export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
] as const
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5'
/** On OpenRouter, the same models under its own names. */
export const OPENROUTER_MODEL_FOR: Record<string, string> = {
  'claude-opus-5-5': 'anthropic/claude-opus-5.5',
  'claude-sonnet-5-5': 'anthropic/claude-sonnet-5.5',
  'claude-haiku-5-5': 'anthropic/claude-haiku-5.5',
}

/** A model id as people would say it ("Claude Opus 5.5"); ids nobody listed are shown as they are. */
export function modelLabel(model: string): string {
  const id = Object.entries(OPENROUTER_MODEL_FOR).find(([, or]) => or === model)?.[0] ?? model
  return CLAUDE_MODELS.find((m) => m.id === id)?.label ?? model
}

/** Which provider, key and model the server will use, or null when no key is set. */
export function resolveAi(env: AiEnv): ResolvedAi | null {
  const legacyAnthropic = env.AI_API_KEY && (!env.AI_BASE_URL || /anthropic\.com/.test(env.AI_BASE_URL)) ? env.AI_API_KEY : undefined
  const legacyOpenRouter = env.AI_API_KEY && env.AI_BASE_URL && /openrouter\.ai/.test(env.AI_BASE_URL) ? env.AI_API_KEY : undefined
  const anthropic = env.ANTHROPIC_API_KEY?.trim() || legacyAnthropic
  const openrouter = env.OPENROUTER_API_KEY?.trim() || legacyOpenRouter
  const wanted = (env.AI_PROVIDER ?? '').trim().toLowerCase()
  // A named provider is used when its key exists; otherwise whichever key there is.
  const pick: AiProvider | null = wanted === 'openrouter' ? (openrouter ? 'openrouter' : anthropic ? 'anthropic' : null) : anthropic ? 'anthropic' : openrouter ? 'openrouter' : null
  if (!pick) return null
  const base = env.AI_MODEL?.trim() || DEFAULT_CLAUDE_MODEL
  if (pick === 'anthropic') return { provider: 'anthropic', key: anthropic!, model: base.startsWith('claude-') ? base : DEFAULT_CLAUDE_MODEL }
  return { provider: 'openrouter', key: openrouter!, model: OPENROUTER_MODEL_FOR[base] ?? (base.includes('/') ? base : OPENROUTER_MODEL_FOR[DEFAULT_CLAUDE_MODEL]) }
}

export type RunAiArgs = {
  /** Stable instructions; cached on Claude so repeat calls are cheaper and faster. */
  system: string
  /** The changing part: the transcript, the flight, the question. */
  prompt: string
  /** JSON Schema for the answer (object, `additionalProperties: false`). Omit for plain text. */
  schema?: Record<string, unknown>
  /** Thinking depth on Claude. Short, latency-sensitive tasks use `low`. */
  effort?: 'low' | 'medium' | 'high'
  maxTokens?: number
  timeoutMs?: number
}

export type RunAiResult = { text: string; json: unknown; provider: AiProvider; model: string }

export class AiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** Run one prompt on the resolved provider. Throws `AiError` with an HTTP-ish status. */
export async function runAi(ai: ResolvedAi, args: RunAiArgs): Promise<RunAiResult> {
  const timeoutMs = args.timeoutMs ?? 20_000
  return ai.provider === 'anthropic' ? runClaude(ai, args, timeoutMs) : runOpenRouter(ai, args, timeoutMs)
}

async function runClaude(ai: ResolvedAi, args: RunAiArgs, timeoutMs: number): Promise<RunAiResult> {
  const client = new Anthropic({ apiKey: ai.key, timeout: timeoutMs, maxRetries: 1, dangerouslyAllowBrowser: false })
  try {
    const response = await client.messages.create({
      model: ai.model,
      max_tokens: args.maxTokens ?? 4000,
      system: [{ type: 'text', text: args.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: args.prompt }],
      output_config: {
        effort: args.effort ?? 'low',
        ...(args.schema ? { format: { type: 'json_schema' as const, schema: args.schema } } : {}),
      },
    })
    if (response.stop_reason === 'refusal') throw new AiError('The model declined this request.', 422)
    const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim()
    return { text, json: args.schema ? parseJson(text) : null, provider: 'anthropic', model: response.model }
  } catch (err) {
    if (err instanceof AiError) throw err
    if (err instanceof AuthenticationError) throw new AiError('The Claude API key was rejected.', 401)
    if (err instanceof RateLimitError) throw new AiError('Claude is rate limiting this key; try again shortly.', 429)
    if (err instanceof BadRequestError) throw new AiError(`Claude rejected the request: ${err.message}`, 400)
    if (err instanceof APIError) throw new AiError(`Claude error ${err.status ?? ''}`.trim(), 502)
    throw new AiError('Could not reach Claude.', 504)
  }
}

async function runOpenRouter(ai: ResolvedAi, args: RunAiArgs, timeoutMs: number): Promise<RunAiResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ai.key}`, 'x-title': 'atc-web' },
      body: JSON.stringify({
        model: ai.model,
        max_tokens: args.maxTokens ?? 4000,
        messages: [
          { role: 'system', content: args.system },
          { role: 'user', content: args.prompt },
        ],
        ...(args.schema ? { response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: args.schema } } } : {}),
      }),
    })
    if (res.status === 401 || res.status === 403) throw new AiError('The OpenRouter API key was rejected.', 401)
    if (res.status === 429) throw new AiError('OpenRouter is rate limiting this key; try again shortly.', 429)
    if (!res.ok) throw new AiError(`OpenRouter error ${res.status}`, 502)
    const data = (await res.json()) as { model?: string; choices?: { message?: { content?: string } }[] }
    const text = (data.choices?.[0]?.message?.content ?? '').trim()
    return { text, json: args.schema ? parseJson(text) : null, provider: 'openrouter', model: data.model ?? ai.model }
  } catch (err) {
    if (err instanceof AiError) throw err
    throw new AiError('Could not reach OpenRouter.', 504)
  } finally {
    clearTimeout(timer)
  }
}

/** Parse a JSON answer, tolerating a code fence around it (some OpenRouter models add one). */
export function parseJson(text: string): unknown {
  const body = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(body)
  } catch {
    throw new AiError('The model did not return valid JSON.', 502)
  }
}
