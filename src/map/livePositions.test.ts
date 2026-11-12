import { describe, expect, it } from 'vitest'
import type { Aircraft } from '../api/types'
import { LivePositionBuffer, MAX_DELAY_MS, MIN_DELAY_MS } from './livePositions'
import { MPS_PER_KT, type XY } from './motion/plane'
import { JUMP_FADE_MS } from './motion/track'
import { aircraft, airfield, alongLine, bufferAt, distanceToLine, drive, kt, ll, RUNWAY, rng, roughness, TAXI_A, TAXI_B, worstBackStep, xy, type Feed } from './motion/testSupport'

const ac = (icao24: string, lat: number, lon: number, heading = 0, speedKt: number | null = null, onGround = false): Aircraft => ({
  icao24,
  callsign: icao24.toUpperCase(),
  lat,
  lon,
  heading,
  altitudeFt: null,
  speedKt,
  onGround,
})

/** An aircraft flying a straight line from (x0, y0) at `mps` along `heading`. */
const straight =
  (id: string, x0: number, y0: number, heading: number, mps: number, onGround = false): Feed =>
  (t) => {
    const d = (mps * t) / 1000
    const r = (heading * Math.PI) / 180
    return [aircraft(id, x0 + Math.sin(r) * d, y0 + Math.cos(r) * d, heading, kt(mps), onGround)]
  }

describe('LivePositionBuffer: basics', () => {
  it('is empty before any snapshot and shows a parked aircraft where it is', () => {
    const b = new LivePositionBuffer()
    expect(b.sample(0)).toEqual([])
    b.push([ac('a', 1, 1)], 1000)
    const [a] = b.sample(1500)
    expect(a).toMatchObject({ icao24: 'a', callsign: 'A', onGround: false })
    expect(a.lat).toBeCloseTo(1, 9)
    expect(a.lon).toBeCloseTo(1, 9)
  })

  it('fades aircraft in on arrival and out once they leave the feed', () => {
    const b = new LivePositionBuffer()
    b.push([ac('a', 1, 1)], 0)
    expect(b.sample(0)[0].opacity).toBeCloseTo(0.25)
    expect(b.sample(2000)[0].opacity).toBe(1)
    b.push([], 3000)
    b.push([], 4000) // second miss: starts fading
    expect(b.sample(4450)[0].opacity).toBeCloseTo(0.5)
    expect(b.sample(5000)).toEqual([])
  })

  it('shows new aircraft at once and drops vanished ones after two missed polls', () => {
    const b = new LivePositionBuffer()
    b.push([ac('old', 0, 0)], 0)
    b.push([ac('new', 1, 1)], 1000)
    expect(
      b
        .sample(1100)
        .map((a) => a.icao24)
        .sort(),
    ).toEqual(['new', 'old'])
    b.push([ac('new', 1, 1)], 2000)
    expect(b.sample(3500).map((a) => a.icao24)).toEqual(['new'])
    expect(b.ids()).toEqual(['new'])
  })

  it('keeps a trail of where the aircraft was drawn, ending under it', () => {
    const b = bufferAt()
    const frames = drive(b, straight('a', 0, 0, 90, 150), 'a', { durMs: 60_000 })
    const last = frames[frames.length - 1]
    const trail = b.trail('a', 50, last.t)
    expect(trail.length).toBeGreaterThan(4)
    const end = xy(...trail[trail.length - 1])
    expect(end.x).toBeCloseTo(last.x, 3)
    expect(end.y).toBeCloseTo(last.y, 3)
    // Oldest first, along the track, and never ahead of the aircraft.
    const xs = trail.map((p) => xy(...p).x)
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1])
    expect(b.trail('a', 3, last.t)).toHaveLength(3)
    expect(b.trail('missing')).toEqual([])
  })

  it('points a headingless aircraft the way it actually moved', () => {
    const b = bufferAt()
    const still = { ...aircraft('a', 0, 0, 0, null, true), headingKnown: false }
    b.push([still], 0)
    expect(b.sample(100)[0].headingKnown).toBe(false)
    // Moves 80 m due east with no reported track or speed.
    const [lon, lat] = ll(80, 0)
    b.push([{ ...still, lon, lat }], 8000)
    // ...and stops there.
    b.push([{ ...still, lon, lat }], 16_000)
    let moved = b.sample(8100)[0]
    for (let t = 8100; t <= 30_000; t += 16) moved = b.sample(t)[0]
    expect(moved.headingKnown).toBe(true)
    expect(moved.heading).toBeGreaterThan(80)
    expect(moved.heading).toBeLessThan(100)
    expect(xy(moved.lon, moved.lat).x).toBeCloseTo(80, 0)
  })

  it('reports the newest raw record separately from the drawn one', () => {
    const b = bufferAt()
    drive(b, straight('a', 0, 0, 0, 100), 'a', { durMs: 30_000 })
    const raw = b.latest('a')!
    const drawn = b.get('a', 30_000)!
    // The raw report is seconds ahead of the picture.
    expect(xy(raw.lon, raw.lat).y - xy(drawn.lon, drawn.lat).y).toBeGreaterThan(400)
    expect(b.latest('nope')).toBeNull()
    expect(b.get('nope')).toBeNull()
  })
})

