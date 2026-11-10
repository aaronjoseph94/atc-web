import { describe, expect, it } from 'vitest'
import { distanceM } from './geo'
import { arc, burstDone, EMIT_MS, liveRippleMs, rippleEnvelope, rippleFeatures, TRAVEL_MS, waveOpacity, wavefronts } from './ripple'

const tower: [number, number] = [-73.7789, 40.6398]
const plane: [number, number] = [-73.75, 40.65]

describe('transmission ripple', () => {
  it('emits a wavefront every EMIT_MS and lets each cross in TRAVEL_MS', () => {
    expect(wavefronts(-1, 5000)).toEqual([])
    expect(wavefronts(EMIT_MS / 2, 5000)).toEqual([EMIT_MS / 2 / TRAVEL_MS])
    const later = wavefronts(EMIT_MS * 2 + 10, 5000)
    expect(later.length).toBe(3)
    // Oldest first, each further along than the next.
    expect(later[0]).toBeGreaterThan(later[1])
    expect(later[1]).toBeGreaterThan(later[2])
  })

  it('stops emitting when the call ends and finishes the waves in flight', () => {
    const stop = 1000
    expect(wavefronts(stop + 200, stop).length).toBeGreaterThan(0)
    expect(burstDone(stop + 200, stop)).toBe(false)
    expect(burstDone(Math.floor(stop / EMIT_MS) * EMIT_MS + TRAVEL_MS, stop)).toBe(true)
    expect(burstDone(1e9, Infinity)).toBe(false)
  })

  it('fades waves in and out instead of popping', () => {
    expect(waveOpacity(0)).toBe(0)
    expect(waveOpacity(1)).toBe(0)
    expect(waveOpacity(0.02)).toBeLessThan(0.1)
    expect(waveOpacity(0.5)).toBeCloseTo(1)
    expect(waveOpacity(0.98)).toBeLessThan(0.1)
  })

  it('draws an arc centred on the speaker that reaches the listener', () => {
    const mpp = 5
    const mid = arc(tower, plane, 0.5, mpp)
    const end = arc(tower, plane, 0.9999, mpp)
    const full = distanceM(tower, plane)
    expect(mid.length).toBeGreaterThan(5)
    // Every point of an arc is the same distance from the speaker.
    const r = distanceM(tower, mid[0])
    for (const p of mid) expect(distanceM(tower, p)).toBeCloseTo(r, 0)
    expect(r).toBeLessThan(full)
    expect(distanceM(tower, end[Math.floor(end.length / 2)])).toBeCloseTo(full, -1)
    // About ARC_HALF_PX either side on screen: the chord is a few dozen pixels, not the whole map.
    const chordPx = distanceM(mid[0], mid[mid.length - 1]) / mpp
    expect(chordPx).toBeGreaterThan(20)
    expect(chordPx).toBeLessThan(60)
    expect(arc(tower, tower, 0.5, mpp)).toEqual([])
  })

  it('builds a guide line and waves with colour and opacity on each feature', () => {
    const f = rippleFeatures(tower, plane, 600, 3000, 5, '#A994FF', { beam: 1, waves: 1 })
    expect(f[0].properties).toMatchObject({ kind: 'beam', c: '#A994FF' })
    expect(f.slice(1).every((x) => x.properties?.kind === 'wave')).toBe(true)
    expect(rippleFeatures(tower, plane, 600, 3000, 5, '#fff', { beam: 1, waves: 0 }).length).toBe(1)
  })

  it('fades the guide line out once the call stops, but never the waves in flight', () => {
    expect(rippleEnvelope(0, null).beam).toBe(0)
    expect(rippleEnvelope(1000, null)).toEqual({ beam: 1, waves: 1 })
    expect(rippleEnvelope(1000 + TRAVEL_MS, 1000).beam).toBe(0)
    expect(rippleEnvelope(1000 + TRAVEL_MS, 1000).waves).toBe(1)
  })

  it('ripples live calls for about their own length, within limits', () => {
    expect(liveRippleMs(500)).toBe(2600)
    expect(liveRippleMs(4000)).toBe(4000)
    expect(liveRippleMs(20000)).toBe(6000)
  })
})
