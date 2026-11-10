/**
 * Turns a captured transmission into what the transcriber wants: 16 kHz,
 * mono, 16-bit PCM WAV, levelled so quiet feeds are as legible as loud ones.
 */

export const TRANSCRIBE_RATE = 16_000

/**
 * Resample to `to` Hz. Each output sample averages the input it covers (a box
 * filter), which is plenty of anti-aliasing for radio audio: the streams are
 * 8 kHz to begin with, so there is nothing above 4 kHz to fold back.
 */
export function resample(input: Float32Array, from: number, to = TRANSCRIBE_RATE): Float32Array {
  if (from === to) return input.slice()
  const ratio = from / to
  const n = Math.floor(input.length / ratio)
  const out = new Float32Array(n)
  if (ratio > 1) {
    for (let i = 0; i < n; i++) {
      const a = i * ratio
      const b = Math.min(input.length, a + ratio)
      let sum = 0
      let count = 0
      for (let k = Math.floor(a); k < b; k++) {
        sum += input[k]
        count++
      }
      out[i] = count ? sum / count : 0
    }
  } else {
    // Upsampling: linear interpolation.
    for (let i = 0; i < n; i++) {
      const x = i * ratio
      const k = Math.floor(x)
      const f = x - k
      out[i] = input[k] * (1 - f) + (input[Math.min(input.length - 1, k + 1)] ?? 0) * f
    }
  }
  return out
}

/** Scale so the loudest sample sits at `peak` (never amplifying more than 12x, which would just raise hiss). */
export function normalize(input: Float32Array, peak = 0.89): Float32Array {
  let max = 0
  for (let i = 0; i < input.length; i++) max = Math.max(max, Math.abs(input[i]))
  if (max < 1e-4) return input.slice()
  const gain = Math.min(12, peak / max)
  const out = new Float32Array(input.length)
  for (let i = 0; i < input.length; i++) out[i] = input[i] * gain
  return out
}

/** 16-bit PCM WAV bytes for mono samples in [-1, 1]. */
export function encodeWav(samples: Float32Array, sampleRate = TRANSCRIBE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const v = new DataView(bytes.buffer)
  const ascii = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  ascii(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return bytes
}

/** The whole pipeline: captured samples at the audio context's rate → WAV for upload. */
export function transmissionWav(samples: Float32Array, sampleRate: number): Uint8Array {
  return encodeWav(normalize(resample(samples, sampleRate)))
}
