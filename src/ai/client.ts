/**
 * Browser side of the AI features: `askAi(task, input)` runs a named task on
 * `/api/ai` (see src/api/ai/tasks.ts) with this device's keys, de-duplicates
 * identical requests in flight, and keeps recent answers in memory.
 *
 * Every feature must work, in a simpler form, when AI is unavailable: catch
 * `AiUnavailableError` and fall back (rules, raw text) rather than erroring.
 */
import { aiHeaders, useAiSettings } from './aiSettings'

export class AiUnavailableError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

type Answer = { result: unknown; provider: string; model: string }

const MEMO_LIMIT = 300
const memo = new Map<string, Answer>()
const inflight = new Map<string, Promise<Answer>>()

/** Run task `task` with `input`; resolves to the task's result (parsed JSON or text). */
export async function askAi<T = unknown>(task: string, input: unknown, opts: { signal?: AbortSignal; fresh?: boolean } = {}): Promise<T> {
  const s = useAiSettings.getState()
  if (!s.enabled) throw new AiUnavailableError('AI features are switched off in Settings.', 0)
  const key = JSON.stringify([task, input, s.provider, s.model])
  if (!opts.fresh) {
    const hit = memo.get(key)
    if (hit) return hit.result as T
    const pending = inflight.get(key)
    if (pending) return (await abortable(pending, opts.signal)).result as T
  }
  const p = (async () => {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...aiHeaders(s) },
      body: JSON.stringify({ task, input }),
    })
    const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown; error?: string; provider?: string; model?: string } | null
    if (!res.ok || !body?.ok) throw new AiUnavailableError(body?.error ?? `AI request failed (${res.status})`, res.status)
    return { result: body.result, provider: body.provider ?? '', model: body.model ?? '' }
  })()
  // The request is shared by everyone asking the same thing, so one caller giving up
  // (its `signal` aborting) must not cancel it for the others: each caller stops
  // waiting on its own, while the request carries on and its answer is kept.
  inflight.set(key, p)
  void p
    .then((answer) => {
      memo.set(key, answer)
      if (memo.size > MEMO_LIMIT) memo.delete(memo.keys().next().value!)
    })
    .catch(() => {})
    .finally(() => inflight.delete(key))
  return (await abortable(p, opts.signal)).result as T
}

/** `p`, or a rejection as soon as `signal` aborts (without cancelling `p` itself). */
function abortable<T>(p: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return p
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export type AiStatus = { configured: boolean; provider: 'anthropic' | 'openrouter' | null; model: string | null; keySource: 'device' | 'server' | null; server: { anthropic: boolean; openrouter: boolean } }

/** Which provider and model would answer right now (asks the server; never returns keys). */
export async function getAiRunStatus(): Promise<AiStatus> {
  const res = await fetch('/api/ai', { headers: aiHeaders() })
  if (!res.ok) throw new Error(`AI status ${res.status}`)
  return (await res.json()) as AiStatus
}

/** True when an AI feature should even try (switch on and some key known locally or on the server). */
export function aiMaybeAvailable(status: AiStatus | undefined): boolean {
  const s = useAiSettings.getState()
  return s.enabled && (!!s.anthropicKey.trim() || !!s.openrouterKey.trim() || !!status?.configured)
}
