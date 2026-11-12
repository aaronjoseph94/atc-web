import { describe, expect, it } from 'vitest'
import { SHAPE_IDS } from './shapes'
import { DEFAULT_LENGTH, SIDE_CLASSES, sideClassFor, sideProfile, type SideClass, type SideProfile } from './sideProfiles'
import { aircraftProfile, TYPES } from './types'

/** One representative type per class (null: drawn from the class alone). */
const SAMPLE: Record<SideClass, { shape: Parameters<typeof sideProfile>[0]['shape']; type: string | null }> = {
  narrow: { shape: 'ac-jet', type: 'B738' },
  wide: { shape: 'ac-heavy', type: 'B77W' },
  quad: { shape: 'ac-quad', type: 'B744' },
  regional: { shape: 'ac-regional', type: 'CRJ9' },
  smalljet: { shape: 'ac-ejet', type: 'E75L' },
  turboprop: { shape: 'ac-turboprop', type: 'DH8D' },
  bizjet: { shape: 'ac-bizjet', type: 'GLF6' },
  light: { shape: 'ac-light', type: 'C172' },
  lighttwin: { shape: 'ac-twin-piston', type: 'BE58' },
  heli: { shape: 'ac-heli', type: 'EC35' },
  generic: { shape: 'ac-dot', type: null },
}

const COMMANDS = /^[MLCQAZ0-9.\s-]+$/

/** Every number in a path, and a check that it is drawable. */
function pathNumbers(d: string): number[] {
  expect(d).toMatch(/^M/)
  expect(d).toMatch(COMMANDS)
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  expect(nums.length).toBeGreaterThan(1)
  for (const v of nums) expect(Number.isFinite(v)).toBe(true)
  return nums
}

function make(cls: SideClass, gear = false): SideProfile {
  const s = SAMPLE[cls]
  const facts = s.type ? TYPES[s.type] : undefined
  return sideProfile({ shape: s.shape, type: s.type, lengthM: facts?.lengthM, spanM: facts?.spanM, gear })
}

const roles = (p: SideProfile) => new Set(p.parts.map((x) => x.role))

