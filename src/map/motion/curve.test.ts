import { describe, expect, it } from 'vitest'
import { hermitePoints, Path, roundCorners, Timing } from './curve'
import { dirOf, type XY } from './plane'
import { rng } from './testSupport'

describe('Path', () => {
  it('is travelled by distance, through its points, and carries straight on past its end', () => {
    const p = new Path()
    p.reset({ x: 0, y: 0 }, 1, 0)
    p.append([
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ])
    expect(p.length).toBeCloseTo(200)
    expect(p.at(50)).toMatchObject({ x: 50, y: 0, tx: 1, ty: 0 })
    expect(p.at(100).x).toBeCloseTo(100)
    expect(p.at(260)).toMatchObject({ x: 260, y: 0 })
    expect(p.at(-5)).toMatchObject({ x: 0, y: 0 })
  })

  it('has no kinks: position and direction are continuous along a polyline with corners', () => {
    const p = new Path()
    p.reset({ x: 0, y: 0 }, 1, 0)
    p.append([
      { x: 100, y: 0 },
      { x: 170, y: 70 },
      { x: 170, y: 200 },
    ])
    let prev = p.at(0)
    for (let s = 0.25; s <= p.length; s += 0.25) {
      const q = p.at(s)
      expect(Math.hypot(q.x - prev.x, q.y - prev.y)).toBeLessThan(0.3)
      // Direction turns by a fraction of a degree per step, never in a jump.
      expect(q.tx * prev.tx + q.ty * prev.ty).toBeGreaterThan(Math.cos((2 * Math.PI) / 180))
      prev = q
    }
  })

  it('never changes what is already there when more is added', () => {
    const p = new Path()
    p.reset({ x: 0, y: 0 }, 1, 0)
    p.append([{ x: 100, y: 0 }])
    const before = [10, 50, 99.9, 100].map((s) => p.at(s))
    // The next stretch leaves at an angle.
    p.append([
      { x: 150, y: 60 },
      { x: 150, y: 160 },
    ])
    const after = [10, 50, 99.9, 100].map((s) => p.at(s))
    for (let i = 0; i < before.length; i++) {
      expect(after[i].x).toBeCloseTo(before[i].x, 9)
      expect(after[i].y).toBeCloseTo(before[i].y, 9)
      expect(after[i].tx).toBeCloseTo(before[i].tx, 9)
    }
  })

  it('can be cut at any point and continued from exactly there', () => {
    const p = new Path()
    p.reset({ x: 0, y: 0 }, 1, 0)
    p.append(hermitePoints({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 300, y: 200 }, { x: 0, y: 1 }))
    const at = p.at(120)
    p.cut(120)
    expect(p.length).toBeCloseTo(120)
    expect(p.end().x).toBeCloseTo(at.x, 6)
    expect(p.end().y).toBeCloseTo(at.y, 6)
    expect(p.end().tx).toBeCloseTo(at.tx, 6)
    // Cutting beyond the end extends it straight.
    const q = new Path()
    q.reset({ x: 0, y: 0 }, 0, 1)
    q.cut(40)
    expect(q.end()).toMatchObject({ x: 0, y: 40 })
    expect(q.length).toBe(40)
  })

  it('turns a reversal into a stop-and-go corner, and remembers stretches travelled tail-first', () => {
    const p = new Path()
    p.reset({ x: 0, y: 0 }, 0, -1)
    // Pushed back 50 m south, tail-first...
    p.append([{ x: 0, y: -50 }], true)
    // ...then off to the east, nose-first, from a standstill.
    p.append([{ x: 80, y: -50 }], false, { x: 1, y: 0 })
    expect(p.at(25).rev).toBe(true)
    expect(p.at(25)).toMatchObject({ tx: 0, ty: -1 })
    expect(p.at(90).rev).toBe(false)
    expect(p.at(90).tx).toBeCloseTo(1)
    // The corner itself is a point, not a loop: the path stays on the two legs.
    for (let s = 0; s <= p.length; s += 1) {
      const q = p.at(s)
      expect(Math.min(Math.abs(q.x), Math.abs(q.y + 50))).toBeLessThan(1e-6)
    }
  })

  it('measures the bend ahead and forgets what is far behind', () => {
    const p = new Path()
    p.reset({ x: 0, y: 0 }, 1, 0)
    p.append(hermitePoints({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 60, y: 60 }, { x: 0, y: 1 }))
    expect(p.bend(0, p.length)).toBeCloseTo(Math.PI / 2, 1)
    expect(p.bend(p.length, 10)).toBe(0)
    const long = new Path()
    long.reset({ x: 0, y: 0 }, 1, 0)
    long.append(Array.from({ length: 300 }, (_, i) => ({ x: (i + 1) * 5, y: 0 })))
    const at = long.at(1400)
    long.prune(1395)
    expect(long.size).toBeLessThan(40)
    expect(long.at(1400)).toMatchObject({ x: at.x, y: at.y })
    expect(long.length).toBeCloseTo(1500)
  })
})

