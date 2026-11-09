/**
 * Shared logic for `POST /api/summarize` (Pages Function + Vite dev plugin).
 *
 * Produces a one- or two-sentence plain-English summary of the most recent
 * radio exchange for a flight. When an AI key is configured the request goes
 * to an OpenAI-compatible chat endpoint (OpenRouter, OpenAI, …) or directly
 * to Anthropic; otherwise the deterministic rule-based explainer is used so
 * the feature always works.
 *
 * Environment (set in Cloudflare Pages → Settings → Variables; never committed):
 *   AI_API_KEY   – provider key. Absent → rules mode.
 *   AI_BASE_URL  – default https://openrouter.ai/api/v1 (OpenAI-compatible).
 *                  Use https://api.anthropic.com for the native Anthropic API.
 *   AI_MODEL     – default anthropic/claude-3.5-haiku (OpenRouter id) or
 *                  claude-3-5-haiku-latest for native Anthropic.
 */
import { summarizeExchange, type Transmission } from '../flight/describe'

export type AiEnv = {
  AI_API_KEY?: string
  AI_BASE_URL?: string
  AI_MODEL?: string
}

export type SummarizeRequest = {
  callsign: string
  /** Oldest → newest. Only the last few are used. */
  transmissions: Transmission[]
  context?: {
    airport?: string
    station?: string
    phase?: string
    altitudeFt?: number | null
    speedKt?: number | null
  }
}

export type SummarizeResponse = {
  summary: string
  /** `ai` when a model produced it, `rules` for the built-in explainer. */
  source: 'ai' | 'rules'
  model?: string
}

/** Public, key-free view of the configuration for the Settings page. */
export type AiStatus = { configured: boolean; provider: 'anthropic' | 'openai-compatible' | null; model: string | null }

const MAX_TRANSMISSIONS = 8
const MAX_CHARS = 1800
const AI_TIMEOUT_MS = 9000

const DEFAULT_OPENAI_BASE = 'https://openrouter.ai/api/v1'
const DEFAULT_OPENAI_MODEL = 'anthropic/claude-3.5-haiku'
const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-haiku-latest'

const SYSTEM_PROMPT =
  'You explain air traffic control radio calls to curious members of the public with no aviation background. ' +
  'Given the recent transmissions for one flight, reply with one or two short sentences (max 45 words) saying what ' +
  'the controller asked for and whether the pilot confirmed. Expand jargon (e.g. "hold short" = stop before the runway), ' +
  'spell runways like 28R, give headings as compass directions, and never invent details that are not in the transcript. ' +
  'No preamble, no quotes, plain text only.'

function isAnthropic(env: AiEnv) {
  return /anthropic\.com/i.test(env.AI_BASE_URL ?? '')
}

export function aiStatus(env: AiEnv): AiStatus {
  if (!env.AI_API_KEY) return { configured: false, provider: null, model: null }
  const anthropic = isAnthropic(env)
  return {
    configured: true,
    provider: anthropic ? 'anthropic' : 'openai-compatible',
    model: env.AI_MODEL || (anthropic ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_OPENAI_MODEL),
  }
}

/** Validate and trim an untrusted request body. Throws on bad shape. */
export function parseSummarizeRequest(body: unknown): SummarizeRequest {
  if (!body || typeof body !== 'object') throw new Error('body must be an object')
  const b = body as Record<string, unknown>
  if (typeof b.callsign !== 'string' || !b.callsign.trim()) throw new Error('callsign required')
  if (!Array.isArray(b.transmissions) || b.transmissions.length === 0) throw new Error('transmissions required')

  let chars = 0
  const transmissions: Transmission[] = []
  for (const t of b.transmissions.slice(-MAX_TRANSMISSIONS)) {
    if (!t || typeof t !== 'object') continue
    const tt = t as Record<string, unknown>
    if (typeof tt.text !== 'string') continue
    const text = tt.text.trim().slice(0, 400)
    chars += text.length
    if (chars > MAX_CHARS) break
    transmissions.push({ text, speaker: typeof tt.speaker === 'string' ? tt.speaker.slice(0, 40) : undefined })
  }
  if (!transmissions.length) throw new Error('no usable transmissions')

  const ctx = (b.context && typeof b.context === 'object' ? b.context : {}) as Record<string, unknown>
  return {
    callsign: b.callsign.trim().slice(0, 12),
    transmissions,
    context: {
      airport: typeof ctx.airport === 'string' ? ctx.airport.slice(0, 4) : undefined,
      station: typeof ctx.station === 'string' ? ctx.station.slice(0, 60) : undefined,
      phase: typeof ctx.phase === 'string' ? ctx.phase.slice(0, 30) : undefined,
      altitudeFt: typeof ctx.altitudeFt === 'number' ? ctx.altitudeFt : null,
      speedKt: typeof ctx.speedKt === 'number' ? ctx.speedKt : null,
    },
  }
}

