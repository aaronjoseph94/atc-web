import { describe, expect, it } from 'vitest'
import { Segmenter } from './segmenter'
import { encodeWav, normalize, resample, transmissionWav } from './wav'

const RATE = 8000

/**
 * Speech-like bursts between stretches of squelch: `[seconds, loud?]` pieces,
 * or `[seconds, level]` for a quiet stretch at a given hiss level.
 */
function radio(pieces: [number, boolean | number][], rate = RATE): Float32Array {
  const total = pieces.reduce((n, [s]) => n + Math.round(s * rate), 0)
  const out = new Float32Array(total)
  let o = 0
  let seed = 7
  const noise = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647 - 0.5
  }
  for (const [s, loud] of pieces) {
    const n = Math.round(s * rate)
    for (let i = 0; i < n; i++) {
      // Speech: a wobbling tone with syllable-rate gaps; quiet: faint hiss.
      const syllable = Math.sin(((o + i) / rate) * 2 * Math.PI * 4) > -0.6
      const hiss = typeof loud === 'number' ? loud : 0.002
      out[o + i] = loud === true && syllable ? 0.25 * Math.sin(((o + i) / rate) * 2 * Math.PI * 300) + 0.05 * noise() : hiss * noise()
    }
    o += n
  }
  return out
}

/** Feed in 2048-sample chunks, like the audio tap does. */
function run(seg: Segmenter, samples: Float32Array) {
  const out = []
  for (let i = 0; i < samples.length; i += 2048) out.push(...seg.push(samples.subarray(i, i + 2048)))
  return out
}

describe('Segmenter', () => {
  it('cuts each call out of the squelch gaps', () => {
    const seg = new Segmenter({ sampleRate: RATE })
    const calls = run(seg, radio([[2, false], [2.5, true], [1.5, false], [3.2, true], [2, false]]))
    expect(calls).toHaveLength(2)
    expect(calls[0].durationMs).toBeGreaterThan(2400)
    expect(calls[0].durationMs).toBeLessThan(3300)
    // The cut starts a little before the call, not seconds early.
    expect(calls[0].startS).toBeGreaterThan(1.6)
    expect(calls[0].startS).toBeLessThan(2.05)
    expect(calls[1].startS).toBeGreaterThan(5.6)
    expect(calls[1].durationMs).toBeGreaterThan(3100)
  })

  it('keeps short pauses inside one call', () => {
    // A pause while the transmitter is keyed carries its hiss.
    const seg = new Segmenter({ sampleRate: RATE })
    const calls = run(seg, radio([[1, false], [1.2, true], [0.35, 0.006], [1.2, true], [1.5, false]]))
    expect(calls).toHaveLength(1)
    // An unsquelched feed hisses all the time; there, only the hangover ends a call.
    const open = new Segmenter({ sampleRate: RATE })
    expect(run(open, radio([[2, 0.012], [1.2, true], [0.4, 0.012], [1.2, true], [1.5, 0.012]]))).toHaveLength(1)
  })

  it('splits a quick reply on a squelched feed, but not a pause in one call', () => {
    // Squelched feed: dead air between calls, carrier hiss in a pause while keyed.
    const seg = new Segmenter({ sampleRate: RATE })
    const calls = run(seg, radio([[2, 0], [2, true], [0.35, 0], [1.8, true], [0.4, 0.006], [1.2, true], [2, 0]]))
    expect(calls).toHaveLength(2)
    expect(calls[0].durationMs).toBeLessThan(2600)
    expect(calls[1].durationMs).toBeGreaterThan(3200)
  })

  it('ignores clicks and squelch tails', () => {
    const seg = new Segmenter({ sampleRate: RATE })
    expect(run(seg, radio([[1, false], [0.25, true], [1.5, false]]))).toHaveLength(0)
  })

  it('splits a stuck microphone at the maximum length', () => {
    const seg = new Segmenter({ sampleRate: RATE, maxMs: 5000 })
    const calls = run(seg, radio([[1, false], [12, true], [1.5, false]]))
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(calls[0].cut).toBe(true)
    expect(calls[0].durationMs).toBeLessThanOrEqual(5100)
  })

  it('hands over a call still open when flushed', () => {
    const seg = new Segmenter({ sampleRate: RATE })
    run(seg, radio([[1, false], [2, true]]))
    expect(seg.speaking).toBe(true)
    expect(seg.flush()?.durationMs).toBeGreaterThan(1800)
    expect(seg.speaking).toBe(false)
  })
})

describe('wav', () => {
  it('resamples 48 kHz to 16 kHz', () => {
    const s = new Float32Array(48000).fill(0.5)
    const r = resample(s, 48000)
    expect(r.length).toBe(16000)
    expect(r[100]).toBeCloseTo(0.5)
    expect(resample(new Float32Array(8000), 8000).length).toBe(16000)
  })

  it('levels quiet audio without boosting silence', () => {
    expect(Math.max(...normalize(new Float32Array([0.1, -0.2, 0.05])))).toBeCloseTo(0.89 * 0.5)
    expect(normalize(new Float32Array([0.01, -0.02]))[1]).toBeCloseTo(-0.24)
    expect(normalize(new Float32Array(4))[0]).toBe(0)
  })

  it('writes a 16-bit mono WAV header', () => {
    const w = encodeWav(new Float32Array([0, 1, -1]), 16000)
    const v = new DataView(w.buffer)
    expect(String.fromCharCode(...w.subarray(0, 4))).toBe('RIFF')
    expect(v.getUint32(24, true)).toBe(16000)
    expect(v.getUint16(34, true)).toBe(16)
    expect(v.getInt16(46, true)).toBe(32767)
    expect(v.getInt16(48, true)).toBe(-32768)
    expect(transmissionWav(new Float32Array(48000), 48000).length).toBe(44 + 32000)
  })
})