describe('LivePositionBuffer: delayed playback', () => {
  it('draws traffic one and a half report gaps behind real time, within 6 to 12 s', () => {
    for (const [pollMs, want] of [
      [5000, 7500],
      [8000, 12_000],
      [3000, MIN_DELAY_MS],
    ]) {
      const b = bufferAt()
      const mps = 120
      const frames = drive(b, straight('a', 0, 0, 0, mps), 'a', { durMs: 240_000, pollMs })
      expect(b.delayMs).toBeCloseTo(want, -2)
      expect(b.delayOf('a')).toBeCloseTo(want, -2)
      // Where it is drawn is where it really was `delay` ago.
      const last = frames[frames.length - 1]
      expect(last.y).toBeCloseTo((mps * (last.t - want)) / 1000, -1)
    }
    expect(MAX_DELAY_MS).toBe(12_000)
  })

  it('knows the delay from the first report when told how often the feed is polled', () => {
    const b = new LivePositionBuffer()
    b.expectInterval(5000)
    expect(b.delayMs).toBe(7500)
    b.expectInterval(8000)
    expect(b.delayMs).toBe(12_000)
    // A feed slower than the cap gets a longer delay rather than nothing to draw between reports.
    b.expectInterval(15_000)
    expect(b.delayMs).toBe(18_000)
  })

  it('normally has a fix on both sides of the moment being drawn', () => {
    const b = bufferAt()
    b.expectInterval(8000)
    const frames = drive(b, straight('a', 0, 0, 45, 130), 'a', { durMs: 120_000, ageMs: 2500 })
    // After the first poll, the drawn point always has settled path ahead of it.
    for (const f of frames.filter((x) => x.t > 10_000)) expect(b.motion('a', f.t)!.slack).toBeGreaterThan(0)
  })

  it('moves a new aircraft from its first frame, arriving at its first fix on time', () => {
    const b = bufferAt()
    b.expectInterval(8000)
    const mps = 100
    const frames = drive(b, straight('a', 0, 0, 0, mps), 'a', { durMs: 20_000, ageMs: 2000 })
    expect(frames[0].v).toBeGreaterThan(90)
    // It starts where it was a delay ago, not where the first report put it.
    expect(frames[0].y).toBeCloseTo((mps * (0 - 12_000)) / 1000, -1)
    expect(roughness(frames).accel).toBeLessThan(5.01)
  })

  it('interpolates height and speed to the moment drawn', () => {
    const b = bufferAt()
    b.expectInterval(8000)
    // Climbing 100 ft/s, accelerating 1 kt/s.
    const feed: Feed = (t) => [aircraft('a', 0, (100 * t) / 1000, 0, 200 + t / 1000, false, { altitudeFt: 1000 + (100 * t) / 1000 })]
    const frames = drive(b, feed, 'a', { durMs: 60_000 })
    const last = frames[frames.length - 1]
    expect(last.a.altitudeFt).toBeCloseTo(1000 + (100 * (last.t - 12_000)) / 1000, -1)
    expect(last.a.speedKt).toBeCloseTo(200 + (last.t - 12_000) / 1000, 0)
    // Smooth between fixes: no step bigger than a frame's worth of climb.
    for (let i = 1; i < frames.length; i++) if (frames[i].t > 15_000) expect(Math.abs(frames[i].a.altitudeFt! - frames[i - 1].a.altitudeFt!)).toBeLessThan(4)
  })
})

