import { describe, expect, it } from 'vitest'
import type { RunwayEndGeometry } from '../map/airportDiagram'
import { M_PER_NM, offset, type LngLat } from '../map/geo'
import { arrivalEstimate, buildTimeline, formatCountdown, formatDuration, monotonePath, stepLabel, valueAt, type TrackPoint } from './timeline'

// One runway, 3 km long, running west: "27" lands at the east end, "9" at the west end.
const O: LngLat = [-87.9, 41.98]
const LEN = 3000
const ends: RunwayEndGeometry[] = [
  { ident: '27', threshold: O, bearing: 270, lengthM: LEN, widthM: 45 },
  { ident: '9', threshold: offset(O, -LEN, 0), bearing: 90, lengthM: LEN, widthM: 45 },
]
const ELEV = 600
const ctx = { ends, elevationFt: ELEV }

/** A point `east`/`north` metres from the 27 threshold. */
function at(t: number, east: number, north: number, extra: Partial<TrackPoint> = {}): TrackPoint {
  const [lon, lat] = offset(O, east, north)
  return { t, lat, lon, heading: 270, altitudeFt: null, speedKt: 0, onGround: true, ...extra }
}

/** Gate → pushback → taxi → line up → roll → wheels up → climb → level at 5,000 ft. */
function departure(): TrackPoint[] {
  const pts: TrackPoint[] = []
  let t = 0
  const step = 5000
  // Parked at a gate 400 m north of the runway for a minute.
  pts.push(at(t, 200, 400, { heading: 180 }), at((t += 60_000), 200, 400, { heading: 180 }))
  // Pushback: a few metres at a crawl.
  for (let i = 1; i <= 4; i++) pts.push(at((t += step), 200, 400 + i * 8, { speedKt: 3, heading: 180 }))
  // Taxi toward the threshold under power.
  for (let i = 1; i <= 8; i++) pts.push(at((t += step), 200 - i * 20, 400 - i * 45, { speedKt: 15, heading: 225 }))
  // Lined up and waiting on the runway.
  pts.push(at((t += step), -20, 0, { speedKt: 0 }), at((t += 20_000), -20, 0, { speedKt: 0 }))
  // The roll: accelerating down the runway.
  let x = -20
  for (const kt of [55, 95, 130, 150]) {
    x -= kt * 0.514 * 5
    pts.push(at((t += step), x, 0, { speedKt: kt }))
  }
  // Airborne and climbing at 2,000 fpm.
  let alt = ELEV + 150
  for (let i = 0; i < 30; i++) {
    x -= 170 * 0.514 * 5
    pts.push(at((t += step), x, 0, { speedKt: 170, altitudeFt: alt, onGround: false }))
    alt = Math.min(5000, alt + 2000 / 12)
  }
  // Level at 5,000 for a minute and a half.
  for (let i = 0; i < 18; i++) {
    x -= 220 * 0.514 * 5
    pts.push(at((t += step), x, 0, { speedKt: 220, altitudeFt: 5000, onGround: false }))
  }
  return pts
}

/** Seven miles out on final for 27, touchdown, rollout, taxi in, three minutes at the gate. */
function arrival(): TrackPoint[] {
  const pts: TrackPoint[] = []
  let t = 0
  const kt = 140
  for (let out = 7 * M_PER_NM; out > 0; out -= kt * 0.514 * 5) {
    pts.push(at(t, out, 0, { speedKt: kt, altitudeFt: ELEV + (out / M_PER_NM) * 300, onGround: false }))
    t += 5000
  }
  let x = -300
  for (const s of [120, 90, 60, 40, 25]) {
    pts.push(at(t, x, 0, { speedKt: s }))
    x -= s * 0.514 * 5
    t += 5000
  }
  for (let i = 1; i <= 6; i++) pts.push(at((t += 5000), x, i * 60, { speedKt: 15, heading: 0 }))
  pts.push(at((t += 5000), x, 420, { speedKt: 0, heading: 0 }), at((t += 180_000), x, 420, { speedKt: 0, heading: 0 }))
  return pts
}

const keys = (tl: ReturnType<typeof buildTimeline>) => tl.steps.map((s) => `${s.key}:${s.state}`)

