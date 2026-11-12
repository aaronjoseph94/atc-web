/**
 * Browser side of the AI features: `askAi(task, input)` runs a named task on
 * `/api/ai` (see src/api/ai/tasks.ts), de-duplicates identical requests in
 * flight, and keeps recent answers in memory. The server holds the key; the
 * browser sends none.
 *
 * Every feature must work, in a simpler form, when AI is unavailable: catch
 * `AiUnavailableError` and fall back (rules, raw text) rather than erroring.
 * That includes the site's daily cap: once the server says it is reached,
 * nothing more is sent for a while and callers fail fast.
 */
import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'
import type { AiRefusal, AiStatusResponse } from '../api/ai/handler'
import { choiceHeaders } from '../api/ai/models'
import { useAiSettings, type AiSettings } from './aiSettings'

/** The headers for this device's model / provider pick (none when both are left to the site). */
function pickHeaders(s: Pick<AiSettings, 'model' | 'provider'> = useAiSettings.getState()): Record<string, string> {
  return choiceHeaders({ model: s.model, provider: s.provider })
}

export class AiUnavailableError extends Error {
  readonly status: number
  /** Why the server said no, when it gave a reason. */
  readonly code: AiRefusal | null
  constructor(message: string, status: number, code: AiRefusal | null = null) {
    super(message)
    this.status = status
    this.code = code
  }
}

type Answer = { result: unknown; provider: string; model: string }

const MEMO_LIMIT = 300
const memo = new Map<string, Answer>()
const inflight = new Map<string, Promise<Answer>>()

// ---------------------------------------------------------------------------
// Limits the server has told us about
// ---------------------------------------------------------------------------

/** A cap may be raised, or the day may turn: ask again this often even when told to wait longer. */
const RECHECK_MS = 10 * 60_000
/** Any task. */
const ALL = '*'

type Block = { until: number; code: AiRefusal; message: string }
const blocks = new Map<string, Block>()

/** The site-wide or per-task daily cap, once the server has reported it; UI shows one quiet notice from this. */
export type AiLimit = { code: 'daily_cap' | 'task_cap'; task: string | null; until: number }
export const useAiLimit = create<{ limited: AiLimit | null }>(() => ({ limited: null }))

/** The reason `task` should not be sent right now, or null. */
export function aiBlocked(task: string, now = Date.now()): Block | null {
  for (const key of [ALL, task]) {
    const b = blocks.get(key)
    if (!b) continue
    if (now < b.until) return b
    blocks.delete(key)
    const limited = useAiLimit.getState().limited
    if (limited && (limited.task ?? ALL) === key) useAiLimit.setState({ limited: null })
  }
  return null
}

function noteRefusal(task: string, status: number, code: AiRefusal | null, retryAfterS: number | undefined, message: string, now = Date.now()) {
  const wait = Math.max(1, retryAfterS ?? 60) * 1000
  if (code === 'daily_cap' || code === 'task_cap') {
    const key = code === 'daily_cap' ? ALL : task
    const until = now + Math.min(wait, RECHECK_MS)
    blocks.set(key, { until, code, message })
    useAiLimit.setState({ limited: { code, task: code === 'task_cap' ? task : null, until } })
  } else if (code === 'rate_limited') blocks.set(ALL, { until: now + Math.min(wait, 60_000), code, message })
  else if (code === 'not_configured' || code === 'origin' || status === 401) blocks.set(ALL, { until: now + 5 * 60_000, code: code ?? 'not_configured', message })
}

/** Forget what the server said (settings changed, or a test starting clean). */
export function resetAiLimits() {
  blocks.clear()
  statusMemo = null
  if (useAiLimit.getState().limited) useAiLimit.setState({ limited: null })
}

// ---------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------

