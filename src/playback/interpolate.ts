import type { TrackSample, TranscriptCue } from '../api/types'

export function interpolateTrack(
  samples: TrackSample[],
  tMs: number,
): TrackSample | null {
  if (!samples.length) return null
  if (tMs <= samples[0].tMs) return samples[0]
  const last = samples[samples.length - 1]
  if (tMs >= last.tMs) return last

  let i = 1
  while (i < samples.length && samples[i].tMs < tMs) i++
  const a = samples[i - 1]
  const b = samples[i]
  const span = b.tMs - a.tMs
  const u = span === 0 ? 0 : (tMs - a.tMs) / span

  return {
    tMs,
    lat: lerp(a.lat, b.lat, u),
    lon: lerp(a.lon, b.lon, u),
    heading: lerpAngle(a.heading, b.heading, u),
    altitudeFt:
      a.altitudeFt != null && b.altitudeFt != null
        ? Math.round(lerp(a.altitudeFt, b.altitudeFt, u))
        : (b.altitudeFt ?? a.altitudeFt),
    speedKt:
      a.speedKt != null && b.speedKt != null
        ? Math.round(lerp(a.speedKt, b.speedKt, u))
        : (b.speedKt ?? a.speedKt),
  }
}

export function getActiveCue(cues: TranscriptCue[], tMs: number): TranscriptCue | null {
  for (const c of cues) {
    if (tMs >= c.startMs && tMs < c.endMs) return c
  }
  return null
}

/** Fraction of cue text considered "spoken" for karaoke (0..1). */
export function cueProgress(cue: TranscriptCue, tMs: number): number {
  const span = cue.endMs - cue.startMs
  if (span <= 0) return 1
  return Math.min(1, Math.max(0, (tMs - cue.startMs) / span))
}

function lerp(a: number, b: number, u: number) {
  return a + (b - a) * u
}

function lerpAngle(a: number, b: number, u: number) {
  let d = ((b - a + 540) % 360) - 180
  return (a + d * u + 360) % 360
}