describe('LivePositionBuffer: forwards only', () => {
  it('never steps backwards on a steady flight, a turn, or a stop', () => {
    // A racetrack: straight, a 3°/s turn through 180°, straight back.
    const mps = 110
    const R = mps / ((3 * Math.PI) / 180)
    const feed: Feed = (t) => {
      const d = (mps * t) / 1000
      const legs = 6000
      if (d < legs) return [aircraft('a', 0, d, 0, kt(mps), false)]
      const arc = d - legs
      if (arc < Math.PI * R) {
        const th = arc / R
        return [aircraft('a', R - R * Math.cos(th), legs + R * Math.sin(th), (th * 180) / Math.PI, kt(mps), false)]
      }
      return [aircraft('a', 2 * R, legs - (arc - Math.PI * R), 180, kt(mps), false)]
    }
    const frames = drive(bufferAt(), feed, 'a', { durMs: 200_000 })
    expect(worstBackStep(frames)).toBeGreaterThanOrEqual(-1e-6)
    for (let i = 1; i < frames.length; i++) expect(frames[i].s).toBeGreaterThanOrEqual(frames[i - 1].s)
    // It flew the turn as a turn: at the top of the arc it is abeam the centre, a radius out.
    const top = frames.reduce((best, f) => (f.y > best.y ? f : best))
    expect(top.y).toBeGreaterThan(6000 + R * 0.93)
    const r = roughness(frames.filter((f) => f.t > 1000))
    expect(r.jump).toBeLessThan(0.2)
    expect(r.turn).toBeLessThan(14.1)
  })

  it('never steps backwards under noisy, late, duplicated and out-of-order fixes (randomised)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rand = rng(seed)
      const onGround = seed % 3 === 0
      const mps = onGround ? 4 + rand() * 10 : 60 + rand() * 120
      const noise = onGround ? 6 : 40
      const pollMs = [5000, 8000, 8000, 15_000][Math.floor(rand() * 4)]
      const WALL = 1_700_000_000_000
      let lastSent: Aircraft | null = null
      const older: Aircraft[] = []
      const feed: Feed = (t) => {
        const roll = rand()
        // A failed poll.
        if (roll < 0.08) return null
        // The same fix again.
        if (roll < 0.2 && lastSent) return [lastSent]
        // An old fix arriving after a newer one.
        if (roll < 0.3 && older.length > 1) return [older[Math.floor(rand() * (older.length - 1))]]
        // Late: measured a good while before it arrived.
        const lateMs = roll < 0.45 ? rand() * 9000 : 0
        const at = t - lateMs
        const d = Math.max(0, (mps * at) / 1000)
        // A gentle S-bend, with position and heading noise.
        const x = 300 * Math.sin(d / 2500) + (rand() - 0.5) * 2 * noise
        const y = d + (rand() - 0.5) * 2 * noise
        const heading = (((Math.atan2((300 / 2500) * Math.cos(d / 2500), 1) * 180) / Math.PI + (rand() - 0.5) * 12) + 360) % 360
        const a = aircraft('a', x, y, heading, kt(mps) * (0.9 + rand() * 0.2), onGround, { positionTime: WALL + Math.round(at) - 1500 })
        lastSent = a
        older.push(a)
        return [a]
      }
      const frames = drive(bufferAt(), feed, 'a', { durMs: 150_000, pollMs })
      expect(frames.length).toBeGreaterThan(1000)
      for (let i = 1; i < frames.length; i++) {
        // Distance along the path never decreases...
        if (frames[i].s < frames[i - 1].s && frames[i].opacity > 0.99 && frames[i - 1].opacity > 0.99) throw new Error(`seed ${seed}: went back along its path at ${frames[i].t} ms`)
      }
      // ...and on screen it never moves against its nose.
      const solid = frames.filter((f) => f.opacity > 0.99)
      expect(worstBackStep(solid), `seed ${seed}`).toBeGreaterThanOrEqual(-0.02)
    }
  })

  it('does not reverse when a late report puts the aircraft behind where it is drawn: it slows and waits', () => {
    const b = bufferAt()
    b.expectInterval(8000)
    const mps = 8
    // Taxiing east; the feed drops out for a while, and when it returns the aircraft had slowed, so it is behind the coasted position.
    const feed: Feed = (t) => {
      if (t > 30_000 && t < 46_000) return null
      const d = t <= 30_000 ? (mps * t) / 1000 : (mps * 30_000) / 1000 + (2 * (t - 30_000)) / 1000
      return [aircraft('a', d, -250, 90, t <= 30_000 ? kt(mps) : kt(2) + 4, true)]
    }
    const frames = drive(b, feed, 'a', { durMs: 120_000, ageMs: 1000 })
    expect(worstBackStep(frames)).toBeGreaterThanOrEqual(-1e-6)
    for (let i = 1; i < frames.length; i++) expect(frames[i].x).toBeGreaterThanOrEqual(frames[i - 1].x - 1e-6)
    expect(roughness(frames).jump).toBeLessThan(0.2)
  })
})

