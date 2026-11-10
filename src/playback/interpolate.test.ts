import { describe, expect, it } from 'vitest'
import { climbRateAt, cueProgress, getActiveCue, interpolateTrack, positionsAt, trackKeyFor, trailAt } from './interpolate'
import type { ClipPack, TrackSample, TranscriptCue } from '../api/types'

const samples: TrackSample[] = [
  { tMs: 0, lat: 41.97, lon: -87.9, heading: 90, altitudeFt: 0, speedKt: 0 },
  { tMs: 1000, lat: 41.98, lon: -87.89, heading: 100, altitudeFt: 100, speedKt: 40 },
]

const cues: TranscriptCue[] = [
  { id: '1', startMs: 0, endMs: 2000, text: 'hello' },
  { id: '2', startMs: 2000, endMs: 4000, text: 'world', callsign: 'UAL1' },
]

describe('interpolateTrack', () => {
  it('returns null for empty', () => {
    expect(interpolateTrack([], 500)).toBeNull()
  })

  it('clamps before first and after last', () => {
    expect(interpolateTrack(samples, -10)?.lat).toBe(41.97)
    expect(interpolateTrack(samples, 9999)?.lat).toBe(41.98)
  })

  it('lerps midpoint', () => {
    const m = interpolateTrack(samples, 500)!
    expect(m.lat).toBeCloseTo(41.975)
    expect(m.lon).toBeCloseTo(-87.895)
    expect(m.heading).toBeCloseTo(95)
  })
})

describe('getActiveCue / cueProgress', () => {
  it('picks cue by playhead', () => {
    expect(getActiveCue(cues, 100)?.id).toBe('1')
    expect(getActiveCue(cues, 2500)?.callsign).toBe('UAL1')
    expect(getActiveCue(cues, 5000)).toBeNull()
  })

  it('reports spoken fraction', () => {
    expect(cueProgress(cues[0], 0)).toBe(0)
    expect(cueProgress(cues[0], 1000)).toBe(0.5)
    expect(cueProgress(cues[0], 2000)).toBe(1)
  })
})

describe('positionsAt / trailAt', () => {
  const clip: ClipPack = {
    id: 'x',
    stationId: 'ord-tower',
    audioUrl: '',
    durationMs: 10_000,
    title: 'x',
    cues: [],
    tracks: {
      UAL1: samples,
      // Enters the scene late and is on the ground at field elevation, flagged explicitly.
      a1b2c3: [
        { tMs: 5000, lat: 41, lon: -87, heading: 0, altitudeFt: 680, speedKt: 0, onGround: true },
        { tMs: 9000, lat: 41.001, lon: -87, heading: 0, altitudeFt: 680, speedKt: 20, onGround: true },
      ],
    },
    aircraft: { a1b2c3: { callsign: 'DAL9', type: 'A321' } },
  }

  it('draws each aircraft only inside its own track span', () => {
    expect(positionsAt(clip, 500).map((a) => a.icao24)).toEqual(['ual1'])
    expect(positionsAt(clip, 6000).map((a) => a.icao24)).toEqual(['a1b2c3'])
    expect(positionsAt(null, 0)).toEqual([])
  })

  it('uses clip metadata for callsign, type and surface state', () => {
    const [a] = positionsAt(clip, 6000)
    expect(a).toMatchObject({ callsign: 'DAL9', type: 'A321', onGround: true, altitudeFt: 680 })
    expect(trackKeyFor(clip, 'ual1')).toBe('UAL1')
    expect(trackKeyFor(clip, 'nope')).toBeUndefined()
  })

  it('returns the path flown so far and a climb rate', () => {
    const trail = trailAt(samples, 500)
    expect(trail).toHaveLength(2)
    expect(trail[0]).toEqual([-87.9, 41.97])
    expect(trail[1][0]).toBeCloseTo(-87.895)
    expect(trail[1][1]).toBeCloseTo(41.975)
    expect(trailAt(clip.tracks.a1b2c3, 100)).toEqual([])
    // 100 ft in one second is 6,000 ft/min.
    expect(climbRateAt(samples, 500)).toBe(6000)
  })
})
