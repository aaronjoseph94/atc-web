/**
 * `POST /api/ai` body `{ task, input }` → `{ ok, task, provider, model, result }`.
 * Shared by the Pages Function and the dev server. `GET /api/ai` reports which
 * providers are available (never the keys).
 */
import { AiError, resolveAi, runAi, type AiEnv, type AiRequestOptions } from './run'
import { TASKS } from './tasks'

export type AiStatusResponse = {
  configured: boolean
  provider: 'anthropic' | 'openrouter' | null
  model: string | null
  keySource: 'device' | 'server' | null
  server: { anthropic: boolean; openrouter: boolean }
}

export function aiStatus(env: AiEnv, opts: AiRequestOptions): AiStatusResponse {
  const r = resolveAi(env, opts)
  return {
    configured: !!r,
    provider: r?.provider ?? null,
    model: r?.model ?? null,
    keySource: r?.keySource ?? null,
    server: { anthropic: !!(env.ANTHROPIC_API_KEY || (env.AI_API_KEY && !/openrouter/.test(env.AI_BASE_URL ?? ''))), openrouter: !!(env.OPENROUTER_API_KEY || (env.AI_API_KEY && /openrouter/.test(env.AI_BASE_URL ?? ''))) },
  }
}

export type AiRunResponse = { ok: true; task: string; provider: string; model: string; result: unknown } | { ok: false; task: string; error: string; status: number }

export async function handleAiRun(body: unknown, env: AiEnv, opts: AiRequestOptions): Promise<AiRunResponse> {
  const { task: name, input } = (body ?? {}) as { task?: unknown; input?: unknown }
  const task = typeof name === 'string' ? TASKS[name] : undefined
  if (!task) return { ok: false, task: String(name ?? ''), error: 'Unknown task', status: 404 }
  const size = JSON.stringify(input ?? null).length
  if (size > (task.maxInputChars ?? 20_000)) return { ok: false, task: task.name, error: 'Input too large', status: 413 }
  const ai = resolveAi(env, opts)
  if (!ai) return { ok: false, task: task.name, error: 'No AI key set. Add a Claude or OpenRouter key in Settings > AI.', status: 401 }
  let prompt: string
  try {
    prompt = task.prompt(input as never)
  } catch (err) {
    return { ok: false, task: task.name, error: err instanceof Error ? err.message : 'Bad input', status: 400 }
  }
  try {
    const out = await runAi(ai, { system: task.system, prompt, schema: task.schema, effort: task.effort, maxTokens: task.maxTokens, timeoutMs: task.timeoutMs })
    return { ok: true, task: task.name, provider: out.provider, model: out.model, result: task.schema ? out.json : out.text }
  } catch (err) {
    if (err instanceof AiError) return { ok: false, task: task.name, error: err.message, status: err.status }
    return { ok: false, task: task.name, error: 'AI request failed', status: 500 }
  }
}