function userPrompt(req: SummarizeRequest): string {
  const ctx = req.context ?? {}
  const lines = req.transmissions.map((t) => `${t.speaker ?? 'Unknown'}: ${t.text}`)
  const facts = [
    `Flight: ${req.callsign}`,
    ctx.airport && `Airport: ${ctx.airport}`,
    ctx.station && `Frequency: ${ctx.station}`,
    ctx.phase && `Current phase: ${ctx.phase}`,
    ctx.altitudeFt != null && `Altitude: ${Math.round(ctx.altitudeFt)} ft`,
    ctx.speedKt != null && `Speed: ${Math.round(ctx.speedKt)} kt`,
  ].filter(Boolean)
  return `${facts.join('\n')}\n\nTransmissions (oldest first):\n${lines.join('\n')}`
}

async function callOpenAiCompatible(env: AiEnv, req: SummarizeRequest, signal: AbortSignal): Promise<string> {
  const base = (env.AI_BASE_URL || DEFAULT_OPENAI_BASE).replace(/\/$/, '')
  const model = env.AI_MODEL || DEFAULT_OPENAI_MODEL
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.AI_API_KEY}`,
      // OpenRouter attribution headers (ignored by other providers).
      'http-referer': 'https://atc-web-62t.pages.dev',
      'x-title': 'ATC Web',
    },
    body: JSON.stringify({
      model,
      max_tokens: 120,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt(req) },
      ],
    }),
  })
  if (!res.ok) throw new Error(`AI HTTP ${res.status}`)
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('AI returned no content')
  return text
}

async function callAnthropic(env: AiEnv, req: SummarizeRequest, signal: AbortSignal): Promise<string> {
  const base = (env.AI_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '')
  const model = env.AI_MODEL || DEFAULT_ANTHROPIC_MODEL
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.AI_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 120,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt(req) }],
    }),
  })
  if (!res.ok) throw new Error(`AI HTTP ${res.status}`)
  const data = (await res.json()) as { content?: { type: string; text?: string }[] }
  const text = data.content?.find((c) => c.type === 'text')?.text?.trim()
  if (!text) throw new Error('AI returned no content')
  return text
}

/**
 * Summarize; AI when configured, rules otherwise. AI failures (timeout, quota,
 * bad key) silently degrade to rules so the UI never shows an error state.
 */
export async function summarize(req: SummarizeRequest, env: AiEnv): Promise<SummarizeResponse> {
  const status = aiStatus(env)
  if (!status.configured) return { summary: summarizeExchange(req.transmissions), source: 'rules' }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS)
  try {
    const summary = status.provider === 'anthropic'
      ? await callAnthropic(env, req, ctrl.signal)
      : await callOpenAiCompatible(env, req, ctrl.signal)
    return { summary, source: 'ai', model: status.model ?? undefined }
  } catch {
    return { summary: summarizeExchange(req.transmissions), source: 'rules' }
  } finally {
    clearTimeout(timer)
  }
}

/** Stable cache key for identical requests (saves tokens on repeat taps). */
export async function summarizeCacheKey(req: SummarizeRequest): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify([req.callsign, req.transmissions]))
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('')
}
