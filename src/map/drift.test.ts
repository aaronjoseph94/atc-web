import { describe, expect, it } from 'vitest'
import { DRIFT_RADIUS_M, driftAt, ZOOM_BREATHE } from './drift'

describe('camera micro-drift', () => {
  it('starts from rest', () => {
    expect(driftAt(0, 13)).toEqual({ east: 0, north: 0, zoom: 0 })
    const a = driftAt(16, 13)
    expect(Math.hypot(a.east, a.north)).toBeLessThan(0.01)
  })

  it('moves only a few metres a second and stays close to where it began', () => {
    let maxSpeed = 0
    let maxR = 0
    let maxZ = 0
    let prev = driftAt(0, 13)
    for (let t = 100; t <= 600_000; t += 100) {
      const d = driftAt(t, 13)
      maxSpeed = Math.max(maxSpeed, Math.hypot(d.east - prev.east, d.north - prev.north) * 10)
      maxR = Math.max(maxR, Math.hypot(d.east, d.north))
      maxZ = Math.max(maxZ, Math.abs(d.zoom))
      prev = d
    }
    expect(maxSpeed).toBeGreaterThan(1)
    expect(maxSpeed).toBeLessThan(6)
    expect(maxR).toBeLessThanOrEqual(DRIFT_RADIUS_M * 1.26)
    expect(maxZ).toBeLessThanOrEqual(ZOOM_BREATHE + 1e-9)
    expect(maxZ).toBeGreaterThan(ZOOM_BREATHE * 0.9)
  })

  it('does not breathe the zoom across a level where labels switch on or off', () => {
    for (let t = 1000; t < 100_000; t += 1000) expect(driftAt(t, 12.42).zoom).toBe(0)
  })
})
