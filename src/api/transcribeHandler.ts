/**
 * Speech to text for live radio. The browser cuts each transmission out of
 * the stream it is playing, encodes it as a short 16 kHz WAV and POSTs it
 * here; Cloudflare Workers AI runs Whisper on it.
 *
 * Shared by the Pages Function (`functions/api/transcribe.ts`) and the dev
 * server, which has no Workers AI binding and answers 501 instead.
 */
import { jsonResponse } from './aircraftHandler'

export const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo'

/** Largest upload accepted: 30 s of 16 kHz 16-bit mono plus headroom. */
export const MAX_WAV_BYTES = 1_050_000
/** Longest and shortest transmission worth sending to the model. */
export const MAX_SECONDS = 30
export const MIN_SECONDS = 0.3

/** Message shown wherever transcripts can't run (dev server, missing binding). */
export const NOT_AVAILABLE = 'Live transcripts need the deployed site'

/** The slice of the Workers AI binding this endpoint uses. */
export type AiBinding = { run: (model: string, input: Record<string, unknown>) => Promise<unknown> }
export type TranscribeEnv = { AI?: AiBinding }

export type TranscriptWord = { word: string; start: number; end: number }
export type TranscriptSegment = { start: number; end: number; text: string; words?: TranscriptWord[] }
export type TranscribeResult = { text: string; segments: TranscriptSegment[]; durationS: number }

export type WavInfo = { sampleRate: number; channels: number; bitsPerSample: number; durationS: number }

/** Read the header of a PCM WAV; null when it isn't one. */
export function parseWav(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 44) return null
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3])
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let o = 12
  let fmt: Omit<WavInfo, 'durationS'> | null = null
  while (o + 8 <= bytes.length) {
    const id = tag(o)
    const size = v.getUint32(o + 4, true)
    if (id === 'fmt ' && size >= 16) {
      if (v.getUint16(o + 8, true) !== 1) return null // PCM only
      fmt = { channels: v.getUint16(o + 10, true), sampleRate: v.getUint32(o + 12, true), bitsPerSample: v.getUint16(o + 22, true) }
    } else if (id === 'data' && fmt) {
      const bytesPerSecond = fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8)
      const len = Math.min(size, bytes.length - o - 8)
      return { ...fmt, durationS: bytesPerSecond ? len / bytesPerSecond : 0 }
    }
    o += 8 + size + (size % 2)
  }
  return null
}

/**
 * A token bucket per client. In-memory, so per Worker isolate: enough to stop
 * one runaway tab from burning the account's quota, not a hard global limit.
 */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>()
  private readonly capacity: number
  private readonly perSecond: number
  constructor(capacity: number, perSecond: number) {
    this.capacity = capacity
    this.perSecond = perSecond
  }

  /** Spend one token for `key`; false when it has none left. */
  take(key: string, now = Date.now()): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: now }
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 1000) * this.perSecond)
    b.at = now
    const ok = b.tokens >= 1
    if (ok) b.tokens -= 1
    this.buckets.set(key, b)
    if (this.buckets.size > 5000) this.prune(now)
    return ok
  }

  private prune(now: number) {
    for (const [k, b] of this.buckets) if (now - b.at > 10 * 60_000) this.buckets.delete(k)
  }
}

/** A busy tower can make 20 calls a minute; this allows that with room, and no more. */
export const transcribeLimiter = new RateLimiter(40, 0.6)

const BASE_PROMPT =
  'Air traffic control radio. Cleared to land, cleared for takeoff, line up and wait, hold short, taxi via Alpha, contact departure, wind 270 at 10, runway 4 left, heavy, November 1818 Charlie.'

