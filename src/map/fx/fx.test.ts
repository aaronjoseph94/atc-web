import { describe, expect, it } from 'vitest'
import { getShape } from '../../aircraft/shapes'
import { bankedImage, bankOfImage, bankShape, shapeOfImage } from '../mapImages'
import { arrivalScale, clipToLength, DAY_STROBE_OPACITY, edgeOpacity, hideCoveredFins, lightOpacity, litBits, NIGHT_LIGHT_OPACITY } from './aircraftFx'
import { bankAngle, bankLevel, TurnTracker } from './bank'
import { beaconOn, phaseOf, STROBE_PERIOD_MS, strobeOn } from './blink'
import { dominantColour } from './brand'
import { anchorsFor, bankDegrees, bankSpanScale, toIconPx } from './geometry'
import { lightImage, parseFxImage } from './sprites'
import { artTiers } from '../mapStyle'
import type { Feature, Point } from 'geojson'

describe('anchors', () => {
  it('puts the wingtips at the widest point and the tail behind the nose', () => {
    const a = anchorsFor('ac-jet')
    expect(a.wingtip[0]).toBeCloseTo(17.89, 2)
    expect(a.nose[1]).toBeLessThan(0)
    expect(a.tail[1]).toBeGreaterThan(15)
    expect(a.beacon[1]).toBeGreaterThan(a.nose[1])
    expect(a.beacon[1]).toBeLessThan(a.tail[1])
    expect(a.engines).toHaveLength(1)
    expect(a.fin).not.toBeNull()
    expect(anchorsFor('ac-vehicle').lit).toBe(false)
    expect(anchorsFor('ac-light').fin).toBeNull()
  })

  it('maps the longer side onto 78% of the 48 px box', () => {
    const a = anchorsFor('ac-jet')
    // 737: length 39.5 m is the longer side, nose at -19.75 m.
    expect(toIconPx(a, a.nose)[1]).toBeCloseTo(-0.39 * 48, 1)
  })
})

describe('blink', () => {
  it('double-flashes the strobe once per period', () => {
    let flashes = 0
    let was = false
    for (let t = 0; t < STROBE_PERIOD_MS; t += 5) {
      const on = strobeOn(t, 0)
      if (on && !was) flashes++
      was = on
    }
    expect(flashes).toBe(2)
  })

  it('gives each aircraft its own stable phase', () => {
    expect(phaseOf('a1b2c3')).toBe(phaseOf('a1b2c3'))
    expect(phaseOf('a1b2c3')).not.toBe(phaseOf('a1b2c4'))
    expect(phaseOf('x')).toBeGreaterThanOrEqual(0)
    expect(phaseOf('x')).toBeLessThan(1)
  })

  it('lights the beacon for a short part of each period', () => {
    let on = 0
    for (let t = 0; t < 11500; t += 10) if (beaconOn(t, 0.3)) on++
    expect(on / 1150).toBeGreaterThan(0.1)
    expect(on / 1150).toBeLessThan(0.25)
  })
})

describe('litBits', () => {
  const base = { night: 1, parked: false, onGround: false, rolling: false, tMs: 0, phase: 0, reduceMotion: false }
  it('shows navigation lights at night and strobes only by day', () => {
    expect(litBits({ ...base, tMs: 10 })).toMatch(/^NS/)
    expect(litBits({ ...base, night: 0, tMs: 10 })).toBe('S')
    expect(litBits({ ...base, night: 0, tMs: 600 })).toBe('')
  })
  it('keeps strobes off while taxiing and the beacon off when parked', () => {
    expect(litBits({ ...base, onGround: true, tMs: 10 })).not.toContain('S')
    expect(litBits({ ...base, onGround: true, rolling: true, tMs: 10 })).toContain('S')
    for (let t = 0; t < 2000; t += 50) expect(litBits({ ...base, onGround: true, parked: true, tMs: t })).toBe('N')
  })
  it('holds lights steady with reduced motion', () => {
    for (let t = 0; t < 2000; t += 50) expect(litBits({ ...base, tMs: t, reduceMotion: true })).toBe('NB')
    expect(litBits({ ...base, night: 0, tMs: 10, reduceMotion: true })).toBe('')
  })
})