describe('LivePositionBuffer: smoothness', () => {
  it('keeps position, speed and heading continuous as fixes arrive', () => {
    // Accelerating and turning gently, with the usual small disagreements between fixes.
    const rand = rng(7)
    const feed: Feed = (t) => {
      const s = t / 1000
      const v = 70 + 0.4 * s
      const d = 70 * s + 0.2 * s * s
      const hdg = 30 + 0.8 * s
      // Position integrated numerically along the turning track.
      let x = 0
      let y = 0
      const n = 200
      for (let i = 0; i < n; i++) {
        const si = ((i + 0.5) / n) * s
        const h = ((30 + 0.8 * si) * Math.PI) / 180
        const vi = 70 + 0.4 * si
        x += (Math.sin(h) * vi * s) / n
        y += (Math.cos(h) * vi * s) / n
      }
      void d
      return [aircraft('a', x + (rand() - 0.5) * 30, y + (rand() - 0.5) * 30, hdg + (rand() - 0.5) * 4, kt(v) + (rand() - 0.5) * 6, false)]
    }
    const frames = drive(bufferAt(), feed, 'a', { durMs: 120_000 }).filter((f) => f.t > 500)
    const r = roughness(frames)
    // No frame-to-frame jump at all beyond the distance its speed covers...
    expect(r.jump).toBeLessThan(0.2)
    // ...speed changes within what an aircraft can do, and the nose turns within its limit.
    expect(r.accel).toBeLessThan(5.01)
    expect(r.turn).toBeLessThan(14.1)
  })

  it('limits acceleration and turn rate on the ground to taxi values', () => {
    const rand = rng(3)
    const mps = 9
    // Along taxiway A then north up B, on the centrelines, with a few metres of position noise.
    const route: XY[] = [TAXI_A[0], { x: 200, y: 0 }, TAXI_B[1]]
    const feed: Feed = (t) => {
      const p = alongLine(route, (mps * t) / 1000)
      return [aircraft('a', p.x + (rand() - 0.5) * 6, p.y + (rand() - 0.5) * 6, p.heading, kt(mps), true)]
    }
    const frames = drive(bufferAt(airfield()), feed, 'a', { durMs: 130_000 }).filter((f) => f.t > 500)
    const r = roughness(frames)
    expect(r.jump).toBeLessThan(0.2)
    expect(r.accel).toBeLessThan(3.21)
    expect(r.turn).toBeLessThan(30.1)
  })
})

describe('LivePositionBuffer: when the feed is late', () => {
  it('rolls on gently for a few seconds on the ground, then holds', () => {
    const mps = 8
    const feed: Feed = (t) => (t > 30_000 ? null : [aircraft('a', (mps * t) / 1000, -250, 90, kt(mps), true)])
    const b = bufferAt()
    b.expectInterval(8000)
    // Other traffic keeps the polls coming, so this one is simply not in them... which would fade it; keep it by not polling at all.
    const frames = drive(b, feed, 'a', { durMs: 70_000, ageMs: 1000 })
    const at = (t: number) => frames.find((f) => f.t >= t)!
    // The last fix (measured at 23 s) is reached at about 35 s on the clock; a few seconds later it has all but stopped...
    expect(at(34_000).v).toBeCloseTo(mps, 1)
    expect(at(36_500).v).toBeGreaterThan(3)
    expect(at(46_000).v).toBe(0)
    // ...a little past the last known position, not far.
    const lastKnown = (mps * 23_000) / 1000
    expect(at(60_000).x - lastKnown).toBeGreaterThan(5)
    expect(at(60_000).x - lastKnown).toBeLessThan(mps * 4)
    const r = roughness(frames)
    expect(r.jump).toBeLessThan(0.2)
    expect(r.accel).toBeLessThan(3.21)
    expect(worstBackStep(frames)).toBeGreaterThanOrEqual(-1e-6)
  })

  it('resumes smoothly after a short gap: no jump, and the catch-up is a blend over seconds', () => {
    const mps = 8
    // Two polls fail.
    const feed: Feed = (t) => (t > 30_000 && t < 46_000 ? null : [aircraft('a', (mps * t) / 1000, -250, 90, kt(mps), true)])
    const b = bufferAt()
    b.expectInterval(8000)
    const frames = drive(b, feed, 'a', { durMs: 120_000, ageMs: 1000 })
    for (const f of frames) expect(f.opacity).toBeGreaterThan(0.24)
    const r = roughness(frames)
    expect(r.jump).toBeLessThan(0.2)
    expect(r.accel).toBeLessThan(3.21)
    expect(worstBackStep(frames)).toBeGreaterThanOrEqual(-1e-6)
    // It fell behind while it held...
    const where = (f: { x: number; t: number }) => f.x - (mps * (f.t - 12_000)) / 1000
    const worst = Math.min(...frames.filter((f) => f.t > 36_000 && f.t < 60_000).map(where))
    expect(worst).toBeLessThan(-20)
    // ...and closes the gap at a little over its real speed, taking well over two seconds, never at a dash.
    const resumed = frames.findIndex((f) => f.t > 48_000 && f.v > 1)
    const caughtUp = frames.findIndex((f, i) => i > resumed && Math.abs(where(f)) < 1)
    expect(frames[caughtUp].t - frames[resumed].t).toBeGreaterThan(2000)
    for (const f of frames) expect(f.v).toBeLessThanOrEqual(1.35 * mps + 3 + 1e-6)
    const end = frames[frames.length - 1]
    expect(where(end)).toBeCloseTo(0, 0)
  })

  it('after a long silence skips ahead under a fade instead of racing to catch up', () => {
    const mps = 8
    const feed: Feed = (t) => (t > 30_000 && t < 70_000 ? null : [aircraft('a', (mps * t) / 1000, -250, 90, kt(mps), true)])
    const b = bufferAt()
    b.expectInterval(8000)
    const frames = drive(b, feed, 'a', { durMs: 140_000, ageMs: 1000 })
    // Never faster than a taxi, never backwards, and the one big step happens while it is invisible.
    for (const f of frames) expect(f.v).toBeLessThanOrEqual(1.35 * mps + 3 + 1e-6)
    expect(worstBackStep(frames)).toBeGreaterThanOrEqual(-1e-6)
    expect(roughness(frames).jump).toBeLessThan(0.2)
    const hop = frames.findIndex((f, i) => i > 0 && f.x - frames[i - 1].x > 50)
    expect(hop).toBeGreaterThan(0)
    expect(frames[hop].opacity).toBeLessThan(0.05)
    const end = frames[frames.length - 1]
    expect(end.x).toBeCloseTo((mps * (end.t - 12_000)) / 1000, 0)
    expect(end.opacity).toBe(1)
  })

  it('keeps an aircraft in the air flying when one poll is missed', () => {
    const mps = 120
    const feed: Feed = (t) => (t > 30_000 && t < 38_000 ? null : [aircraft('a', 0, (mps * t) / 1000, 0, kt(mps), false)])
    const b = bufferAt()
    b.expectInterval(8000)
    const frames = drive(b, feed, 'a', { durMs: 100_000 })
    for (const f of frames.filter((x) => x.t > 2000)) expect(f.v).toBeGreaterThan(mps * 0.97)
    expect(roughness(frames).jump).toBeLessThan(0.2)
    expect(worstBackStep(frames)).toBeGreaterThanOrEqual(-1e-6)
  })
})

