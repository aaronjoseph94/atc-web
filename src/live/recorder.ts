/**
 * Remembers the traffic this session has seen so it can be replayed.
 *
 * Every poll is appended to a per-aircraft track. Asking for a replay turns
 * those tracks into the same `ClipPack` shape the bundled audio clips use, so
 * the timeline, the map and the flight card all work on recorded live traffic
 * without knowing the difference. Tower-log events become the captions.
 */
import type { Aircraft, ClipPack, TrackSample, TranscriptCue } from '../api/types'
import type { LiveEvent } from './events'

/** How far back a replay can go. */
export const MAX_HISTORY_MS = 45 * 60_000

type Recorded = {
  callsign: string
  type: string | null
  registration: string | null
  category: string | null
  /** `t` is epoch milliseconds here; converted to clip time on export. */
  samples: (TrackSample & { t: number })[]
}

/** Movement below this (degrees, ~3 m) counts as standing still. */
const STILL_DEG = 0.00003

export class LiveRecorder {
  private tracks = new Map<string, Recorded>()
  private events: LiveEvent[] = []
  private firstAt: number | null = null

  /** Record one snapshot. `now` is epoch milliseconds. */
  push(aircraft: Aircraft[], now = Date.now()) {
    this.firstAt ??= now
    for (const a of aircraft) {
      let rec = this.tracks.get(a.icao24)
      if (!rec) {
        rec = { callsign: a.callsign, type: a.type ?? null, registration: a.registration ?? null, category: a.category ?? null, samples: [] }
        this.tracks.set(a.icao24, rec)
      }
      rec.callsign = a.callsign
      rec.type = a.type ?? rec.type
      const sample = {
        t: now,
        tMs: 0,
        lat: a.lat,
        lon: a.lon,
        heading: a.heading,
        altitudeFt: a.altitudeFt ?? undefined,
        speedKt: a.speedKt ?? undefined,
        onGround: a.onGround,
      }
      const s = rec.samples
      const last = s[s.length - 1]
      const before = s[s.length - 2]
      const still = (p: { lat: number; lon: number; onGround?: boolean } | undefined) => !!p && Math.abs(p.lat - a.lat) < STILL_DEG && Math.abs(p.lon - a.lon) < STILL_DEG && p.onGround === a.onGround
      // A parked aircraft would add an identical sample every poll: slide the
      // last one forward in time instead, keeping just "from" and "until".
      if (still(last) && still(before)) last.t = now
      else s.push(sample)
    }
    this.trim(now)
  }

  addEvents(events: LiveEvent[]) {
    this.events.push(...events)
  }

  /** Forget everything (airport change). */
  clear() {
    this.tracks.clear()
    this.events = []
    this.firstAt = null
  }

  /** Speed and altitude history for one aircraft, oldest first (for sparklines). */
  series(icao24: string): { t: number; altitudeFt: number | null; speedKt: number | null }[] {
    return (this.tracks.get(icao24)?.samples ?? []).map((s) => ({ t: s.t, altitudeFt: s.altitudeFt ?? null, speedKt: s.speedKt ?? null }))
  }

  /** Milliseconds of history available right now. */
  spanMs(now = Date.now()): number {
    return this.firstAt == null ? 0 : Math.min(MAX_HISTORY_MS, now - this.firstAt)
  }

  private trim(now: number) {
    const cutoff = now - MAX_HISTORY_MS
    if (this.firstAt != null && this.firstAt < cutoff) this.firstAt = cutoff
    for (const [id, rec] of this.tracks) {
      while (rec.samples.length > 2 && rec.samples[1].t < cutoff) rec.samples.shift()
      if (rec.samples[rec.samples.length - 1].t < cutoff) this.tracks.delete(id)
    }
    while (this.events.length && this.events[0].at < cutoff) this.events.shift()
  }

  /**
   * Package the recorded traffic as a replay. Tracks are keyed by transponder
   * address (callsigns repeat); events become timed captions.
   */
  toClip(airport: string, stationId: string, now = Date.now()): ClipPack | null {
    const start = this.firstAt
    if (start == null || now - start < 15_000) return null

    const tracks: ClipPack['tracks'] = {}
    const aircraft: NonNullable<ClipPack['aircraft']> = {}
    for (const [id, rec] of this.tracks) {
      if (rec.samples.length < 2) continue
      tracks[id] = rec.samples.map(({ t, ...rest }) => ({ ...rest, tMs: Math.max(0, t - start) }))
      aircraft[id] = { callsign: rec.callsign, type: rec.type ?? undefined, registration: rec.registration ?? undefined, category: rec.category ?? undefined }
    }

    const cues: TranscriptCue[] = this.events
      .filter((e) => e.at >= start && e.kind !== 'lineup')
      .map((e) => ({ id: e.id, startMs: e.at - start, endMs: e.at - start + 6000, text: e.text, callsign: e.icao24, speaker: 'Tower log' }))

    return {
      id: `rewind-${airport}-${start}`,
      kind: 'rewind',
      startedAt: start,
      stationId,
      airport,
      audioUrl: '',
      durationMs: now - start,
      title: `${airport} traffic replay`,
      description: 'Recorded from the live feed during this session.',
      cues,
      tracks,
      aircraft,
    }
  }
}
