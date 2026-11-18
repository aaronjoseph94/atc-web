/* oxlint-disable no-await-in-loop -- the steps in these tests happen one after another on purpose */
import { describe, expect, it } from 'vitest'
import { encodeWav } from '../live/radio/wav'
import { signSession } from './session'
import { memoryStorage, storeCounters } from './storage'
import { buildPrompt, cleanTranscript, DEFAULT_TRANSCRIBE_DAILY_CAP, handleTranscribe, parseWav, RateLimiter, transcribeDailyCap, type AiBinding } from './transcribeHandler'

const tone = (seconds: number, rate = 16000) => {
  const s = new Float32Array(Math.round(seconds * rate))
  for (let i = 0; i < s.length; i++) s[i] = 0.3 * Math.sin((i / rate) * 2 * Math.PI * 440)
  return encodeWav(s, rate)
}

const post = (body: Uint8Array, headers: Record<string, string> = {}, query = '') =>
  new Request(`https://atc.example/api/transcribe${query}`, { method: 'POST', body: body as BodyInit, headers: { 'Content-Type': 'audio/wav', Origin: 'https://atc.example', ...headers } })

const fakeAi = (output: unknown, seen: Record<string, unknown>[] = []): AiBinding => ({
  run: async (_model, input) => {
    seen.push(input)
    return output
  },
})

describe('parseWav', () => {
  it('reads the header the client writes', () => {
    expect(parseWav(tone(2))).toEqual({ sampleRate: 16000, channels: 1, bitsPerSample: 16, durationS: 2 })
  })
  it('rejects anything else', () => {
    expect(parseWav(new Uint8Array(100))).toBeNull()
    expect(parseWav(new TextEncoder().encode('ID3 not a wav at all, just some bytes padded out to length....'))).toBeNull()
  })
})

describe('RateLimiter', () => {
  it('allows a burst, then refills over time', () => {
    const l = new RateLimiter(3, 1)
    expect([l.take('a', 0), l.take('a', 0), l.take('a', 0), l.take('a', 0)]).toEqual([true, true, true, false])
    expect(l.take('b', 0)).toBe(true)
    expect(l.take('a', 1500)).toBe(true)
  })
})

describe('prompt and clean-up', () => {
  it('steers toward the facility and the callsigns around', () => {
    const p = buildPrompt('JFK Tower', 'Delta 288, JetBlue 1407<script>')
    expect(p).toMatch(/^JFK Tower\. Air traffic control radio/)
    expect(p).toContain('Aircraft: Delta 288, JetBlue 1407 script')
    expect(p).not.toContain('<')
  })
  it('drops what Whisper says over noise', () => {
    expect(cleanTranscript(' Thank you. ')).toBe('')
    expect(cleanTranscript('Thanks for watching!')).toBe('')
    expect(cleanTranscript('you')).toBe('')
    expect(cleanTranscript('Delta 288, cleared to land.')).toBe('Delta 288, cleared to land.')
    expect(cleanTranscript('Cleared to land, cleared for takeoff, line up and wait.', buildPrompt(null, null))).toBe('')
  })
})

describe('handleTranscribe', () => {
  it('answers 501 without the AI binding', async () => {
    const res = await handleTranscribe(post(tone(1)), {})
    expect(res.status).toBe(501)
    expect(await res.json()).toMatchObject({ code: 'no-ai' })
  })

  it('sends base64 audio with the prompt and returns cleaned text', async () => {
    const seen: Record<string, unknown>[] = []
    const ai = fakeAi({ text: 'Delta 288 cleared to land', segments: [{ start: 0, end: 1.2, text: ' Delta 288, cleared to land.', no_speech_prob: 0.01, avg_logprob: -0.2 }] }, seen)
    const res = await handleTranscribe(post(tone(1.5), {}, '?facility=JFK%20Tower&callsigns=Delta%20288'), { AI: ai }, { limiter: new RateLimiter(5, 1) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: 'Delta 288, cleared to land.', segments: [{ start: 0, end: 1.2, text: 'Delta 288, cleared to land.' }], durationS: 1.5 })
    expect(typeof seen[0].audio).toBe('string')
    expect(seen[0].initial_prompt).toContain('Delta 288')
    expect(seen[0].language).toBe('en')
  })

  it('drops segments the model marks as noise', async () => {
    const ai = fakeAi({ text: 'Thank you.', segments: [{ start: 0, end: 1, text: 'Thank you.', no_speech_prob: 0.9, avg_logprob: -1.2 }] })
    const res = await handleTranscribe(post(tone(1)), { AI: ai }, { limiter: new RateLimiter(5, 1) })
    expect(await res.json()).toMatchObject({ text: '', segments: [] })
  })

  it('refuses bad input, other sites and floods', async () => {
    const ai = fakeAi({ text: 'x' })
    const limiter = new RateLimiter(1, 0)
    expect((await handleTranscribe(post(new Uint8Array(200)), { AI: ai }, { limiter: new RateLimiter(5, 1) })).status).toBe(415)
    expect((await handleTranscribe(post(tone(0.1)), { AI: ai }, { limiter: new RateLimiter(5, 1) })).status).toBe(422)
    expect((await handleTranscribe(post(tone(1), { Origin: 'https://evil.example' }), { AI: ai }, { limiter: new RateLimiter(5, 1) })).status).toBe(403)
    expect((await handleTranscribe(post(tone(1), { Origin: 'https://atc.example' }), { AI: ai }, { limiter })).status).toBe(200)
    expect((await handleTranscribe(post(tone(1)), { AI: ai }, { limiter })).status).toBe(429)
  })
})