describe('LivePositionBuffer: bad fixes', () => {
  it('ignores a single fix that is plainly somewhere else', () => {
    const mps = 100
    let n = 0
    const feed: Feed = (t) => {
      n++
      // One report 9 km off to the side.
      if (n === 6) return [aircraft('a', 9000, (mps * t) / 1000, 0, kt(mps), false)]
      return [aircraft('a', 0, (mps * t) / 1000, 0, kt(mps), false)]
    }
    const frames = drive(bufferAt(), feed, 'a', { durMs: 120_000 })
    for (const f of frames) {
      expect(Math.abs(f.x)).toBeLessThan(1)
      expect(f.opacity).toBeGreaterThan(0.24)
    }
    expect(roughness(frames).jump).toBeLessThan(0.2)
  })

  it('treats a real relocation as a new track: it fades across, it does not slide', () => {
    const feed: Feed = (t) => (t < 40_000 ? [aircraft('a', 0, -250, 90, 0, true)] : [aircraft('a', 900, -250, 90, 0, true)])
    const frames = drive(bufferAt(), feed, 'a', { durMs: 120_000 })
    // It is only ever drawn at the old place or the new one...
    for (const f of frames) expect(Math.min(Math.abs(f.x), Math.abs(f.x - 900))).toBeLessThan(1)
    // ...and it is invisible at the moment it changes.
    const i = frames.findIndex((f) => f.x > 450)
    expect(i).toBeGreaterThan(0)
    expect(frames[i - 1].opacity).toBeLessThan(0.1)
    expect(frames[i].opacity).toBeLessThan(0.1)
    expect(frames.find((f) => f.t > frames[i].t + 2 * JUMP_FADE_MS + 50)!.opacity).toBe(1)
  })

  it('starts afresh after a long silence instead of sliding across the gap', () => {
    const b = bufferAt()
    const mps = 100
    b.push([aircraft('a', 0, 0, 0, kt(mps), false, { positionTime: 1_000_000 })], 0, 1_001_000)
    for (let t = 0; t <= 20_000; t += 16) b.sample(t)
    // Nothing for 90 s, then a report from 9 km on.
    b.push([aircraft('a', 0, 9000, 0, kt(mps), false, { positionTime: 1_090_000 })], 90_000, 1_091_000)
    let prev = b.get('a', 90_000)!
    for (let t = 90_016; t <= 120_000; t += 16) {
      const a = b.get('a', t)!
      const step = xy(a.lon, a.lat).y - xy(prev.lon, prev.lat).y
      // Either a normal frame's travel, or the one invisible hop.
      if (step > mps * 0.016 * 2) expect(a.opacity).toBeLessThan(0.1)
      prev = a
    }
    expect(xy(prev.lon, prev.lat).y).toBeGreaterThan(9000)
  })

  it('rejects duplicate and out-of-order fixes by their timestamps', () => {
    const b = bufferAt()
    const WALL = 2_000_000_000_000
    const at = (y: number, t: number) => aircraft('a', 0, y, 0, 200, false, { positionTime: WALL + t })
    b.push([at(0, 0)], 1000, WALL + 1000)
    b.push([at(800, 8000)], 9000, WALL + 9000)
    const before = b.motion('a', 9000)!
    // The same fix again, and an older one arriving late: neither adds road.
    b.push([at(800, 8000)], 10_000, WALL + 10_000)
    b.push([at(400, 4000)], 11_000, WALL + 11_000)
    const after = b.motion('a', 11_000)!
    expect(after.slack + after.s).toBeCloseTo(before.slack + before.s, 6)
    // A genuinely newer one does.
    b.push([at(1600, 16_000)], 17_000, WALL + 17_000)
    const later = b.motion('a', 17_000)!
    expect(later.slack + later.s).toBeGreaterThan(before.slack + before.s + 700)
  })

  it('takes a disagreement between the feed clock and ours out of the fix ages', () => {
    for (const skewMs of [-45_000, 0, 90_000]) {
      const b = bufferAt()
      b.expectInterval(8000)
      const mps = 100
      const WALL = 1_700_000_000_000
      const frames: number[] = []
      for (let t = 0; t <= 80_000; t += 16) {
        if (t % 8000 === 0) b.push([aircraft('a', 0, (mps * (t - 1500)) / 1000, 0, kt(mps), false, { positionTime: WALL + t - 1500 })], t, WALL + t + skewMs)
        const a = b.sample(t)[0]
        frames.push(xy(a.lon, a.lat).y)
      }
      // Whatever our wall clock says, it is drawn about a delay behind (the freshest report is taken as fresh).
      const lag = (mps * 80_000) / 1000 - frames[frames.length - 1]
      expect(lag / mps).toBeGreaterThan(10)
      expect(lag / mps).toBeLessThan(18)
      for (let i = 1; i < frames.length; i++) expect(frames[i]).toBeGreaterThanOrEqual(frames[i - 1])
    }
  })
})

