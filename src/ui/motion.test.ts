import { describe, expect, it } from 'vitest'
import { bezier, createVelocityTracker, projectMomentum, releaseDuration, rubberband } from './motion'

describe('bezier', () => {
  it('pins the ends', () => {
    const e = bezier(0.4, 0, 0.2, 1)
    expect(e(0)).toBe(0)
    expect(e(1)).toBe(1)
    expect(e(-1)).toBe(0)
    expect(e(2)).toBe(1)
  })

  it('is the identity for a linear curve', () => {
    const e = bezier(0.25, 0.25, 0.75, 0.75)
    for (const t of [0.1, 0.33, 0.5, 0.9]) expect(e(t)).toBeCloseTo(t, 4)
  })

  it('matches known values of the CSS ease curve', () => {
    // `ease` = cubic-bezier(0.25, 0.1, 0.25, 1); reference values from a bisection solver.
    const ease = bezier(0.25, 0.1, 0.25, 1)
    expect(ease(0.25)).toBeCloseTo(0.4085, 3)
    expect(ease(0.5)).toBeCloseTo(0.8024, 3)
    expect(ease(0.75)).toBeCloseTo(0.9604, 3)
  })

  it('never runs backwards', () => {
    const e = bezier(0.4, 0, 0.2, 1)
    let prev = 0
    for (let t = 0; t <= 1; t += 0.01) {
      const v = e(t)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = v
    }
  })
})

describe('rubberband', () => {
  it('follows closely at first and then resists', () => {
    expect(rubberband(0)).toBe(0)
    const small = rubberband(10, 140)
    expect(small).toBeGreaterThan(4)
    expect(small).toBeLessThan(10)
    expect(rubberband(1000, 140)).toBeLessThan(140)
    expect(rubberband(400, 140)).toBeLessThan(rubberband(1000, 140))
  })

  it('keeps the sign', () => {
    expect(rubberband(-50)).toBeCloseTo(-rubberband(50))
  })
})

describe('projectMomentum', () => {
  it('scales with velocity', () => {
    expect(projectMomentum(0)).toBe(0)
    expect(projectMomentum(1)).toBeCloseTo(99, 5)
    expect(projectMomentum(-2)).toBeCloseTo(-198, 5)
  })
})

describe('releaseDuration', () => {
  it('uses the full duration when the finger had stopped', () => {
    expect(releaseDuration(300, 0)).toBe(460)
  })
  it('is quicker for faster flicks and clamps', () => {
    const slow = releaseDuration(300, 0.5)
    const fast = releaseDuration(300, 3)
    expect(fast).toBeLessThan(slow)
    expect(fast).toBeGreaterThanOrEqual(180)
    expect(slow).toBeLessThanOrEqual(460)
  })
})

describe('createVelocityTracker', () => {
  it('measures the recent pace, not the whole gesture', () => {
    const v = createVelocityTracker(90)
    // Slow for half a second, then a quick flick.
    for (let t = 0; t <= 500; t += 16) v.add(t, t * 0.05)
    for (let t = 516; t <= 600; t += 16) v.add(t, 25 + (t - 500) * 2)
    expect(v.velocity(600)).toBeGreaterThan(1.5)
  })

  it('reads zero after the pointer rests', () => {
    const v = createVelocityTracker()
    v.add(0, 0)
    v.add(16, 30)
    expect(v.velocity(16)).toBeGreaterThan(1)
    expect(v.velocity(200)).toBe(0)
  })

  it('needs two samples', () => {
    const v = createVelocityTracker()
    expect(v.velocity()).toBe(0)
    v.add(0, 10)
    expect(v.velocity()).toBe(0)
    v.reset()
    expect(v.velocity()).toBe(0)
  })
})
