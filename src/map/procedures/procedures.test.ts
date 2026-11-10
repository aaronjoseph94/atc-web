import { describe, expect, it } from 'vitest'
import type { LngLat } from '../geo'
import { atisRunways, matchProcedure, nearestOnLine, normRunway, procedureTitle, runwaysInUseNow, uniqueSegments, visibleLines, type ProcLine, type ProcLineProps, type Traffic } from './procedures'

const line = (coordinates: LngLat[], props: Partial<ProcLineProps> = {}): ProcLine => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates },
  properties: { k: 'star', n: 'TEST1 arrival', ...props },
})

// A final for runway 22L into JFK: from the north-east, heading about 224.
const FINAL = line(
  [
    [-73.636, 40.797],
    [-73.694, 40.723],
    [-73.755, 40.645],
  ],
  { k: 'final', n: 'ILS 22L', rw: '22L' },
)
// An arrival route crossing from the south, heading north.
const STAR = line(
  [
    [-73.8, 40.3],
    [-73.8, 40.55],
  ],
  { k: 'star', n: 'CAMRN5 arrival' },
)
const plane = (lon: number, lat: number, heading: number, altitudeFt: number, extra: Partial<Traffic> = {}): Traffic => ({ lon, lat, heading, altitudeFt, onGround: false, ...extra })