describe('handleTranscribe: who may spend the account', () => {
  const now = Date.UTC(2026, 10, 16, 12)
  const counters = () => storeCounters(memoryStorage(() => now), { mirror: new Map(), now: () => now })
  const bare = (body: Uint8Array, headers: Record<string, string> = {}) =>
    new Request('https://atc.example/api/transcribe', { method: 'POST', body: body as BodyInit, headers: { 'Content-Type': 'audio/wav', ...headers } })

  it('refuses a request that names no origin at all (a script), and accepts the browser’s same-origin signals', async () => {
    const ai = fakeAi({ text: 'x' })
    const res = await handleTranscribe(bare(tone(1)), { AI: ai }, { limiter: new RateLimiter(5, 1), counters: counters(), now })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'origin' })
    expect((await handleTranscribe(bare(tone(1), { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://atc.example' }), { AI: ai }, { limiter: new RateLimiter(5, 1), counters: counters(), now })).status).toBe(403)
    expect((await handleTranscribe(bare(tone(1), { 'Sec-Fetch-Site': 'same-origin' }), { AI: ai }, { limiter: new RateLimiter(5, 1), counters: counters(), now })).status).toBe(200)
    expect((await handleTranscribe(bare(tone(1), { Referer: 'https://atc.example/live' }), { AI: ai }, { limiter: new RateLimiter(5, 1), counters: counters(), now })).status).toBe(200)
  })

  it('stops at the site-wide daily cap with 429 daily_cap, and starts again the next day', async () => {
    let calls = 0
    const ai: AiBinding = {
      run: async () => {
        calls++
        return { text: 'delta 288' }
      },
    }
    const c = counters()
    const env = { AI: ai, TRANSCRIBE_DAILY_CAP: '2' }
    const statuses: number[] = []
    for (let i = 0; i < 3; i++) statuses.push((await handleTranscribe(post(tone(1), { 'CF-Connecting-IP': `198.51.100.${i}` }), env, { limiter: new RateLimiter(5, 1), counters: c, now })).status)
    expect(statuses).toEqual([200, 200, 429])
    expect(calls).toBe(2)
    const res = await handleTranscribe(post(tone(1)), env, { limiter: new RateLimiter(5, 1), counters: c, now })
    expect(await res.json()).toMatchObject({ code: 'daily_cap' })
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    // Uploads refused for other reasons are not counted.
    const fresh = counters()
    expect((await handleTranscribe(post(new Uint8Array(200)), { AI: ai, TRANSCRIBE_DAILY_CAP: '1' }, { limiter: new RateLimiter(5, 1), counters: fresh, now })).status).toBe(415)
    expect((await handleTranscribe(post(tone(1)), { AI: ai, TRANSCRIBE_DAILY_CAP: '1' }, { limiter: new RateLimiter(5, 1), counters: fresh, now })).status).toBe(200)
    const tomorrow = now + 24 * 3600_000
    expect((await handleTranscribe(post(tone(1)), env, { limiter: new RateLimiter(5, 1), counters: c, now: tomorrow })).status).toBe(200)
  })

  it('defaults the cap to 2000, and 0 switches transcripts off', async () => {
    expect(DEFAULT_TRANSCRIBE_DAILY_CAP).toBe(2000)
    expect(transcribeDailyCap({})).toBe(2000)
    expect(transcribeDailyCap({ TRANSCRIBE_DAILY_CAP: 'lots' })).toBe(2000)
    expect((await handleTranscribe(post(tone(1)), { AI: fakeAi({ text: 'x' }), TRANSCRIBE_DAILY_CAP: '0' }, { limiter: new RateLimiter(5, 1), counters: counters(), now })).status).toBe(429)
  })

  it('rate limits an IPv6 visitor by its /64, however many addresses it rotates through', async () => {
    const ai = fakeAi({ text: 'x' })
    const limiter = new RateLimiter(2, 0)
    const ip = (n: number) => ({ 'CF-Connecting-IP': `2001:db8:1:2::${n.toString(16)}` })
    const out: number[] = []
    for (let i = 1; i <= 4; i++) out.push((await handleTranscribe(post(tone(1), ip(i)), { AI: ai }, { limiter, counters: counters(), now })).status)
    expect(out).toEqual([200, 200, 429, 429])
    // A different /64 has its own allowance.
    expect((await handleTranscribe(post(tone(1), { 'CF-Connecting-IP': '2001:db8:1:3::1' }), { AI: ai }, { limiter, counters: counters(), now })).status).toBe(200)
  })

  it('wants a session token when the Turnstile gate is on', async () => {
    const gate = { TURNSTILE_SITE_KEY: 'site-key', TURNSTILE_SECRET_KEY: 'secret-key' }
    const ai = fakeAi({ text: 'x' })
    const ip = { 'CF-Connecting-IP': '203.0.113.9' }
    const no = await handleTranscribe(post(tone(1), ip), { AI: ai, ...gate }, { limiter: new RateLimiter(5, 1), counters: counters(), now })
    expect(no.status).toBe(401)
    expect(await no.json()).toMatchObject({ code: 'session', siteKey: 'site-key' })
    const { token } = await signSession(gate, '203.0.113.9', now)
    expect((await handleTranscribe(post(tone(1), { ...ip, 'x-atc-session': token }), { AI: ai, ...gate }, { limiter: new RateLimiter(5, 1), counters: counters(), now })).status).toBe(200)
    // Gate off: the same request without a token goes through as before.
    expect((await handleTranscribe(post(tone(1), ip), { AI: ai }, { limiter: new RateLimiter(5, 1), counters: counters(), now })).status).toBe(200)
  })
})