describe('buildTimeline', () => {
  it('follows a departure from the gate to level-off', () => {
    const tl = buildTimeline(departure(), ctx)
    expect(tl.role).toBe('departure')
    expect(keys(tl)).toEqual(['pushback:done', 'taxiOut:done', 'lineUp:done', 'takeoffRoll:done', 'airborne:done', 'climb:done', 'level:current'])
    const byKey = Object.fromEntries(tl.steps.map((s) => [s.key, s]))
    expect(byKey.lineUp.runway).toBe('27')
    expect(byKey.takeoffRoll.runway).toBe('27')
    expect(byKey.level.altitudeFt).toBe(5000)
    // Wheels up falls between the last ground report and the first airborne one.
    const pts = departure()
    const firstAir = pts.findIndex((p) => !p.onGround)
    expect(tl.wheelsUp).toBeGreaterThanOrEqual(pts[firstAir - 1].t)
    expect(tl.wheelsUp).toBeLessThanOrEqual(pts[firstAir].t)
    // The roll lasts from its start until wheels up.
    expect(byKey.takeoffRoll.until).toBe(tl.wheelsUp)
    // Times only ever move forward.
    const times = tl.steps.map((s) => s.at!)
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })

  it('marks what is still to come for a departure that is only taxiing', () => {
    const pts = departure().filter((p) => p.onGround && (p.speedKt ?? 0) < 20)
    const tl = buildTimeline(pts, ctx)
    expect(tl.role).toBe('departure')
    expect(keys(tl)).toEqual(['pushback:done', 'taxiOut:done', 'lineUp:current', 'takeoffRoll:upcoming', 'airborne:upcoming', 'climb:upcoming'])
  })

  it('does not invent the early phases of a departure first seen climbing', () => {
    const pts = departure().filter((p) => !p.onGround && (p.altitudeFt ?? 0) > ELEV + 1200)
    const tl = buildTimeline(pts, ctx)
    expect(tl.role).toBe('departure')
    expect(tl.steps.filter((s) => s.state === 'missed').map((s) => s.key)).toEqual(['pushback', 'taxiOut', 'lineUp', 'takeoffRoll', 'airborne'])
    const climb = tl.steps.find((s) => s.key === 'climb')!
    expect(climb.inProgress).toBe(true)
    expect(climb.at).toBe(pts[0].t)
    expect(tl.wheelsUp).toBeNull()
  })

  it('follows an arrival from final to the gate', () => {
    const tl = buildTimeline(arrival(), ctx)
    expect(tl.role).toBe('arrival')
    expect(keys(tl)).toEqual(['descent:missed', 'approach:done', 'touchdown:done', 'rollout:done', 'taxiIn:done', 'atGate:current'])
    const byKey = Object.fromEntries(tl.steps.map((s) => [s.key, s]))
    expect(byKey.approach.runway).toBe('27')
    expect(byKey.approach.inProgress).toBe(true)
    expect(byKey.touchdown.runway).toBe('27')
    expect(byKey.rollout.until).toBe(byKey.taxiIn.at)
  })

  it('shows an inbound aircraft with its landing still to come', () => {
    const pts = arrival().filter((p) => !p.onGround)
    const tl = buildTimeline(pts, ctx)
    expect(tl.role).toBe('arrival')
    expect(tl.finalRunway).toBe('27')
    expect(keys(tl)).toEqual(['descent:missed', 'approach:current', 'touchdown:upcoming', 'rollout:upcoming', 'taxiIn:upcoming', 'atGate:upcoming'])
  })

  it('times the descent when seen coming down before joining final', () => {
    // Twelve reports descending at 1,500 fpm, well off to the side of the final.
    const early: TrackPoint[] = []
    for (let i = 0; i < 12; i++) early.push(at(i * 5000, 20 * M_PER_NM - i * 1200, 6000, { speedKt: 230, altitudeFt: ELEV + 7000 - i * 125, onGround: false, heading: 300 }))
    const rest = arrival().filter((p) => !p.onGround)
    for (const p of rest) p.t += 70_000
    const tl = buildTimeline([...early, ...rest], ctx)
    const descent = tl.steps.find((s) => s.key === 'descent')!
    expect(descent.state).toBe('done')
    expect(descent.inProgress).toBe(true)
    expect(tl.steps.find((s) => s.key === 'approach')!.inProgress).toBe(false)
  })

  it('does not call a short hold the gate', () => {
    const pts = arrival()
    pts[pts.length - 1].t = pts[pts.length - 2].t + 40_000
    const tl = buildTimeline(pts, ctx)
    expect(tl.current).toBe('taxiIn')
    expect(tl.steps.at(-1)).toMatchObject({ key: 'atGate', state: 'upcoming', at: null })
  })

  it('notices a go-around', () => {
    const pts = arrival().filter((p) => !p.onGround)
    // Low over the threshold, then climbing away instead of landing.
    let t = pts[pts.length - 1].t
    let alt = ELEV + 200
    for (let i = 1; i <= 8; i++) pts.push(at((t += 5000), -i * 400, 0, { speedKt: 150, altitudeFt: (alt += 150), onGround: false }))
    const tl = buildTimeline(pts, ctx)
    expect(tl.role).toBe('arrival')
    expect(keys(tl)).toEqual(['descent:missed', 'approach:done', 'goAround:current', 'touchdown:upcoming', 'rollout:upcoming', 'taxiIn:upcoming', 'atGate:upcoming'])
  })

  it('leaves unseen phases out for an overflight', () => {
    const pts: TrackPoint[] = []
    for (let i = 0; i < 20; i++) pts.push(at(i * 5000, 20_000 - i * 1000, 20_000, { speedKt: 300, altitudeFt: 24_000, onGround: false }))
    const tl = buildTimeline(pts, ctx)
    expect(tl.role).toBe('overflight')
    expect(keys(tl)).toEqual(['level:current'])
    expect(stepLabel(tl.steps[0], tl.role)).toBe('Cruise')
  })

  it('uses the route to tell which way a taxiing aircraft is going', () => {
    const pts = [at(0, 200, 400, { speedKt: 15 }), at(5000, 150, 380, { speedKt: 15 }), at(10_000, 100, 360, { speedKt: 15 })]
    expect(buildTimeline(pts, ctx).role).toBe('ground')
    expect(buildTimeline(pts, ctx).steps.map((s) => s.key)).toEqual(['taxiOut'])
    expect(buildTimeline(pts, { ...ctx, roleHint: 'arrival' }).role).toBe('arrival')
  })

  it('copes with no data', () => {
    expect(buildTimeline([], ctx)).toMatchObject({ steps: [], current: null })
  })
})

