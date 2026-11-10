import { describe, expect, it } from 'vitest'
import { encodeWav } from '../live/radio/wav'
import { buildPrompt, cleanTranscript, handleTranscribe, parseWav, RateLimiter, type AiBinding } from './transcribeHandler'

const tone = (seconds: number, rate = 16000) => {
  const s = new Float32Array(Math.round(seconds * rate))
  for (let i = 0; i < s.length; i++) s[i] = 0.3 * Math.sin((i / rate) * 2 * Math.PI * 440)
  return encodeWav(s, rate)
}

const post = (body: Uint8Array, headers: Record<string, string> = {}, query = '') =>
  new Request(`https://atc.example/api/transcribe${query}`, { method: 'POST', body: body as BodyInit, headers: { 'Content-Type': 'audio/wav', ...headers } })

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
    const res = await handleTranscribe(post(tone(1.5), {}, '?facility=JFK%20Tower&callsigns=Delta%20288'), { AI: ai }, new RateLimiter(5, 1))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: 'Delta 288, cleared to land.', segments: [{ start: 0, end: 1.2, text: 'Delta 288, cleared to land.' }], durationS: 1.5 })
    expect(typeof seen[0].audio).toBe('string')
    expect(seen[0].initial_prompt).toContain('Delta 288')
    expect(seen[0].language).toBe('en')
  })

  it('drops segments the model marks as noise', async () => {
    const ai = fakeAi({ text: 'Thank you.', segments: [{ start: 0, end: 1, text: 'Thank you.', no_speech_prob: 0.9, avg_logprob: -1.2 }] })
    const res = await handleTranscribe(post(tone(1)), { AI: ai }, new RateLimiter(5, 1))
    expect(await res.json()).toMatchObject({ text: '', segments: [] })
  })

  it('refuses bad input, other sites and floods', async () => {
    const ai = fakeAi({ text: 'x' })
    const limiter = new RateLimiter(1, 0)
    expect((await handleTranscribe(post(new Uint8Array(200)), { AI: ai }, new RateLimiter(5, 1))).status).toBe(415)
    expect((await handleTranscribe(post(tone(0.1)), { AI: ai }, new RateLimiter(5, 1))).status).toBe(422)
    expect((await handleTranscribe(post(tone(1), { Origin: 'https://evil.example' }), { AI: ai }, new RateLimiter(5, 1))).status).toBe(403)
    expect((await handleTranscribe(post(tone(1), { Origin: 'https://atc.example' }), { AI: ai }, limiter)).status).toBe(200)
    expect((await handleTranscribe(post(tone(1)), { AI: ai }, limiter)).status).toBe(429)
  })
})