describe('LivePositionBuffer: on the ground', () => {
  it('holds parked aircraft still through position jitter and heading noise', () => {
    const rand = rng(11)
    const feed: Feed = () => [aircraft('a', 100 + (rand() - 0.5) * 30, -300 + (rand() - 0.5) * 30, rand() * 360, rand() < 0.5 ? 0 : 1, true)]
    const frames = drive(bufferAt(), feed, 'a', { durMs: 120_000 })
    for (const f of frames) {
      expect(f.x).toBe(frames[0].x)
      expect(f.y).toBe(frames[0].y)
      expect(f.heading).toBe(frames[0].heading)
    }
  })

  it('keeps a taxiing aircraft on the taxiway round a corner', () => {
    const rand = rng(5)
    const mps = 8
    // East along A, then north up B to the runway: a right-angle corner at (200, 0).
    const route: XY[] = [TAXI_A[0], { x: 200, y: 0 }, TAXI_B[1]]
    const feed: Feed = (t) => {
      const p = alongLine(route, (mps * t) / 1000)
      // GPS a few metres out, heading a few degrees out.
      return [aircraft('a', p.x + (rand() - 0.5) * 16, p.y + (rand() - 0.5) * 16, (p.heading + (rand() - 0.5) * 10 + 360) % 360, kt(mps), true)]
    }
    for (const pollMs of [5000, 8000]) {
      const frames = drive(bufferAt(airfield()), feed, 'a', { durMs: 150_000, pollMs })
      let worst = 0
      for (const f of frames) worst = Math.max(worst, distanceToLine(f, route))
      // On the centreline on the straights, and inside the fillet at the corner: never more than a few metres off.
      expect(worst).toBeLessThan(10)
      const straights = frames.filter((f) => Math.hypot(f.x - 200, f.y) > 60)
      for (const f of straights) expect(distanceToLine(f, route)).toBeLessThan(0.5)
      expect(worstBackStep(frames)).toBeGreaterThanOrEqual(-1e-6)
      // It really went round: it ends up on B, pointing north.
      const end = frames[frames.length - 1]
      expect(end.x).toBeCloseTo(200, 0)
      expect(end.y).toBeGreaterThan(200)
      expect(Math.abs(((end.heading + 180) % 360) - 180)).toBeLessThan(3)
    }
  })

  it('would cut the corner across the grass without the pavement (which is what the graph is for)', () => {
    // A brisk taxi, so the reports either side of the corner are far apart.
    const mps = 14
    const route: XY[] = [TAXI_A[0], { x: 200, y: 0 }, TAXI_B[1]]
    const feed: Feed = (t) => {
      const p = alongLine(route, (mps * t) / 1000)
      return [aircraft('a', p.x, p.y, p.heading, kt(mps), true)]
    }
    const worst = (pavement: boolean) => Math.max(...drive(bufferAt(pavement ? airfield() : null), feed, 'a', { durMs: 90_000, ageMs: 3100 }).map((f) => distanceToLine(f, route)))
    expect(worst(false)).toBeGreaterThan(15)
    expect(worst(true)).toBeLessThan(10)
  })

  it('does not hop to a parallel taxiway', () => {
    const rand = rng(9)
    const mps = 7
    // Along A; C runs parallel 90 m south. Noise of up to 15 m must not move it across.
    const feed: Feed = (t) => [aircraft('a', -550 + (mps * t) / 1000, (rand() - 0.5) * 30, 90, kt(mps), true)]
    const frames = drive(bufferAt(airfield()), feed, 'a', { durMs: 120_000 })
    for (const f of frames) expect(Math.abs(f.y)).toBeLessThan(0.5)
  })

  it('locks a takeoff roll to the runway centreline and lets go at lift-off', () => {
    const rand = rng(2)
    // Accelerating 2.2 m/s² along the runway from x = -1300, up to 20 m off the centreline in the reports; airborne after 80 m/s.
    const feed: Feed = (t) => {
      const s = Math.max(0, t / 1000)
      const v = Math.min(2.2 * s, 85)
      const d = v < 85 ? 1.1 * s * s : 1.1 * (85 / 2.2) ** 2 + 85 * (s - 85 / 2.2)
      const airborne = v >= 80
      const y = RUNWAY[0].y + (rand() - 0.5) * 40
      return [aircraft('a', -1300 + d, y, 90, kt(v), !airborne, { altitudeFt: airborne ? 200 : null })]
    }
    const frames = drive(bufferAt(airfield()), feed, 'a', { durMs: 60_000, pollMs: 5000 })
    // While it is drawn rolling fast on the ground it is on the centreline, pointing down the runway.
    const roll = frames.filter((f) => f.a.onGround && f.v > 20 && f.v < 60)
    expect(roll.length).toBeGreaterThan(200)
    for (const f of roll) {
      expect(Math.abs(f.y - RUNWAY[0].y)).toBeLessThan(4)
      expect(Math.abs(f.heading - 90)).toBeLessThan(5)
    }
    const r = roughness(frames.filter((f) => f.t > 500))
    expect(r.jump).toBeLessThan(0.2)
    expect(r.accel).toBeLessThan(5.01)
    expect(worstBackStep(frames)).toBeGreaterThanOrEqual(-1e-6)
  })

  it('never snaps an aircraft in the air to the pavement', () => {
    // Flying low along taxiway A, 12 m to one side of it.
    const frames = drive(bufferAt(airfield()), (t) => [aircraft('a', -500 + (60 * t) / 1000, 12, 90, kt(60), false, { altitudeFt: 700 })], 'a', { durMs: 40_000 })
    for (const f of frames) expect(f.y).toBeCloseTo(12, 3)
  })

  it('moves freely on the apron, off the lines', () => {
    // Diagonally across the apron toward a stand.
    const mps = 5
    const feed: Feed = (t) => {
      const d = (mps * t) / 1000
      return [aircraft('a', -300 + d * 0.8, -150 - d * 0.6, 126.87, kt(mps), true)]
    }
    const frames = drive(bufferAt(airfield()), feed, 'a', { durMs: 40_000 })
    for (const f of frames) expect(Math.abs((f.x + 300) * 0.6 + (f.y + 150) * 0.8)).toBeLessThan(1)
  })

  it('keeps the nose forward during a pushback (moving against the reported heading)', () => {
    // Parked nose north at a stand, then pushed back south at 2 m/s for 40 s, still pointing north.
    const feed: Feed = (t) => {
      const d = t < 20_000 ? 0 : Math.min(80, (2 * (t - 20_000)) / 1000)
      const moving = t >= 20_000 && d < 80
      return [aircraft('a', -100, -200 - d, 0, moving ? kt(2) + 2.5 : 0, true)]
    }
    const frames = drive(bufferAt(airfield()), feed, 'a', { durMs: 110_000 })
    const end = frames[frames.length - 1]
    expect(end.y).toBeLessThan(-270)
    for (const f of frames) {
      // The nose never swings round to face the way it is being pushed.
      expect(Math.abs(((f.heading + 180) % 360) - 180)).toBeLessThan(25)
    }
    // And it is travelling tail-first: every step is against the nose, none with it.
    for (let i = 1; i < frames.length; i++) expect(frames[i].y).toBeLessThanOrEqual(frames[i - 1].y + 1e-6)
  })
})

