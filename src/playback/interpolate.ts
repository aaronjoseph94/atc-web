import type { Aircraft, ClipPack, TrackSample, TranscriptCue } from '../api/types'

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
    // Wheels leave or touch the ground at the sample boundary, not halfway.
    onGround: u < 1 ? a.onGround : b.onGround,
  }
}

/** Grace period either side of a track during which the aircraft stays drawn. */
const TRACK_EDGE_MS = 250

/** True while `tMs` falls inside the span a track covers (aircraft is "on stage"). */
export function trackVisibleAt(samples: TrackSample[], tMs: number): boolean {
  if (!samples.length) return false
  return tMs >= samples[0].tMs - TRACK_EDGE_MS && tMs <= samples[samples.length - 1].tMs + TRACK_EDGE_MS
}

/** A sample's surface state: the explicit flag, else "below 50 ft". */
export function sampleOnGround(p: TrackSample): boolean {
  return p.onGround ?? (p.altitudeFt ?? 0) < 50
}

/**
 * Stable id for a track key. Scenes key tracks by callsign and rewinds by
 * transponder address; lower-casing either gives the `icao24` the rest of the
 * app selects and highlights by.
 */
export const trackId = (key: string) => key.toLowerCase()

/** Find a clip's track key from an aircraft id, whatever its letter case. */
export function trackKeyFor(clip: ClipPack, icao24: string): string | undefined {
  const id = icao24.toLowerCase()
  return clip.tracks[icao24] ? icao24 : Object.keys(clip.tracks).find((k) => k.toLowerCase() === id)
}

/** Aircraft positions at one moment in a clip. */
export function positionsAt(clip: ClipPack | null, tMs: number): Aircraft[] {
  if (!clip) return []
  const aircraft: Aircraft[] = []
  for (const [key, samples] of Object.entries(clip.tracks)) {
    // Arrivals enter and departures leave: only draw a track inside its own span.
    if (!trackVisibleAt(samples, tMs)) continue
    const p = interpolateTrack(samples, tMs)
    if (!p) continue
    const extra = clip.aircraft?.[key]
    aircraft.push({
      icao24: trackId(key),
      callsign: extra?.callsign ?? key,
      lat: p.lat,
      lon: p.lon,
      heading: p.heading,
      altitudeFt: p.altitudeFt ?? null,
      speedKt: p.speedKt ?? null,
      onGround: sampleOnGround(p),
      type: extra?.type ?? null,
      registration: extra?.registration ?? null,
      category: extra?.category ?? null,
      verticalRateFpm: climbRateAt(samples, tMs),
    })
  }
  return aircraft
}

/** Path flown so far by one track, ending at its interpolated position. */
export function trailAt(samples: TrackSample[], tMs: number, maxPoints = 240): [number, number][] {
  const p = interpolateTrack(samples, tMs)
  if (!p || !trackVisibleAt(samples, tMs)) return []
  const past = samples.filter((s) => s.tMs <= tMs).slice(-maxPoints)
  const out = past.map((s) => [s.lon, s.lat] as [number, number])
  out.push([p.lon, p.lat])
  return out
}

/** Approximate vertical speed (ft/min) from the samples either side of `tMs`. */
export function climbRateAt(samples: TrackSample[], tMs: number): number | null {
  const a = interpolateTrack(samples, tMs - 1500)
  const b = interpolateTrack(samples, tMs + 1500)
  if (!a || !b || a.altitudeFt == null || b.altitudeFt == null || b.tMs <= a.tMs) return null
  return Math.round((b.altitudeFt - a.altitudeFt) / ((b.tMs - a.tMs) / 60000))
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
  const d = ((b - a + 540) % 360) - 180
  return (a + d * u + 360) % 360
}
