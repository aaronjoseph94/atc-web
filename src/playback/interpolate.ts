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

/** Aircraft positions (and the active trail) at one moment in a clip. */
export function positionsAt(
  clip: ClipPack | null,
  tMs: number,
  activeCallsign: string | null,
  selectedIcao: string | null,
): { aircraft: Aircraft[]; trail: [number, number][] } {
  if (!clip) return { aircraft: [], trail: [] }
  const aircraft: Aircraft[] = []
  let trail: [number, number][] = []
  for (const [cs, samples] of Object.entries(clip.tracks)) {
    // Arrivals enter and departures leave: only draw a track inside its own span.
    if (!trackVisibleAt(samples, tMs)) continue
    const p = interpolateTrack(samples, tMs)
    if (!p) continue
    const icao = cs.toLowerCase()
    const extra = clip.aircraft?.[cs]
    aircraft.push({
      icao24: icao,
      callsign: cs,
      lat: p.lat,
      lon: p.lon,
      heading: p.heading,
      altitudeFt: p.altitudeFt ?? null,
      speedKt: p.speedKt ?? null,
      onGround: sampleOnGround(p),
      type: extra?.type ?? null,
      registration: extra?.registration ?? null,
    })
    if (activeCallsign === cs || selectedIcao === icao) {
      trail = samples.filter((s) => s.tMs <= tMs).map((s) => [s.lon, s.lat] as [number, number])
      trail.push([p.lon, p.lat])
    }
  }
  return { aircraft, trail }
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