describe('LivePositionBuffer: vehicles and helicopters', () => {
  it('filters a vehicle hard: small jitter does not move it, and it turns with its path', () => {
    const rand = rng(4)
    const car = (x: number, y: number, hdg: number, mps: number) => aircraft('v', x, y, hdg, kt(mps), true, { category: 'C2' })
    // Stopped with jitter, then driving east along A.
    const feed: Feed = (t) => (t < 40_000 ? [car(-400 + (rand() - 0.5) * 12, (rand() - 0.5) * 12, rand() * 360, 0.3)] : [car(-400 + (6 * (t - 40_000)) / 1000, (rand() - 0.5) * 6, 90, 6)])
    const frames = drive(bufferAt(airfield()), feed, 'v', { durMs: 130_000, pollMs: 5000 })
    const parked = frames.filter((f) => f.t < 40_000)
    for (const f of parked) expect(Math.hypot(f.x - parked[0].x, f.y - parked[0].y)).toBe(0)
    const end = frames[frames.length - 1]
    expect(end.x).toBeGreaterThan(-100)
    expect(Math.abs(end.y)).toBeLessThan(0.5)
    expect(Math.abs(end.heading - 90)).toBeLessThan(3)
    expect(worstBackStep(frames)).toBeGreaterThanOrEqual(-1e-6)
    expect(roughness(frames).accel).toBeLessThan(4.01)
  })

  it('lets a hovering helicopter hover: it holds its heading and is never snapped', () => {
    const rand = rng(6)
    const heli = (x: number, y: number, hdg: number, mps: number) => aircraft('h', x, y, hdg, kt(mps), false, { category: 'A7', altitudeFt: 300 })
    // Flies in from the west along taxiway A's line (12 m north of it), then hovers with a noisy track.
    const feed: Feed = (t) => {
      const d = Math.min(900, (30 * t) / 1000)
      return d < 900 ? [heli(-1200 + d, 12, 90, 30)] : [heli(-300 + (rand() - 0.5) * 8, 12 + (rand() - 0.5) * 8, rand() * 360, 1)]
    }
    const frames = drive(bufferAt(airfield()), feed, 'h', { durMs: 120_000, pollMs: 5000 })
    const hover = frames.filter((f) => f.t > 60_000)
    for (const f of hover) {
      expect(Math.abs(f.heading - 90)).toBeLessThan(10)
      expect(Math.hypot(f.x - hover[0].x, f.y - hover[0].y)).toBeLessThan(1)
    }
    // Not pulled onto the taxiway it flew along.
    for (const f of frames.filter((x) => x.t < 30_000)) expect(f.y).toBeCloseTo(12, 1)
    expect(roughness(frames.filter((f) => f.t > 500)).accel).toBeLessThan(3.7)
  })
})

