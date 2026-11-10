import { describe, expect, it } from 'vitest'
import { blur } from './render'
import { getShape, mirrorHalf, parsePoints, SHAPE_IDS } from './shapes'

const coords = (d: string) =>
  d
    .replace(/[MZ]/g, ' ')
    .split('L')
    .flatMap((seg) => seg.trim().split(/\s+/))
    .filter(Boolean)
    .map(Number)

describe('shapes', () => {
  it('has every class the map draws', () => {
    for (const id of ['ac-jet', 'ac-ejet', 'ac-heavy', 'ac-quad', 'ac-regional', 'ac-bizjet', 'ac-turboprop', 'ac-light', 'ac-twin-piston', 'ac-heli', 'ac-dot', 'ac-vehicle']) expect(SHAPE_IDS).toContain(id)
  })

  it('builds closed, symmetric outlines that fit their stated size', () => {
    for (const id of SHAPE_IDS) {
      const s = getShape(id)
      expect(s.outline.startsWith('M'), id).toBe(true)
      expect(s.outline.endsWith('Z'), id).toBe(true)
      const n = coords(s.outline)
      const xs = n.filter((_, i) => i % 2 === 0)
      const ys = n.filter((_, i) => i % 2 === 1)
      expect(Math.max(...xs), id).toBeCloseTo(-Math.min(...xs), 2)
      // Rotors stick out past the airframe; the stated size includes them.
      expect(Math.max(...xs) * 2, id).toBeLessThanOrEqual(s.span + 0.05)
      expect(Math.max(...ys) - Math.min(...ys), id).toBeLessThanOrEqual(s.length + 0.05)
      // Centred, nose toward -y.
      if (!s.rotor) expect(Math.abs(Math.max(...ys) + Math.min(...ys)), id).toBeLessThan(0.1)
    }
  })

  it('mirrors a right-hand half without doubling the centreline points', () => {
    const half = parsePoints('0,-2 1,0 0,2')
    expect(mirrorHalf(half)).toEqual([
      [0, -2],
      [1, 0],
      [0, 2],
      [-1, 0],
    ])
  })

  it('keeps fuselage and top parts inside the drawing', () => {
    for (const id of SHAPE_IDS) {
      const s = getShape(id)
      for (const p of [s.body, ...s.over]) {
        if (!p) continue
        const n = coords(p.replace(/M/g, 'L'))
        const xs = n.filter((_, i) => i % 2 === 0)
        expect(Math.max(...xs.map(Math.abs)), id).toBeLessThanOrEqual(s.span / 2 + 0.1)
      }
    }
  })
})

describe('blur', () => {
  it('spreads a point and keeps the total', () => {
    const w = 9
    const a = new Float32Array(w * w)
    a[4 * w + 4] = 1
    const b = blur(a, w, w, 1)
    expect(b[4 * w + 4]).toBeLessThan(1)
    expect(b[4 * w + 5]).toBeGreaterThan(0)
    expect(b.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 5)
  })
})