describe('lightOpacity', () => {
  it('is almost invisible by day and never full strength at night', () => {
    expect(lightOpacity(0, false)).toBe(DAY_STROBE_OPACITY)
    expect(DAY_STROBE_OPACITY).toBeLessThan(0.2)
    expect(lightOpacity(1, false)).toBe(NIGHT_LIGHT_OPACITY)
    expect(NIGHT_LIGHT_OPACITY).toBeLessThan(0.8)
  })
  it('comes up with the dusk and is dimmer on a parked aircraft', () => {
    expect(lightOpacity(0.3, false)).toBeLessThan(lightOpacity(0.6, false))
    expect(lightOpacity(0.6, false)).toBeLessThan(lightOpacity(1, false))
    expect(lightOpacity(1, true)).toBeLessThan(lightOpacity(1, false) * 0.6)
  })
})

describe('banking', () => {
  it('works out the bank of a coordinated turn', () => {
    // Standard rate (3°/s) at 150 kt is about 22°.
    expect(bankAngle(3, 150)).toBeGreaterThan(20)
    expect(bankAngle(3, 150)).toBeLessThan(24)
    expect(bankAngle(-3, 150)).toBeLessThan(0)
    expect(bankAngle(30, 400)).toBe(35)
  })

  it('steps through levels with hysteresis', () => {
    expect(bankLevel(3, 0)).toBe(0)
    expect(bankLevel(8, 0)).toBe(1)
    expect(bankLevel(20, 0)).toBe(2)
    expect(bankLevel(-20, 0)).toBe(-2)
    // Just under the step: stays where it was.
    expect(bankLevel(14.5, 2)).toBe(2)
    expect(bankLevel(14.5, 1)).toBe(1)
    expect(bankLevel(4.5, 1)).toBe(1)
    expect(bankLevel(2, 1)).toBe(0)
  })

  it('follows the drawn heading frame to frame', () => {
    const tr = new TurnTracker()
    let level = 0
    // 3°/s right turn at 200 kt, 60 fps for 3 s.
    for (let i = 0; i <= 180; i++) level = tr.update('a', (i * 3) / 60, 200, true, i * (1000 / 60))
    expect(level).toBe(2)
    // On the ground nothing leans.
    const g = new TurnTracker()
    for (let i = 0; i <= 180; i++) level = g.update('a', (i * 10) / 60, 15, false, i * (1000 / 60))
    expect(level).toBe(0)
  })

  it('draws the lower wing shorter than the raised one', () => {
    const { low, high } = bankSpanScale(23)
    expect(low).toBeLessThan(high)
    expect(high).toBeLessThan(1.02)
    expect(bankDegrees('bR2')).toBe(23)
    expect(bankDegrees('bL1')).toBe(-11)
    expect(bankDegrees('')).toBe(0)
    const s = getShape('ac-jet')
    const banked = bankShape(s, 23)
    const xs = (p: string) => [...p.matchAll(/(-?\d*\.?\d+) (-?\d*\.?\d+)/g)].map((m) => Number(m[1]))
    expect(Math.max(...xs(banked.outline))).toBeLessThan(Math.max(...xs(s.outline)) * 0.85)
    expect(Math.min(...xs(banked.outline))).toBeLessThan(-Math.max(...xs(s.outline)) * 0.9)
  })
})

describe('image ids', () => {
  it('knows the shape behind every variant', () => {
    expect(shapeOfImage('ac-jet-bR2-hi')).toBe('ac-jet')
    expect(shapeOfImage('ac-jet-bL1-sdf')).toBe('ac-jet')
    expect(shapeOfImage('ac-jet-pk')).toBe('ac-jet')
    expect(shapeOfImage('ac-heli-r2-hi')).toBe('ac-heli')
    expect(shapeOfImage('tag|n|-|X|')).toBeNull()
    expect(bankOfImage('ac-jet-bR2-hi')).toEqual({ dir: 'R', level: 2 })
    expect(bankOfImage('ac-jet')).toBeNull()
  })

  it('parses effect sprite ids', () => {
    expect(parseFxImage(`${lightImage('ac-twin-piston', 'NSB')}1`)).toEqual({ kind: 'light', shape: 'ac-twin-piston', rest: 'NSB-1' })
    expect(parseFxImage(`${lightImage('ac-jet', 'N', 'bR2')}0`)).toEqual({ kind: 'light', shape: 'ac-jet', rest: 'bR2-N-0' })
    expect(parseFxImage('fx-fin-ac-heavy')).toEqual({ kind: 'fin', shape: 'ac-heavy', rest: '' })
    expect(parseFxImage('ac-jet')).toBeNull()
  })

  it('uses the level drawing until a banked one has been drawn', () => {
    const images = new Set<string>()
    const map = { hasImage: (id: string) => images.has(id), getStyle: () => null } as never
    expect(bankedImage(map, 'ac-jet', 2)).toBe('ac-jet')
    for (const id of ['ac-jet-bR1', 'ac-jet-bR1-hi', 'ac-jet-bR1-sdf']) images.add(id)
    // The reduced copies for the wider views must be there too.
    expect(bankedImage(map, 'ac-jet', 2)).toBe('ac-jet')
    for (const t of artTiers()) for (const id of ['ac-jet-bR1', 'ac-jet-bR1-hi']) images.add(`${id}${t.suffix}`)
    expect(bankedImage(map, 'ac-jet', 2)).toBe('ac-jet-bR1')
    expect(bankedImage(map, 'ac-jet', 0)).toBe('ac-jet')
    expect(bankedImage(map, 'ac-heli-r1', 2)).toBe('ac-heli-r1')
  })
})