/** Keep caller-supplied hints to letters, digits and simple punctuation. */
function tidy(s: string | null | undefined, max: number): string {
  return (s ?? '').replace(/[^A-Za-z0-9 ,.'/()-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

/**
 * The prompt that steers Whisper toward radio phraseology and the callsigns
 * actually around the airport ("Delta 288, JetBlue 1407, ..."), which is the
 * single biggest help in getting flight numbers right.
 */
export function buildPrompt(facility: string | null, callsigns: string | null): string {
  const where = tidy(facility, 60)
  const who = tidy(callsigns, 320)
  return [where ? `${where}.` : '', BASE_PROMPT, who ? `Aircraft: ${who}.` : ''].filter(Boolean).join(' ')
}

/** What Whisper says when given noise instead of speech. */
const HALLUCINATIONS = [
  /^(thank you|thanks)( (so much|very much|for watching|for listening))?[.!]*$/i,
  /^(bye|you|okay|oh|uh|um|hmm|so)[.!?]*$/i,
  /^(\.|,|\s|♪|-)+$/,
  /subtitles? (by|from)|amara\.org|transcribed by|please subscribe/i,
]

/** Drop the junk Whisper produces on squelch noise, and anything that only echoes the prompt. */
export function cleanTranscript(text: string, prompt = ''): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t || HALLUCINATIONS.some((re) => re.test(t))) return ''
  // A transcript that is just a slice of the prompt was not heard on the radio.
  if (t.length > 12 && prompt.toLowerCase().includes(t.toLowerCase().replace(/[.!?]+$/, ''))) return ''
  return t
}

type WhisperOutput = {
  text?: string
  segments?: { start?: number; end?: number; text?: string; no_speech_prob?: number; avg_logprob?: number; words?: TranscriptWord[] }[]
}

function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** True when the request comes from a page on this same site (or has no Origin, like curl). */
export function sameSite(request: Request): boolean {
  const origin = request.headers.get('Origin')
  if (!origin) return true
  try {
    const o = new URL(origin)
    const u = new URL(request.url)
    return o.host === u.host || o.hostname === 'localhost' || o.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

/**
 * POST /api/transcribe?facility=JFK%20Tower&callsigns=Delta%20288,...
 * Body: a 16-bit PCM WAV of one transmission.
 */
export async function handleTranscribe(request: Request, env: TranscribeEnv, limiter = transcribeLimiter): Promise<Response> {
  if (!env.AI) return jsonResponse({ error: NOT_AVAILABLE, code: 'no-ai' }, 501, 'no-store')
  if (!sameSite(request)) return jsonResponse({ error: 'forbidden' }, 403, 'no-store')
  const declared = Number(request.headers.get('Content-Length') ?? 0)
  if (declared > MAX_WAV_BYTES) return jsonResponse({ error: 'audio too large' }, 413, 'no-store')
  const client = request.headers.get('CF-Connecting-IP') ?? 'local'
  if (!limiter.take(client)) return jsonResponse({ error: 'slow down' }, 429, 'no-store')

  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.length > MAX_WAV_BYTES) return jsonResponse({ error: 'audio too large' }, 413, 'no-store')
  const wav = parseWav(bytes)
  if (!wav || wav.channels !== 1 || wav.bitsPerSample !== 16 || wav.sampleRate < 8000 || wav.sampleRate > 48000) {
    return jsonResponse({ error: 'expected 16-bit mono PCM WAV' }, 415, 'no-store')
  }
  if (wav.durationS > MAX_SECONDS || wav.durationS < MIN_SECONDS) return jsonResponse({ error: 'transmission length out of range' }, 422, 'no-store')

  const url = new URL(request.url)
  const prompt = buildPrompt(url.searchParams.get('facility'), url.searchParams.get('callsigns'))
  let out: WhisperOutput
  try {
    out = (await env.AI.run(WHISPER_MODEL, {
      audio: base64(bytes),
      task: 'transcribe',
      language: 'en',
      initial_prompt: prompt,
      // Each upload is one call; carrying text over only invites repetition loops.
      condition_on_previous_text: false,
      beam_size: 5,
    })) as WhisperOutput
  } catch (err) {
    return jsonResponse({ error: `transcriber failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300) }, 502, 'no-store')
  }

  const segments: TranscriptSegment[] = (out.segments ?? [])
    // Segments the model itself thinks are not speech are squelch noise.
    .filter((s) => !((s.no_speech_prob ?? 0) > 0.75 && (s.avg_logprob ?? 0) < -0.8))
    .map((s) => ({ start: s.start ?? 0, end: s.end ?? 0, text: cleanTranscript(s.text ?? '', prompt), words: s.words }))
    .filter((s) => s.text)
  const text = cleanTranscript(out.segments ? segments.map((s) => s.text).join(' ') : (out.text ?? ''), prompt)
  const result: TranscribeResult = { text, segments: text ? segments : [], durationS: Math.round(wav.durationS * 100) / 100 }
  return jsonResponse(result, 200, 'no-store')
}
