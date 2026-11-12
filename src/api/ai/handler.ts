/**
 * `POST /api/ai` body `{ task, input }` → `{ ok, task, provider, model, result }`.
 * `GET /api/ai` → whether AI is set up, which model answers, and today's
 * usage against the daily cap (never the keys).
 *
 * Shared by the Pages Function and the dev server. Every request is paid for
 * with the site's own key, so each one passes the checks in ./limits.ts
 * first; answers served from the cache cost nothing and are not counted.
 */
import type { JsonCache } from '../sourceHealth'
import type { Counters, JsonStore } from '../storage'
import { aiUsage, checkRate, isSameOrigin, reserveAi, type AiUsage, type LimitEnv, type OriginHeaders, type RateDoc } from './limits'
import { AiError, modelLabel, resolveAi, runAi, type AiEnv, type RunAiArgs, type RunAiResult, type ResolvedAi } from './run'
import { TASKS } from './tasks'

export type AiHandlerEnv = AiEnv & LimitEnv

export type AiStatusResponse = {
  /** A key is set on the server. */
  configured: boolean
  provider: 'anthropic' | 'openrouter' | null
  model: string | null
  /** The model as people say it ("Claude Opus 5.5"). */
  label: string | null
  usage: AiUsage
}

export async function aiStatus(env: AiHandlerEnv, counters: Counters, now = Date.now()): Promise<AiStatusResponse> {
  const r = resolveAi(env)
  return { configured: !!r, provider: r?.provider ?? null, model: r?.model ?? null, label: r ? modelLabel(r.model) : null, usage: await aiUsage(counters, env, now) }
}

/** Why a request was turned away, for the browser to act on (see src/ai/client.ts). */
export type AiRefusal = 'origin' | 'not_configured' | 'rate_limited' | 'daily_cap' | 'task_cap'

export type AiRunResponse =
  | { ok: true; task: string; provider: string; model: string; result: unknown }
  | { ok: false; task: string; error: string; status: number; code?: AiRefusal; retryAfterS?: number }

export type AiRequestContext = {
  /** This site's origin, and what the request says about where it came from. */
  self: string
  from: OriginHeaders
  /** Who is asking (IP address), for the rate limit. */
  client: string
  /** Daily request counts. */
  counters: Counters
  /** Per-visitor rate documents (short-lived). */
  rates: JsonStore
  /** This process's own copy of them (the isolate's by default; tests pass their own). */
  rateMemory?: Map<string, RateDoc>
  /** Answers to identical requests, kept for each task's `cacheS`. */
  answers: JsonCache
  now?: number
  /** The model call; swapped out in tests. */
  run?: (ai: ResolvedAi, args: RunAiArgs) => Promise<RunAiResult>
}

export type AiHttpAnswer = { status: number; body: AiRunResponse; headers: Record<string, string> }

export const DAILY_LIMIT_MESSAGE = 'AI daily limit reached'

async function answerKey(task: string, input: unknown, model: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([task, input, model])))
  return `ai-answer:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

const refuse = (task: string, status: number, error: string, code?: AiRefusal, retryAfterS?: number): AiHttpAnswer => ({
  status,
  body: { ok: false, task, error, status, ...(code ? { code } : {}), ...(retryAfterS ? { retryAfterS } : {}) },
  headers: { 'cache-control': 'no-store', ...(retryAfterS ? { 'retry-after': String(retryAfterS) } : {}) },
})

export async function handleAiPost(body: unknown, env: AiHandlerEnv, ctx: AiRequestContext): Promise<AiHttpAnswer> {
  const now = ctx.now ?? Date.now()
  const { task: name, input } = (body ?? {}) as { task?: unknown; input?: unknown }
  const label = typeof name === 'string' ? name : ''
  if (!isSameOrigin(ctx.self, ctx.from)) return refuse(label, 403, 'AI requests are only accepted from this site.', 'origin')
  const task = typeof name === 'string' ? TASKS[name] : undefined
  if (!task) return refuse(label, 404, 'Unknown task')
  const size = JSON.stringify(input ?? null).length
  if (size > (task.maxInputChars ?? 20_000)) return refuse(task.name, 413, 'Input too large')
  const ai = resolveAi(env)
  if (!ai) return refuse(task.name, 401, 'AI is not set up on this site.', 'not_configured')
  let prompt: string
  try {
    prompt = task.prompt(input as never)
  } catch (err) {
    return refuse(task.name, 400, err instanceof Error ? err.message : 'Bad input')
  }

  // An answer already paid for: free, so it is neither rate limited nor counted.
  const ttl = task.cacheS ?? 0
  const key = ttl > 0 ? await answerKey(task.name, input, ai.model) : null
  if (key) {
    const hit = await ctx.answers.get<AiRunResponse>(key)
    if (hit?.ok) return { status: 200, body: hit, headers: { 'cache-control': `public, max-age=${ttl}`, 'x-atc-ai-cache': 'hit' } }
  }

  const rate = await checkRate(ctx.rates, ctx.client, env, now, ctx.rateMemory)
  if (!rate.ok) return refuse(task.name, 429, 'Too many AI requests from this device; slow down.', 'rate_limited', rate.retryAfterS)
  const slot = await reserveAi(ctx.counters, task.name, env, now)
  if (!slot.ok) return refuse(task.name, 429, DAILY_LIMIT_MESSAGE, slot.code, slot.retryAfterS)

  try {
    const out = await (ctx.run ?? runAi)(ai, { system: task.system, prompt, schema: task.schema, effort: task.effort, maxTokens: task.maxTokens, timeoutMs: task.timeoutMs })
    const answer: AiRunResponse = { ok: true, task: task.name, provider: out.provider, model: out.model, result: task.schema ? out.json : out.text }
    if (key) await ctx.answers.put(key, answer, ttl)
    return { status: 200, body: answer, headers: { 'cache-control': ttl > 0 ? `public, max-age=${ttl}` : 'no-store' } }
  } catch (err) {
    if (err instanceof AiError) return refuse(task.name, err.status === 429 ? 503 : err.status, err.message)
    return refuse(task.name, 500, 'AI request failed')
  }
}