describe('dominantColour', () => {
  const px = (colours: [number, number, number, number, number][]) => {
    const out: number[] = []
    for (const [r, g, b, a, n] of colours) for (let i = 0; i < n; i++) out.push(r, g, b, a)
    return new Uint8ClampedArray(out)
  }
  it('picks the main colour and ignores white and grey', () => {
    const c = dominantColour(px([[255, 255, 255, 255, 200], [200, 16, 46, 255, 60], [0, 40, 120, 255, 20], [0, 0, 0, 0, 300]]))
    expect(c).not.toBeNull()
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c!.slice(i, i + 2), 16))
    expect(r).toBeGreaterThan(g * 3)
    expect(r).toBeGreaterThan(b * 2)
  })
  it('gives no colour for a white or grey logo', () => {
    expect(dominantColour(px([[255, 255, 255, 255, 200], [120, 120, 125, 255, 100]]))).toBeNull()
    expect(dominantColour(px([[0, 0, 0, 0, 100]]))).toBeNull()
  })
  it('keeps very light colours dark enough to read on white', () => {
    const c = dominantColour(px([[150, 200, 255, 255, 100]]))!
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
    expect((Math.max(r, g, b) + Math.min(r, g, b)) / 510).toBeLessThanOrEqual(0.57)
  })
})

describe('screen and motion helpers', () => {
  it('fades tags toward the edges only', () => {
    expect(edgeOpacity(215, 410, 430, 820)).toBe(1)
    expect(edgeOpacity(2, 410, 430, 820)).toBeLessThan(0.5)
    expect(edgeOpacity(60, 410, 430, 820)).toBeGreaterThan(edgeOpacity(20, 410, 430, 820))
  })
  it('scales arriving aircraft in from 85%', () => {
    expect(arrivalScale(0)).toBeCloseTo(0.85)
    expect(arrivalScale(1)).toBe(1)
    expect(arrivalScale(0.5)).toBeGreaterThan(0.9)
  })
  it('keeps the newest stretch of a track', () => {
    // Four points ~1.1 km apart, heading north.
    const track: [number, number][] = [0, 1, 2, 3].map((i) => [0, i * 0.01])
    const cut = clipToLength(track, 1600)
    expect(cut[cut.length - 1]).toEqual([0, 0.03])
    expect(cut).toHaveLength(3)
    expect(cut[0][1]).toBeCloseTo(0.03 - 1600 / 110_540, 5)
    expect(clipToLength(track, 1e6)).toEqual(track)
  })
})

describe('hideCoveredFins', () => {
  const at = (lon: number, z: number, lv = '#c00') => ({ type: 'Feature', properties: { lv, z }, geometry: { type: 'Point', coordinates: [lon, 40] } }) as Feature<Point>
  // 1 m per pixel; 20 px reach: two aircraft 10 m apart overlap, 100 m apart don't.
  const run = (fs: Feature<Point>[]) => hideCoveredFins(fs, () => 20, 1)
  const deg = (m: number) => m / (111_320 * Math.cos((40 * Math.PI) / 180))

  it('keeps fins on aircraft nobody is drawn over', () => {
    const fs = [at(0, 0), at(deg(100), 0)]
    run(fs)
    expect(fs.map((f) => f.properties!.lv)).toEqual(['#c00', '#c00'])
  })

  it('drops the fin of the one drawn underneath', () => {
    // Higher z draws on top; at the same z the later feature does.
    const high = [at(0, 500), at(deg(10), 0)]
    run(high)
    expect(high.map((f) => f.properties!.lv)).toEqual(['#c00', ''])
    const same = [at(0, 0), at(deg(10), 0)]
    run(same)
    expect(same.map((f) => f.properties!.lv)).toEqual(['', '#c00'])
  })
})