describe('hermitePoints', () => {
  it('leaves and arrives along the given directions', () => {
    const pts = hermitePoints({ x: 0, y: 0 }, dirOf(0), { x: 400, y: 400 }, dirOf(90))
    const last = pts[pts.length - 1]
    expect(last).toMatchObject({ x: 400, y: 400, tx: 1 })
    // A quarter turn: it stays within the square between the two ends.
    for (const p of pts) {
      expect(p.x).toBeGreaterThan(-1)
      expect(p.y).toBeLessThan(401)
    }
    // Close to a circular arc of radius 400 about (400, 0).
    for (const p of pts) expect(Math.abs(Math.hypot(p.x - 400, p.y) - 400)).toBeLessThan(25)
  })

  it('is a straight line when nothing turns', () => {
    const pts = hermitePoints({ x: 0, y: 0 }, dirOf(90), { x: 500, y: 0 }, dirOf(90))
    for (const p of pts) expect(Math.abs(p.y)).toBeLessThan(1e-9)
    expect(hermitePoints({ x: 1, y: 1 }, dirOf(0), { x: 1, y: 1 }, dirOf(0))).toEqual([])
  })
})

describe('roundCorners', () => {
  it('rounds a right-angle corner without straying far from it', () => {
    const line: XY[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]
    const out = roundCorners(line, 22)
    expect(out[0]).toEqual(line[0])
    expect(out[out.length - 1]).toEqual(line[2])
    // The corner point itself is cut...
    expect(out.some((p) => p.x === 100 && p.y === 0)).toBe(false)
    // ...by at most about a third of the radius, on the inside of the turn.
    const worst = Math.max(...out.map((p) => Math.min(Math.abs(p.y), Math.abs(p.x - 100))))
    expect(worst).toBeGreaterThan(3)
    expect(worst).toBeLessThan(10)
    // No step turns more than a few degrees.
    for (let i = 2; i < out.length; i++) {
      const a = Math.atan2(out[i - 1].y - out[i - 2].y, out[i - 1].x - out[i - 2].x)
      const b = Math.atan2(out[i].y - out[i - 1].y, out[i].x - out[i - 1].x)
      expect(Math.abs(b - a)).toBeLessThan(0.45)
    }
  })

  it('leaves gentle bends and short lines alone', () => {
    const gentle: XY[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 5 },
    ]
    expect(roundCorners(gentle, 22)).toEqual(gentle)
    expect(roundCorners(gentle.slice(0, 2), 22)).toEqual(gentle.slice(0, 2))
  })
})

describe('Timing', () => {
  it('passes through its knots with the speeds given', () => {
    const tm = new Timing()
    tm.add(0, 0, 10)
    tm.add(8000, 80, 10)
    tm.add(16_000, 160, 10)
    expect(tm.at(4000).s).toBeCloseTo(40)
    expect(tm.at(4000).v).toBeCloseTo(10)
    expect(tm.at(8000).s).toBeCloseTo(80)
    expect(tm.at(-5).s).toBe(0)
    expect(tm.at(99_000)).toEqual({ s: 160, v: 0 })
    expect(tm.lastV).toBeCloseTo(10)
  })

  it('never runs backwards, whatever speeds and spacings it is given (randomised)', () => {
    const rand = rng(42)
    for (let round = 0; round < 50; round++) {
      const tm = new Timing()
      let t = 0
      let s = 0
      for (let k = 0; k < 12; k++) {
        tm.add(t, s, rand() < 0.2 ? null : rand() * 60)
        t += 500 + rand() * 15_000
        // Sometimes no progress at all.
        s += rand() < 0.25 ? 0 : rand() * 600
      }
      let prev = -Infinity
      for (let x = 0; x <= t; x += 97) {
        const r = tm.at(x)
        expect(r.s).toBeGreaterThanOrEqual(prev - 1e-9)
        expect(r.v).toBeGreaterThanOrEqual(0)
        prev = r.s
      }
    }
  })

  it('comes to a stop at a knot where the aircraft stopped', () => {
    const tm = new Timing()
    tm.add(0, 0, 8)
    tm.add(8000, 64, 8)
    tm.add(16_000, 100, 0)
    tm.add(24_000, 100, 0)
    expect(tm.at(16_000).v).toBeCloseTo(0)
    expect(tm.at(20_000)).toEqual({ s: 100, v: 0 })
  })

  it('says how fast the aircraft may go and still slow for the knots ahead', () => {
    const tm = new Timing()
    tm.add(0, 0, 10)
    tm.add(8000, 80, 10)
    tm.add(16_000, 120, 0)
    // 100 m short of a stop, braking at 2 m/s²: 20 m/s.
    expect(tm.brakingLimit(9000, 20, 2)).toBeCloseTo(20)
    expect(tm.brakingLimit(15_000, 120, 2)).toBe(0)
    expect(tm.brakingLimit(17_000, 0, 2)).toBe(Infinity)
  })

  it('drops forecast knots and old ones', () => {
    const tm = new Timing()
    for (let k = 0; k < 30; k++) tm.add(k * 1000, k * 10, 10)
    tm.truncate(25)
    expect(tm.count).toBe(25)
    expect(tm.lastS).toBe(240)
    tm.prune(20_500)
    expect(tm.count).toBeLessThan(8)
    expect(tm.at(22_000).s).toBeCloseTo(220)
  })
})
