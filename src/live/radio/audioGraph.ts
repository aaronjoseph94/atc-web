/**
 * The one Web Audio context the app uses, shared by replayed scenes and the
 * live radio (phones allow only a few contexts, and each must be unlocked by
 * a tap), plus the analysers the waveforms read.
 */

/** Spectrum taps for the waveform: one per audio source. Null until that source first plays. */
export const analysers: { replay: AnalyserNode | null; live: AnalyserNode | null } = { replay: null, live: null }

export type AnalyserSource = keyof typeof analysers

let ctx: AudioContext | null = null

/** The shared context, created on first use. Must first be called from a user gesture to start unmuted. */
export function getAudioContext(): AudioContext | null {
  if (ctx) return ctx
  if (typeof window === 'undefined') return null
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return null
  try {
    ctx = new Ctx({ latencyHint: 'playback' })
  } catch {
    try {
      ctx = new Ctx()
    } catch {
      return null
    }
  }
  return ctx
}

/** Resume the context (it starts suspended until a gesture, and phones suspend it in the background). */
export function resumeAudio() {
  if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => undefined)
}

/** A speech-tuned analyser: small FFT, gentle smoothing. */
export function makeAnalyser(context: AudioContext): AnalyserNode {
  const a = context.createAnalyser()
  a.fftSize = 256
  a.smoothingTimeConstant = 0.72
  return a
}
