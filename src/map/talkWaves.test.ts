import { describe, expect, it } from 'vitest'
import { GLOW_OPACITY, PING_PERIOD_MS, TALK_FADE_IN_MS, TALK_FADE_OUT_MS, talkFade, talkWaves, WAVE_COUNT, waveEnvelope, waveExtent, WAVE_PEAK, WAVE_PERIOD_MS, waveTravel } from './talkWaves'

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

  it('breathes a halo of two soft discs and pings a thin ring outwards (the earlier look)', () => {
    for (const t of [0, 400, 1300, 2500, 9000]) {
      const w = talkWaves(t, 18, false)
      expect(w.rings).toHaveLength(3)
      const [outer, ping, spare] = w.rings
      expect(w.glow.radius).toBeGreaterThanOrEqual(18)
      expect(w.glow.radius).toBeLessThanOrEqual(22)
      expect(w.glow.opacity).toBeGreaterThanOrEqual(0.3)
      expect(outer.fill).toBeGreaterThanOrEqual(0.15)
      expect(outer.radius).toBeGreaterThan(w.glow.radius)
      expect(ping.stroke).toBe(2)
      expect(ping.opacity).toBeLessThanOrEqual(0.75)
      expect(spare.opacity + spare.fill).toBe(0)
    }
    // The ping repeats every PING_PERIOD_MS, growing from the aircraft outwards.
    expect(talkWaves(100, 18, false).rings[1].radius).toBeLessThan(talkWaves(1200, 18, false).rings[1].radius)
    expect(talkWaves(100 + PING_PERIOD_MS, 18, false).rings[1].radius).toBeCloseTo(talkWaves(100, 18, false).rings[1].radius, 5)
  })

  it('sizes with the aircraft, within limits', () => {
    expect(talkWaves(0, 40, false).glow.radius).toBeGreaterThan(talkWaves(0, 18, false).glow.radius)
    expect(talkWaves(0, 400, false).glow.radius).toBeLessThanOrEqual(22 * 1.6 + 1e-9)
  })

  it('holds still with reduced motion', () => {
    const a = talkWaves(0, 18, true)
    const b = talkWaves(1234, 18, true)
    expect(a).toEqual(b)
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
