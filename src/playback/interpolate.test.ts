import { describe, expect, it } from 'vitest'
import { cueProgress, getActiveCue, interpolateTrack } from './interpolate'
import type { TrackSample, TranscriptCue } from '../api/types'

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
