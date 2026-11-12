import { describe, expect, it } from 'vitest'
import { GLOW_OPACITY, TALK_FADE_IN_MS, TALK_FADE_OUT_MS, talkFade, talkWaves, WAVE_COUNT, waveEnvelope, waveExtent, WAVE_PEAK, WAVE_PERIOD_MS, WAVE_SOFTNESS, waveTravel } from './talkWaves'

describe('talk waves', () => {
  it('is slow and faint: a mellow pulse, not a blink', () => {
    expect(WAVE_PERIOD_MS).toBeGreaterThanOrEqual(2200)
    expect(WAVE_PERIOD_MS).toBeLessThanOrEqual(2800)
    expect(WAVE_PEAK).toBeLessThanOrEqual(0.35)
    expect(GLOW_OPACITY).toBeLessThanOrEqual(0.35)
    expect(WAVE_COUNT).toBeGreaterThanOrEqual(2)
    expect(WAVE_COUNT).toBeLessThanOrEqual(3)
  })

  it('fades each ring in from nothing and out to nothing, so the loop has no seam', () => {
    expect(waveEnvelope(0)).toBe(0)
    expect(waveEnvelope(1)).toBe(0)
    expect(waveEnvelope(0.001)).toBeLessThan(0.01)
    expect(waveEnvelope(0.999)).toBeLessThan(0.01)
    let peak = 0
    let last = 0
    for (let i = 0; i <= 200; i++) {
      const v = waveEnvelope(i / 200)
      peak = Math.max(peak, v)
      // No jumps: neighbouring frames differ only slightly.
      expect(Math.abs(v - last)).toBeLessThan(0.06)
      last = v
    }
    expect(peak).toBeGreaterThan(0.9)
    expect(peak).toBeLessThanOrEqual(1)
  })

  it('spreads outwards, slowing as it goes', () => {
    expect(waveTravel(0)).toBe(0)
    expect(waveTravel(1)).toBe(1)
    expect(waveTravel(0.25) - waveTravel(0)).toBeGreaterThan(waveTravel(1) - waveTravel(0.75))
    for (let i = 1; i <= 50; i++) expect(waveTravel(i / 50)).toBeGreaterThan(waveTravel((i - 1) / 50))
  })

  it('scales with the aircraft on screen, within sensible limits', () => {
    const far = waveExtent(8)
    const mid = waveExtent(36)
    const close = waveExtent(160)
    expect(far.inner).toBeGreaterThanOrEqual(12)
    expect(mid.inner).toBeGreaterThan(far.inner)
    expect(mid.outer - mid.inner).toBeGreaterThan(far.outer - far.inner)
    // Close in the rings stop growing: they stay a halo, not a searchlight.
    expect(close.outer).toBeLessThanOrEqual(140)
    for (const e of [far, mid, close]) expect(e.outer).toBeGreaterThan(e.inner + 25)
  })

  it('draws rings as soft bands: stroke and blur take the same share of the radius', () => {
    for (const t of [0, 400, 1300, 2500, 9000]) {
      const w = talkWaves(t, 36, false)
      expect(w.rings).toHaveLength(WAVE_COUNT)
      for (const r of w.rings) {
        expect(r.stroke / (r.radius + r.stroke)).toBeCloseTo(WAVE_SOFTNESS)
        expect(r.opacity).toBeGreaterThanOrEqual(0)
        expect(r.opacity).toBeLessThanOrEqual(WAVE_PEAK)
      }
      expect(w.glow.opacity).toBeGreaterThan(0)
    }
  })

  it('staggers the rings and repeats every period', () => {
    const a = talkWaves(700, 36, false)
    const radii = a.rings.map((r) => r.radius + r.stroke)
    expect(new Set(radii.map((r) => Math.round(r))).size).toBe(WAVE_COUNT)
    const b = talkWaves(700 + WAVE_PERIOD_MS, 36, false)
    a.rings.forEach((r, i) => expect(b.rings[i].radius).toBeCloseTo(r.radius, 5))
    // A third of a period on, each ring is where its neighbour was.
    const c = talkWaves(700 + WAVE_PERIOD_MS / WAVE_COUNT, 36, false)
    expect(c.rings[0].radius).toBeCloseTo(a.rings[1].radius, 5)
  })

  it('holds still with reduced motion: a steady glow and no rings', () => {
    const a = talkWaves(0, 36, true)
    const b = talkWaves(1234, 36, true)
    expect(a).toEqual(b)
    expect(a.rings.every((r) => r.opacity === 0)).toBe(true)
    expect(a.glow.opacity).toBeGreaterThan(GLOW_OPACITY)
  })

  it('fades in when a call starts and out after it ends', () => {
    expect(talkFade(1000, 1000, null)).toBe(0)
    expect(talkFade(1000 + TALK_FADE_IN_MS / 2, 1000, null)).toBeCloseTo(0.5)
    expect(talkFade(1000 + TALK_FADE_IN_MS, 1000, null)).toBe(1)
    expect(talkFade(9000, 1000, 9000)).toBe(1)
    expect(talkFade(9000 + TALK_FADE_OUT_MS / 2, 1000, 9000)).toBeCloseTo(0.5)
    expect(talkFade(9000 + TALK_FADE_OUT_MS, 1000, 9000)).toBe(0)
  })
})
