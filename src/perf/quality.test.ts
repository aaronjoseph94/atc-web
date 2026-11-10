import { describe, expect, it } from 'vitest'
import { GOVERNOR_DEFAULTS, mapPixelRatio, profileFor, QualityGovernor, startingTier, stepDown, stepUp, windowMedian, type QualityTier } from './quality'

/** Feed `seconds` of frames at a steady `ms` interval starting at `from`; returns the end time and the tier. */
function run(g: QualityGovernor, ms: number, seconds: number, from = 0): { at: number; tier: QualityTier } {
  let t = from
  let tier = g.tier
  const end = from + seconds * 1000
  while (t < end) {
    t += ms
    tier = g.frame(ms, t)
  }
  return { at: t, tier }
}

describe('profiles', () => {
  it('get lighter from beautiful to smooth', () => {
    const b = profileFor('beautiful')
    const m = profileFor('balanced')
    const s = profileFor('smooth')
    expect(b.motionPx).toBeLessThan(m.motionPx)
    expect(m.motionPx).toBeLessThan(s.motionPx)
    expect(b.maxPixelRatio).toBeGreaterThanOrEqual(m.maxPixelRatio)
    expect(m.maxPixelRatio).toBeGreaterThanOrEqual(s.maxPixelRatio)
    expect(b.particles).toBeGreaterThan(s.particles)
    expect(s.contrails).toBe(false)
    expect(b.contrails).toBe(true)
  })

  it('steps one tier at a time and stops at the ends', () => {
    expect(stepDown('beautiful')).toBe('balanced')
    expect(stepDown('balanced')).toBe('smooth')
    expect(stepDown('smooth')).toBe('smooth')
    expect(stepUp('smooth')).toBe('balanced')
    expect(stepUp('beautiful')).toBe('beautiful')
  })
})

describe('mapPixelRatio', () => {
  it('caps a retina screen per tier but never goes above the screen or below 1', () => {
    expect(mapPixelRatio(2, 'beautiful')).toBe(1.5)
    expect(mapPixelRatio(3, 'beautiful')).toBe(1.5)
    expect(mapPixelRatio(2, 'balanced')).toBe(1.5)
    expect(mapPixelRatio(2, 'smooth')).toBe(1)
    expect(mapPixelRatio(1, 'beautiful')).toBe(1)
    expect(mapPixelRatio(1.25, 'balanced')).toBe(1.25)
    expect(mapPixelRatio(0.75, 'smooth')).toBe(0.75)
    expect(mapPixelRatio(Number.NaN, 'beautiful')).toBe(1)
  })
})

describe('startingTier', () => {
  it('starts weak hardware in the middle and everything else at the top', () => {
    expect(startingTier({ cores: 8, memoryGb: 16 })).toBe('beautiful')
    expect(startingTier({})).toBe('beautiful')
    expect(startingTier({ cores: 2 })).toBe('balanced')
    expect(startingTier({ memoryGb: 2 })).toBe('balanced')
    expect(startingTier({ cores: 8, saveData: true })).toBe('balanced')
  })
})

describe('windowMedian', () => {
  it('ignores stalls and empty input', () => {
    expect(windowMedian([])).toBeNull()
    expect(windowMedian([16, 17, 16, 900, 18])).toBe(16.5)
    expect(windowMedian([10, 30, 20])).toBe(20)
  })
})

describe('QualityGovernor', () => {
  it('holds the top tier while frames keep up', () => {
    const g = new QualityGovernor('beautiful')
    expect(run(g, 16.7, 30).tier).toBe('beautiful')
  })

  it('steps down after consistently slow windows, not on one slow one', () => {
    const g = new QualityGovernor('beautiful')
    let r = run(g, 16.7, 10)
    // One slow window: not enough.
    r = run(g, 40, GOVERNOR_DEFAULTS.windowMs / 1000, r.at)
    expect(r.tier).toBe('beautiful')
    r = run(g, 16.7, 4, r.at)
    expect(r.tier).toBe('beautiful')
    // Two in a row: one step down; more of the same: the next.
    r = run(g, 40, 4.1, r.at)
    expect(r.tier).toBe('balanced')
    r = run(g, 40, 4.1, r.at)
    expect(r.tier).toBe('smooth')
    r = run(g, 40, 10, r.at)
    expect(r.tier).toBe('smooth')
  })

  it('climbs back when there is headroom, one tier at a time', () => {
    const g = new QualityGovernor('smooth')
    let r = run(g, 16.7, 8.5)
    expect(r.tier).toBe('balanced')
    r = run(g, 16.7, 8.5, r.at)
    expect(r.tier).toBe('beautiful')
  })

  it('does not punish a display that is simply slow (30 Hz)', () => {
    const g = new QualityGovernor('beautiful')
    expect(run(g, 33.4, 60).tier).toBe('beautiful')
  })

  it('backs off from a tier that proved too heavy instead of see-sawing', () => {
    const g = new QualityGovernor('balanced')
    let r = run(g, 16.7, 10)
    // Settles at the top, then the top turns out slow: down.
    expect(r.tier).toBe('beautiful')
    r = run(g, 40, 4.1, r.at)
    expect(r.tier).toBe('balanced')
    // Quick again at balanced: it may not climb straight back to the tier that just failed.
    r = run(g, 16.7, 20, r.at)
    expect(r.tier).toBe('balanced')
    // After the back-off (30 s from the failure) it tries again.
    r = run(g, 16.7, 14, r.at)
    expect(r.tier).toBe('beautiful')
    // Fails again soon after: the wait doubles.
    r = run(g, 40, 4.1, r.at)
    expect(r.tier).toBe('balanced')
    r = run(g, 16.7, 45, r.at)
    expect(r.tier).toBe('balanced')
    r = run(g, 16.7, 30, r.at)
    expect(r.tier).toBe('beautiful')
  })

  it('never climbs above its ceiling', () => {
    const g = new QualityGovernor('beautiful', {}, 'balanced')
    expect(g.tier).toBe('balanced')
    expect(run(g, 16.7, 30).tier).toBe('balanced')
  })

  it('ignores windows with too few frames and forgets a window on reset', () => {
    const g = new QualityGovernor('beautiful')
    // A handful of very slow frames (a hidden tab, a stall) is not a verdict.
    let t = 0
    for (let i = 0; i < 6; i++) {
      t += 600
      g.frame(600, t)
    }
    expect(g.tier).toBe('beautiful')
    g.reset()
    expect(run(g, 16.7, 4, t).tier).toBe('beautiful')
  })
})