/** Run task `task` with `input`; resolves to the task's result (parsed JSON or text). */
export async function askAi<T = unknown>(task: string, input: unknown, opts: { signal?: AbortSignal; fresh?: boolean } = {}): Promise<T> {
  const s = useAiSettings.getState()
  if (!s.enabled) throw new AiUnavailableError('AI features are switched off in Settings.', 0)
  const pick = pickHeaders(s)
  // Each model keeps its own answers: after switching, nothing the other one said is reused.
  const key = JSON.stringify([task, input, pick])
  if (!opts.fresh) {
    const hit = memo.get(key)
    if (hit) return hit.result as T
    const pending = inflight.get(key)
    if (pending) return (await abortable(pending, opts.signal)).result as T
  }
  const blocked = aiBlocked(task)
  if (blocked) throw new AiUnavailableError(blocked.message, blocked.code === 'not_configured' ? 401 : 429, blocked.code)
  const p = (async () => {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...pick },
      body: JSON.stringify({ task, input }),
    })
    const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown; error?: string; provider?: string; model?: string; code?: AiRefusal; retryAfterS?: number } | null
    if (!res.ok || !body?.ok) {
      const message = body?.error ?? `AI request failed (${res.status})`
      noteRefusal(task, res.status, body?.code ?? null, body?.retryAfterS, message)
      throw new AiUnavailableError(message, res.status, body?.code ?? null)
    }
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

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type AiStatus = AiStatusResponse

/** Several parts of the app ask at once when it starts; they share one request. */
const STATUS_SHARE_MS = 20_000
let statusMemo: { at: number; pick: string; p: Promise<AiStatus> } | null = null

/** Whether AI is set up on the server, which providers have a key, which model answers this device, and today's usage against the cap. */
export function getAiRunStatus(): Promise<AiStatus> {
  const now = Date.now()
  const headers = pickHeaders()
  const pick = JSON.stringify(headers)
  if (statusMemo && statusMemo.pick === pick && now - statusMemo.at < STATUS_SHARE_MS) return statusMemo.p
  const p = (async () => {
    const res = await fetch('/api/ai', Object.keys(headers).length ? { headers } : undefined)
    if (!res.ok) throw new Error(`AI status ${res.status}`)
    const status = (await res.json()) as AiStatus
    // Already at the cap: treat it as if a request had just been refused, so nothing is sent to find that out.
    if (status.configured && status.usage?.limited) noteRefusal(ALL, 429, 'daily_cap', Math.max(1, Math.ceil((Date.parse(status.usage.resetsAt) - Date.now()) / 1000)), 'AI daily limit reached')
    return status
  })()
  statusMemo = { at: now, pick, p }
  p.catch(() => {
    if (statusMemo?.p === p) statusMemo = null
  })
  return p
}

/** True when `task` (or any task) can be answered: AI set up, and no cap reached that the status knows of. */
export function statusAllows(status: Pick<AiStatus, 'configured' | 'usage'> | undefined, task?: string): boolean {
  if (!status?.configured) return false
  if (status.usage?.limited) return false
  const mine = task ? status.usage?.tasks?.[task] : undefined
  return !mine || mine.today < mine.cap
}

/** The status, shared by Settings and every feature that asks whether AI is ready. */
export function useAiStatus(enabled = true) {
  const model = useAiSettings((s) => s.model)
  const provider = useAiSettings((s) => s.provider)
  // Asked rarely: every visitor's status check is a read of the site's shared counters.
  // Asked again when this device picks another model or provider, so the status names the one that answers.
  return useQuery({ queryKey: ['ai-run-status', model, provider], queryFn: getAiRunStatus, staleTime: 5 * 60_000, retry: 0, enabled, refetchOnWindowFocus: false, placeholderData: (prev) => prev })
}

/** True when an AI feature should try: switched on here, set up on the server, and under the daily cap. */
export function useAiReady(): boolean {
  const on = useAiSettings((s) => s.enabled)
  const capped = useAiLimit((s) => s.limited?.code === 'daily_cap')
  const status = useAiStatus(on)
  return on && !capped && statusAllows(status.data)
}

/** The same check outside React (alerts run from store subscriptions). */
export async function aiReadyNow(): Promise<boolean> {
  if (!useAiSettings.getState().enabled || aiBlocked(ALL)) return false
  try {
    return statusAllows(await getAiRunStatus())
  } catch {
    return false
  }
}