describe('uniqueSegments', () => {
  it('keeps shared segments once and joins what is left into runs', () => {
    const a = line([
      [0, 0],
      [1, 0],
      [2, 0],
    ])
    const b = line([
      [0, 1],
      [1, 0],
      [2, 0],
      [3, 0],
    ])
    expect(uniqueSegments([a, b])).toEqual([
      [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      [
        [0, 1],
        [1, 0],
      ],
      [
        [2, 0],
        [3, 0],
      ],
    ])
  })

  it('treats a segment drawn backwards as the same one', () => {
    const a = line([
      [0, 0],
      [1, 0],
    ])
    const b = line([
      [1, 0],
      [0, 0],
    ])
    expect(uniqueSegments([a, b])).toHaveLength(1)
  })
})

describe('matching aircraft to procedures', () => {
  it('measures distance and direction along a line', () => {
    const near = nearestOnLine([-73.694, 40.723], FINAL.geometry.coordinates)!
    expect(near.distNm).toBeLessThan(0.01)
    expect(near.bearing).toBeGreaterThan(200)
    expect(near.bearing).toBeLessThan(240)
  })

  it('finds the final an aircraft is established on', () => {
    expect(matchProcedure(plane(-73.7, 40.716, 222, 2000), [STAR, FINAL], 13)).toBe(1)
  })

  it('ignores aircraft going the wrong way, too far off, too high or on the ground', () => {
    expect(matchProcedure(plane(-73.7, 40.716, 42, 2000), [FINAL], 13)).toBe(-1)
    expect(matchProcedure(plane(-73.55, 40.716, 222, 2000), [FINAL], 13)).toBe(-1)
    expect(matchProcedure(plane(-73.7, 40.716, 222, 15000), [FINAL], 13)).toBe(-1)
    expect(matchProcedure(plane(-73.7, 40.716, 222, 13, { onGround: true }), [FINAL], 13)).toBe(-1)
  })

  it('does not put a hard climber on an arrival', () => {
    expect(matchProcedure(plane(-73.8, 40.4, 2, 9000), [STAR], 13)).toBe(0)
    expect(matchProcedure(plane(-73.8, 40.4, 2, 9000, { verticalRateFpm: 2500 }), [STAR], 13)).toBe(-1)
  })

  it('works out the runways in use from traffic, landings and the ATIS', () => {
    expect([...runwaysInUseNow([plane(-73.7, 40.716, 222, 2000)], [FINAL], 13, [])]).toEqual(['22L'])
    expect([...runwaysInUseNow([], [FINAL], 13, ['04R', '31L'])].sort()).toEqual(['31L', '4R'])
    expect(normRunway('RW04L')).toBe('4L')
  })
})

describe('ATIS', () => {
  it('reads the landing and departure runways and skips closures', () => {
    const jfk =
      'JFK ATIS INFO Q 0751Z. 31009KT 10SM SCT046 BKN250 10/02 A2999 (TWO NINER NINER NINER). APPROACH IN USE ILS RY 31L. DEPG RY 31L. RWY 4L, 22R CLSD, RWY 13L, 31R CLSD. ...ADVS YOU HAVE INFO Q.'
    expect(atisRunways(jfk)).toEqual({ landing: ['31L'], departing: ['31L'] })
    const atl = atisRunways('SIMUL APCHS IN USE RWYS 9L, 10C AND 10L. DEPG RWY 8R AND 9R.')
    expect(atl.landing.sort()).toEqual(['10C', '10L', '9L'])
    expect(atl.departing.sort()).toEqual(['8R', '9R'])
    expect(atisRunways('LDG RWY 4R, DEPG RWY 4L.')).toEqual({ landing: ['4R'], departing: ['4L'] })
    expect(atisRunways('LNDG AND DEPG RWYS 22L, 22R.')).toEqual({ landing: ['22L', '22R'], departing: ['22L', '22R'] })
    expect(atisRunways('VISUAL APPROACH RWY 22L AND 22R IN USE.').landing.sort()).toEqual(['22L', '22R'])
    expect(atisRunways('NOTICE TO AIR MISSIONS. TWY B CLSD.')).toEqual({ landing: [], departing: [] })
    const den = atisRunways('EXPC ILS, RNAV, OR VISUAL APCH, SIMUL APCHS IN USE, RWY 26, EXPECT OFFSET RNAV APPROACH RWY 16R, EXPECT VISUAL APCH RWY 16L, RWY16R ILS NA. DEPG RWY17L, RWY17R.')
    expect(den.landing.sort()).toEqual(['16L', '16R', '26'])
    expect(den.departing.sort()).toEqual(['17L', '17R'])
  })
})

describe('visibleLines', () => {
  const lines = [
    line([[0, 0], [1, 0]], { k: 'star', n: 'A1 arrival' }),
    line([[0, 0], [1, 0]], { k: 'star', n: 'A1 arrival', t: 'Runway 4L', rw: '4L' }),
    line([[0, 0], [1, 0]], { k: 'sid', n: 'D1 departure', t: 'Runway 31L', rw: '31L' }),
    line([[0, 0], [1, 0]], { k: 'trans', n: 'ILS 22L', t: 'from X', rw: '22L' }),
    line([[0, 0], [1, 0]], { k: 'final', n: 'ILS 4L', rw: '4L' }),
  ]
  it('shows every branch when the runways in use are unknown', () => {
    expect(visibleLines(lines, new Set(), new Set())).toHaveLength(5)
  })
  it('keeps runway branches for the runways in use only', () => {
    const shown = visibleLines(lines, new Set(['22L']), new Set(['31L'])).map((l) => `${l.properties.n} ${l.properties.t ?? ''}`.trim())
    expect(shown).toEqual(['A1 arrival', 'D1 departure Runway 31L', 'ILS 22L from X', 'ILS 4L'])
  })
})

describe('procedureTitle', () => {
  it('leads with the name and explains the branch', () => {
    expect(procedureTitle({ k: 'star', n: 'CAMRN5 arrival', t: 'PVD transition' })).toEqual({ title: 'CAMRN5 arrival', detail: 'PVD transition' })
    expect(procedureTitle({ k: 'final', n: 'ILS 22L', also: 'LOC 22L' })).toEqual({ title: 'ILS 22L', detail: 'Also LOC 22L' })
    expect(procedureTitle({ k: 'sid', n: 'DEEZZ6 departure' })).toEqual({ title: 'DEEZZ6 departure', detail: null })
  })
})