describe('sideProfile', () => {
  it('maps every map drawing to a side-view class', () => {
    for (const id of SHAPE_IDS) expect(SIDE_CLASSES).toContain(sideClassFor(id))
  })

  for (const cls of SIDE_CLASSES) {
    for (const gear of [false, true]) {
      it(`draws a valid ${cls}${gear ? ' with gear down' : ''}`, () => {
        const p = make(cls, gear)
        expect(p.cls).toBe(cls)
        expect(p.parts.length).toBeGreaterThan(4)
        for (const part of p.parts) {
          pathNumbers(part.d)
          if (part.stroke != null) expect(part.stroke).toBeGreaterThan(0)
        }
        const [, , w, h] = p.box
        for (const v of p.box) expect(Number.isFinite(v)).toBe(true)
        // The box holds the whole fuselage, and the picture is a side view: much longer than tall.
        expect(w).toBeGreaterThanOrEqual(p.length)
        expect(w / h).toBeGreaterThan(cls === 'heli' ? 1.4 : cls === 'light' ? 2 : 2.4)
        expect(w / h).toBeLessThan(9)
        // Fuselage slenderness within what real aircraft have.
        expect(p.length / p.height).toBeGreaterThan(4)
        expect(p.length / p.height).toBeLessThan(16)
        // Exactly one fuselage, and a fin.
        expect(p.parts.filter((x) => x.role === 'fuselage')).toHaveLength(1)
        expect(roles(p).has('fin')).toBe(true)
      })
    }
  }

  it('gives each class its characteristic parts', () => {
    expect(roles(make('narrow')).has('nacelle')).toBe(true)
    expect(roles(make('narrow')).has('windows')).toBe(true)
    expect(roles(make('turboprop')).has('prop')).toBe(true)
    expect(roles(make('light')).has('prop')).toBe(true)
    expect(roles(make('lighttwin')).has('prop')).toBe(true)
    expect(roles(make('heli')).has('rotor')).toBe(true)
    expect(roles(make('heli')).has('skid')).toBe(true)
    expect(roles(make('heli')).has('nacelle')).toBe(false)
    // Fixed gear on a light single, retracted gear on an airliner in flight.
    expect(roles(make('light')).has('wheel')).toBe(true)
    expect(roles(make('narrow')).has('wheel')).toBe(false)
    expect(roles(make('narrow', true)).has('wheel')).toBe(true)
    // A quad shows its two near-side engines; twins one.
    expect(make('quad').parts.filter((x) => x.role === 'nacelle')).toHaveLength(2)
    expect(make('wide').parts.filter((x) => x.role === 'nacelle')).toHaveLength(1)
  })

  it('puts rear engines high on the tail and wing engines under the wing', () => {
    const centreY = (p: SideProfile) => {
      const ys = pathNumbers(p.parts.find((x) => x.role === 'nacelle')!.d).filter((_, i) => i % 2 === 1)
      return (Math.min(...ys) + Math.max(...ys)) / 2
    }
    const centreX = (p: SideProfile) => {
      const xs = pathNumbers(p.parts.find((x) => x.role === 'nacelle')!.d).filter((_, i) => i % 2 === 0)
      return (Math.min(...xs) + Math.max(...xs)) / 2
    }
    for (const cls of ['regional', 'bizjet'] as const) {
      const p = make(cls)
      expect(centreY(p)).toBeLessThan(0) // above the centre line
      expect(centreX(p) / p.length).toBeLessThan(0.4) // on the rear fuselage
    }
    for (const cls of ['narrow', 'wide', 'smalljet'] as const) {
      const p = make(cls)
      expect(centreY(p)).toBeGreaterThan(p.height / 2) // below the belly
      expect(centreX(p) / p.length).toBeGreaterThan(0.5)
    }
  })

  it('uses the type length, so stretched versions come out longer', () => {
    const a319 = sideProfile({ shape: 'ac-jet', type: 'A319', lengthM: TYPES.A319.lengthM })
    const a321 = sideProfile({ shape: 'ac-jet', type: 'A321', lengthM: TYPES.A321.lengthM })
    expect(a321.length).toBeGreaterThan(a319.length)
    expect(a321.height).toBe(a319.height)
    // Unknown and absurd lengths fall back to something sane.
    expect(sideProfile({ shape: 'ac-heavy' }).length).toBe(DEFAULT_LENGTH.wide)
    expect(sideProfile({ shape: 'ac-jet', lengthM: 400 }).length).toBeLessThanOrEqual(56)
    expect(sideProfile({ shape: 'ac-jet', lengthM: Number.NaN }).length).toBe(DEFAULT_LENGTH.narrow)
  })

  it('draws a wide-body taller than a narrow-body, and a 747 with its upper deck', () => {
    expect(make('wide').height).toBeGreaterThan(make('narrow').height)
    const b744 = make('quad')
    const plain = sideProfile({ shape: 'ac-quad', type: 'A343', lengthM: TYPES.A343.lengthM })
    expect(b744.parts.filter((x) => x.role === 'windows').length).toBeGreaterThan(plain.parts.filter((x) => x.role === 'windows').length)
  })

  it('picks the family from the type: engine count, decks, tail engines', () => {
    const of = (t: string) => sideProfile({ shape: aircraftProfile({ type: t }).shape, type: t, lengthM: TYPES[t]?.lengthM, spanM: TYPES[t]?.spanM })
    const nacelles = (t: string) => of(t).parts.filter((x) => x.role === 'nacelle').length
    // The A340 is drawn with four engines (two near-side), the A330 with two.
    expect(nacelles('A343')).toBe(2)
    expect(nacelles('A333')).toBe(1)
    expect(nacelles('A388')).toBe(2)
    // The A380's double deck is the tallest fuselage; the 747's hump rises above its main deck.
    expect(of('A388').height).toBeGreaterThan(of('B744').height)
    expect(of('B744').body[0]).toBeLessThan(-of('B744').height / 2)
    expect(of('B77W').body[0]).toBeCloseTo(-of('B77W').height / 2)
    // Turboprops carry propellers; the CRJ none.
    expect(of('AT76').parts.some((x) => x.role === 'prop')).toBe(true)
    expect(of('CRJ9').parts.some((x) => x.role === 'prop')).toBe(false)
  })

  it('draws every type in the facts table', () => {
    for (const [code, f] of Object.entries(TYPES)) {
      const { shape } = aircraftProfile({ type: code })
      const p = sideProfile({ shape, type: code, lengthM: f.lengthM, spanM: f.spanM })
      for (const part of p.parts) pathNumbers(part.d)
    }
  })
})
