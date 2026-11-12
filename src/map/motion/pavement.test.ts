import { describe, expect, it } from 'vitest'
import { Pavement } from './pavement'
import { Frame } from './plane'
import { airfield, distanceToLine, ll, ORIGIN, RUNWAY, TAXI_A, TAXI_B } from './testSupport'

const pavement = () => new Pavement(airfield(), new Frame(ORIGIN))

describe('Pavement', () => {
  it('snaps to the nearest centreline within reach, and to nothing beyond it', () => {
    const p = pavement()
    const s = p.snap({ x: -100, y: 14 }, null, 25)!
    expect(s.x).toBeCloseTo(-100, 3)
    expect(s.y).toBeCloseTo(0, 3)
    expect(s.d).toBeCloseTo(14, 3)
    expect(s.kind).toBe('taxiway')
    expect(p.snap({ x: -100, y: 40 }, null, 25)).toBeNull()
  })

  it('prefers the line running the way the aircraft points, and ignores lines across it', () => {
    const p = pavement()
    // 6 m from B (which runs north) and 10 m from A (east): heading north picks B, heading east picks A.
    const near = { x: 206, y: 10 }
    expect(p.snap(near, 0, 30)!.x).toBeCloseTo(200, 3)
    expect(p.snap(near, 90, 30)!.y).toBeCloseTo(0, 3)
    // Heading 45° to both, with a tight limit on the angle: neither.
    expect(p.snap(near, 45, 30, -1, 20)).toBeNull()
    // The opposite direction along a line is the same line.
    expect(p.snap(near, 180, 30)!.x).toBeCloseTo(200, 3)
  })

  it('stays on the line it was on when two are equally near', () => {
    const p = pavement()
    const onA = p.snap({ x: 150, y: 0 }, 90, 20)!
    const onB = p.snap({ x: 200, y: 60 }, 0, 20)!
    // Right at the junction, pointing between the two.
    const mid = { x: 203, y: 3 }
    expect(p.snap(mid, 45, 20, onA.edge)!.y).toBeCloseTo(0, 3)
    expect(p.snap(mid, 45, 20, onB.edge)!.x).toBeCloseTo(200, 3)
  })

  it('knows aprons from grass', () => {
    const p = pavement()
    expect(p.inApron({ x: 0, y: -250 })).toBe(true)
    expect(p.inApron({ x: 0, y: -50 })).toBe(false)
    expect(p.inApron({ x: 900, y: -250 })).toBe(false)
  })

  it('routes along the centrelines, round the corner', () => {
    const p = pavement()
    const a = p.snap({ x: 100, y: 0 }, 90, 10)!
    const b = p.snap({ x: 200, y: 120 }, 0, 10)!
    const r = p.route(a, b, 600, 90)!
    expect(r.len).toBeCloseTo(220, 0)
    const route = [TAXI_A[0], { x: 200, y: 0 }, TAXI_B[1]]
    for (const q of r.pts) expect(distanceToLine(q, route)).toBeLessThan(0.01)
    expect(r.pts[0]).toMatchObject({ x: a.x, y: a.y })
    expect(r.pts[r.pts.length - 1]).toMatchObject({ x: b.x, y: b.y })
    // Along one edge it is just the piece between.
    const c = p.snap({ x: 110, y: 0 }, 90, 10)!
    expect(p.route(a, c, 600, 90)!.len).toBeCloseTo(10, 3)
    // Nothing within the limit: no route.
    expect(p.route(a, b, 100, 90)).toBeNull()
  })

  it('would rather go round than turn back on itself', () => {
    const p = pavement()
    const a = p.snap({ x: 100, y: 0 }, 90, 10)!
    // Behind an aircraft that is heading east: reachable only by reversing, which costs.
    const behind = p.snap({ x: 20, y: 0 }, 90, 10)!
    expect(p.route(a, behind, 200, 90)).toBeNull()
    // Standing still (no heading), it may leave either way.
    expect(p.route(a, behind, 200, null)!.len).toBeCloseTo(80, 3)
  })

  it('joins taxiways to the runway and locks a roll to its centreline', () => {
    const p = pavement()
    const a = p.snap({ x: 200, y: 400 }, 0, 10)!
    const lock = p.runwayLock({ x: 600, y: 512 }, 92)!
    expect(lock.y).toBeCloseTo(RUNWAY[0].y, 3)
    expect(lock.x).toBeCloseTo(600, 3)
    expect(lock.ux).toBeCloseTo(1)
    expect(lock.snap!.kind).toBe('runway')
    const r = p.route(a, lock.snap!, 900, 0)!
    expect(r.len).toBeCloseTo(100 + 400, 0)
    // Pointing the other way down the runway: the direction flips.
    expect(p.runwayLock({ x: 600, y: 490 }, 268)!.ux).toBeCloseTo(-1)
    // Not lined up, or off the runway: no lock.
    expect(p.runwayLock({ x: 600, y: 505 }, 40)).toBeNull()
    expect(p.runwayLock({ x: 600, y: 560 }, 90)).toBeNull()
  })

  it('gives a published runway a centreline when the map has none', () => {
    const data = airfield()
    data.runways = []
    const p = new Pavement(data, new Frame(ORIGIN))
    const lock = p.runwayLock({ x: -400, y: 495 }, 90)!
    expect(lock.y).toBeCloseTo(500, 2)
    expect(lock.snap!.kind).toBe('runway')
  })

  it('walks back along the taxiway the aircraft came down, straight on through junctions', () => {
    const p = pavement()
    const a = p.snap({ x: 260, y: 0 }, 90, 10)!
    // Heading east at x = 260: it came from the west, past the junction with B at x = 200.
    const back = p.walkBack(a, 90, 150)
    expect(back[0].x).toBeCloseTo(110, 3)
    expect(back[back.length - 1].x).toBeCloseTo(260, 3)
    for (const q of back) expect(Math.abs(q.y)).toBeLessThan(0.01)
    // It stops at a dead end rather than turning a corner.
    const end = p.snap({ x: -560, y: 0 }, 90, 10)!
    expect(p.walkBack(end, 90, 300)[0].x).toBeCloseTo(-600, 3)
  })

  it('uses service roads only when given them', () => {
    const road = { ref: null, kind: 'road' as const, coords: [ll(-300, 60), ll(300, 60)] }
    const without = pavement()
    const withRoads = new Pavement(airfield(), new Frame(ORIGIN), [road])
    expect(without.snap({ x: 0, y: 58 }, 90, 10)).toBeNull()
    expect(withRoads.snap({ x: 0, y: 58 }, 90, 10)!.kind).toBe('road')
  })
})