describe('LivePositionBuffer: timing details', () => {
  it('does not care how often it is sampled', () => {
    const feed = straight('a', 0, 0, 20, 90)
    const fine = drive(bufferAt(), feed, 'a', { durMs: 60_000, frameMs: 8 })
    const coarse = drive(bufferAt(), feed, 'a', { durMs: 60_000, frameMs: 100 })
    const a = fine[fine.length - 1]
    const c = coarse[coarse.length - 1]
    expect(Math.hypot(a.x - c.x, a.y - c.y)).toBeLessThan(2)
  })

  it('catches up at once after a long pause with nobody watching (a hidden tab), forwards', () => {
    const b = bufferAt()
    b.expectInterval(8000)
    const mps = 100
    const feed = straight('a', 0, 0, 0, mps)
    const poll = (t: number) => {
      const list = feed(t - 1500)!
      for (const a of list) a.positionTime = 1e12 + t - 1500
      b.push(list, t, 1e12 + t)
    }
    for (let t = 0; t <= 16_000; t += 8000) poll(t)
    const before = b.get('a', 16_000)!
    for (let t = 24_000; t <= 64_000; t += 8000) poll(t)
    const after = b.get('a', 64_100)!
    expect(xy(after.lon, after.lat).y).toBeGreaterThan(xy(before.lon, before.lat).y)
    expect(xy(after.lon, after.lat).y).toBeCloseTo((mps * (64_100 - 12_000)) / 1000, -2)
  })

  it('is a no-op to sample an earlier time again', () => {
    const b = bufferAt()
    const frames = drive(b, straight('a', 0, 0, 0, 100), 'a', { durMs: 30_000 })
    const last = frames[frames.length - 1]
    const again = b.get('a', last.t - 500)!
    expect(xy(again.lon, again.lat).y).toBeCloseTo(last.y, 6)
  })

  it('reports speeds in knots consistent with what is drawn', () => {
    const frames = drive(bufferAt(), straight('a', 0, 0, 0, 100), 'a', { durMs: 30_000 })
    const last = frames[frames.length - 1]
    expect(last.a.speedKt! * MPS_PER_KT).toBeCloseTo(last.v, 0)
  })
})