describe('arrivalEstimate', () => {
  it('divides distance by the recent ground speed', () => {
    const pts = arrival().filter((p) => !p.onGround)
    const last = pts[pts.length - 1]
    const eta = arrivalEstimate(pts, O)!
    expect(eta.groundspeedKt).toBeCloseTo(140, 0)
    expect(eta.remainingMs).toBeCloseTo((eta.distanceNm / 140) * 3_600_000, -2)
    expect(eta.distanceNm).toBeLessThan(0.5)
    expect(last.onGround).toBe(false)
  })

  it('declines on the ground, far away, or when slow', () => {
    expect(arrivalEstimate([at(0, 0, 0)], O)).toBeNull()
    expect(arrivalEstimate([at(0, 200 * M_PER_NM, 0, { onGround: false, speedKt: 400, altitudeFt: 30_000 })], O)).toBeNull()
    expect(arrivalEstimate([at(0, 5 * M_PER_NM, 0, { onGround: false, speedKt: 30, altitudeFt: 2000 })], O)).toBeNull()
  })
})

describe('helpers', () => {
  it('formats countdowns and durations', () => {
    expect(formatCountdown(245_000)).toBe('4:05')
    expect(formatCountdown(3_845_000)).toBe('1:04:05')
    expect(formatCountdown(-5)).toBe('0:00')
    expect(formatDuration(38_000)).toBe('38 s')
    expect(formatDuration(240_000)).toBe('4 min')
    expect(formatDuration(3_900_000)).toBe('1 h 05 min')
  })

  it('draws a monotone path that stays inside the data', () => {
    const d = monotonePath([
      [0, 10],
      [10, 0],
      [20, 0],
      [30, 5],
    ])
    expect(d.startsWith('M0 10 C')).toBe(true)
    const ys = [...d.matchAll(/C([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)/g)].flatMap((m) => [+m[2], +m[4]])
    for (const y of ys) expect(y).toBeGreaterThanOrEqual(0)
    expect(monotonePath([])).toBe('')
  })

  it('interpolates values between reports', () => {
    const pts = [at(0, 0, 0, { speedKt: 100 }), at(10_000, 0, 0, { speedKt: 200 })]
    expect(valueAt(pts, 5000, (p) => p.speedKt)).toBe(150)
    expect(valueAt(pts, -1, (p) => p.speedKt)).toBe(100)
    expect(valueAt(pts, 20_000, (p) => p.speedKt)).toBe(200)
  })
})
