import { describe, expect, it } from 'vitest'
import type { Aircraft } from '../api/types'
import { runwayEnds } from '../map/airportDiagram'
import { offset } from '../map/geo'
import type { LiveEvent } from './events'
import { activeRunways, createRunwayUse, decay, observeEvents, observeTraffic, oppositeEnds, runwaysFromAtis, sortIdents, summariseRunwayUse } from './runwayUse'

const ELEV = 680
const ends = runwayEnds('ORD')
const end = (ident: string) => ends.find((e) => e.ident === ident)!
const T0 = 1_700_000_000_000
const MIN = 60_000

/** A point `along` metres past runway end `ident`'s threshold (negative = on approach), `cross` metres right. */
function at(ident: string, along: number, cross = 0): [number, number] {
  const e = end(ident)
  const rad = (e.bearing * Math.PI) / 180
  return offset(e.threshold, Math.sin(rad) * along + Math.cos(rad) * cross, Math.cos(rad) * along - Math.sin(rad) * cross)
}

function ac(ident: string, over: Partial<Aircraft> & { pos: [number, number] }): Aircraft {
  return {
    icao24: 'a1',
    callsign: 'UAL2099',
    lon: over.pos[0],
    lat: over.pos[1],
    heading: end(ident).bearing,
    altitudeFt: ELEV,
    speedKt: 0,
    onGround: true,
    ...over,
  }
}

const ev = (over: Partial<LiveEvent>): LiveEvent => ({ id: `e${Math.random()}`, at: T0, kind: 'landed', icao24: 'b1', callsign: 'DAL1', runway: '28R', text: '', lon: 0, lat: 0, ...over })

describe('runway use from events', () => {
  it('counts landings and departures and summarises them', () => {
    const s = createRunwayUse()
    observeEvents(s, [ev({ icao24: 'x1', kind: 'landed', runway: '28R' }), ev({ icao24: 'x2', kind: 'departed', runway: '28R' }), ev({ icao24: 'x3', kind: 'departed', runway: '22L' })])
    const a = activeRunways(s, ends, T0 + MIN)
    expect(a.basis).toBe('traffic')
    expect(a.landing).toEqual(['28R'])
    expect(a.departing).toEqual(['22L', '28R'])
    expect(a.runways.find((r) => r.ident === '28R')?.role).toBe('both')
    expect(summariseRunwayUse(a)).toBe('Landing 28R · Departing 22L 28R')
  })

  it('does not count the same event twice', () => {
    const s = createRunwayUse()
    const e = ev({ kind: 'lineup', runway: '10L' })
    observeEvents(s, [e])
    observeEvents(s, [e])
    expect(s.sightings.size).toBe(1)
  })

  it('ignores events without a runway and emergencies', () => {
    const s = createRunwayUse()
    observeEvents(s, [ev({ runway: null }), ev({ kind: 'emergency', runway: '28R' })])
    expect(activeRunways(s, ends, T0).basis).toBe('none')
  })

  it('forgets a runway about twenty minutes after its last use', () => {
    const s = createRunwayUse()
    observeEvents(s, [ev({ runway: '28R' })])
    expect(activeRunways(s, ends, T0 + 10 * MIN).landing).toEqual(['28R'])
    expect(activeRunways(s, ends, T0 + 16 * MIN).landing).toEqual([])
    expect(decay(0)).toBe(1)
    expect(decay(5 * MIN)).toBe(1)
    expect(decay(12.5 * MIN)).toBeCloseTo(0.5)
    expect(decay(20 * MIN)).toBe(0)
  })

  it('keeps the busier end when both ends of one runway show up', () => {
    const s = createRunwayUse()
    const opp = oppositeEnds(ends).get('28R')!
    observeEvents(s, [ev({ icao24: 'a', runway: '28R' }), ev({ icao24: 'b', runway: '28R' }), ev({ icao24: 'c', runway: '28R' }), ev({ icao24: 'd', runway: opp })])
    const a = activeRunways(s, ends, T0)
    expect(a.landing).toEqual(['28R'])
  })

  it('breaks a tie between opposite ends with the wind', () => {
    const s = createRunwayUse()
    const opp = oppositeEnds(ends).get('28R')!
    observeEvents(s, [ev({ icao24: 'a', runway: '28R' }), ev({ icao24: 'b', runway: opp })])
    // Wind straight down 28R: the opposite end has a tailwind.
    const a = activeRunways(s, ends, T0, { windDirDeg: Math.round(end('28R').bearing), windKt: 14 })
    expect(a.landing).toEqual(['28R'])
  })
})

describe('runway use from traffic', () => {
  it('sees an aircraft descending on final', () => {
    const s = createRunwayUse()
    observeTraffic(s, [ac('28R', { pos: at('28R', -4 * 1852), onGround: false, altitudeFt: ELEV + 1300, speedKt: 150, verticalRateFpm: -700 })], ends, ELEV, T0)
    expect(activeRunways(s, ends, T0).landing).toEqual(['28R'])
  })

  it('without a vertical rate, uses height lost between fixes', () => {
    const s = createRunwayUse()
    const fix = (along: number, alt: number) => ac('28R', { pos: at('28R', along), onGround: false, altitudeFt: alt, speedKt: 150, verticalRateFpm: null })
    observeTraffic(s, [fix(-5 * 1852, ELEV + 1600)], ends, ELEV, T0)
    expect(s.sightings.size).toBe(0)
    observeTraffic(s, [fix(-4.8 * 1852, ELEV + 1500)], ends, ELEV, T0 + 5000)
    expect(activeRunways(s, ends, T0 + 5000).landing).toEqual(['28R'])
  })

  it('ignores an aircraft climbing through the approach path', () => {
    const s = createRunwayUse()
    observeTraffic(s, [ac('28R', { pos: at('28R', -3 * 1852), onGround: false, altitudeFt: ELEV + 900, speedKt: 160, verticalRateFpm: 1500 })], ends, ELEV, T0)
    expect(activeRunways(s, ends, T0).landing).toEqual([])
  })

  it('counts one slow approach once, however many fixes it is seen in', () => {
    const s = createRunwayUse()
    for (let i = 0; i < 30; i++) observeTraffic(s, [ac('28R', { pos: at('28R', -(7 - i * 0.2) * 1852), onGround: false, altitudeFt: ELEV + 2000 - i * 60, speedKt: 150, verticalRateFpm: -700 })], ends, ELEV, T0 + i * 5000)
    const r = activeRunways(s, ends, T0 + 150_000).runways.find((x) => x.ident === '28R')!
    expect(r.arrivalCount).toBe(1)
    expect(r.arrivals).toBeLessThanOrEqual(1)
  })

  it('sees a takeoff roll by the speed picking up', () => {
    const s = createRunwayUse()
    const roll = (along: number, kt: number, t: number) => observeTraffic(s, [ac('22L', { pos: at('22L', along), speedKt: kt })], ends, ELEV, t)
    roll(400, 50, T0)
    roll(700, 80, T0 + 5000)
    const a = activeRunways(s, ends, T0 + 5000)
    expect(a.departing).toEqual(['22L'])
    expect(a.landing).toEqual([])
  })

  it('sees a landing roll by the speed dropping, not as a departure', () => {
    const s = createRunwayUse()
    const roll = (along: number, kt: number, t: number) => observeTraffic(s, [ac('22L', { pos: at('22L', along), speedKt: kt })], ends, ELEV, t)
    roll(600, 120, T0)
    roll(1100, 90, T0 + 5000)
    roll(1400, 60, T0 + 10000)
    const a = activeRunways(s, ends, T0 + 10000)
    expect(a.landing).toEqual(['22L'])
    expect(a.departing).toEqual([])
  })

  it('sees an aircraft lined up and waiting', () => {
    const s = createRunwayUse()
    const wait = (t: number) => observeTraffic(s, [ac('10L', { pos: at('10L', 100), speedKt: 0 })], ends, ELEV, t)
    wait(T0)
    wait(T0 + 5000)
    expect(activeRunways(s, ends, T0 + 5000).departing).toEqual(['10L'])
  })

  it('does not take an aircraft crossing a runway, or a parked one with no heading, as using it', () => {
    const s = createRunwayUse()
    const across = (t: number) => observeTraffic(s, [ac('10L', { pos: at('10L', 900), heading: (end('10L').bearing + 90) % 360, speedKt: 12 })], ends, ELEV, t)
    across(T0)
    across(T0 + 5000)
    const still = (t: number) => observeTraffic(s, [ac('10L', { icao24: 'p', pos: at('10L', 1500), headingKnown: false, speedKt: 0 })], ends, ELEV, t)
    still(T0)
    still(T0 + 5000)
    expect(activeRunways(s, ends, T0 + 5000).basis).toBe('none')
  })

  it('sees an aircraft climbing out past the far end', () => {
    const s = createRunwayUse()
    const e = end('28R')
    observeTraffic(s, [ac('28R', { pos: at('28R', e.lengthM + 1500), onGround: false, altitudeFt: ELEV + 900, speedKt: 170, verticalRateFpm: 2500 })], ends, ELEV, T0)
    expect(activeRunways(s, ends, T0).departing).toEqual(['28R'])
  })

  it('leaves out ground vehicles', () => {
    const s = createRunwayUse()
    const roll = (kt: number, t: number) => observeTraffic(s, [ac('22L', { pos: at('22L', 500), speedKt: kt, category: 'C2' })], ends, ELEV, t)
    roll(40, T0)
    roll(60, T0 + 5000)
    expect(activeRunways(s, ends, T0 + 5000).basis).toBe('none')
  })
})

describe('wind fallback', () => {
  it('predicts the into-wind runways when the traffic is silent', () => {
    const s = createRunwayUse()
    const into = end('28R')
    const a = activeRunways(s, ends, T0, { windDirDeg: Math.round(into.bearing), windKt: 12 })
    expect(a.basis).toBe('wind')
    expect(a.favoured).toContain('28R')
    expect(a.favoured.length).toBeLessThanOrEqual(4)
    expect(summariseRunwayUse(a)).toMatch(/^Wind favours .*28R/)
  })

  it('says nothing with calm wind and no traffic', () => {
    const a = activeRunways(createRunwayUse(), ends, T0, { windDirDeg: null, windKt: 0 })
    expect(a.basis).toBe('none')
    expect(summariseRunwayUse(a)).toBeNull()
  })

  it('prefers what the traffic shows over the wind', () => {
    const s = createRunwayUse()
    observeEvents(s, [ev({ runway: '10L' })])
    const a = activeRunways(s, ends, T0, { windDirDeg: Math.round(end('28R').bearing), windKt: 4 })
    expect(a.basis).toBe('traffic')
    expect(a.landing).toEqual(['10L'])
  })
})

describe('runways from the ATIS', () => {
  // Real broadcasts, trimmed.
  const ATL_ARR =
    'ATL ARR INFO M 0752Z. 27004KT 10SM FEW250 09/06 A3014 (THREE ZERO ONE FOUR). SIMUL APCHS ARE IN PROGRESS, VISUAL APPROACH RWY 26L, VISUAL APPROACH RWY 28. NOTAMS... RWY 26R CLSD, RWY 27R CLSD, RWY 27L CLSD. TWY F CLSD BTN TWY, C AND TWY G, TWY G CLSD. IM RWY 27L OTS, IM RWY 28 OTS, DME PORTION OF ILS RWY 26R OTS. CRANE MIDFIELD BETWEEN RWY 9R AND RWY 10 AT 80 FT. OPERATE TRANSPONDER WITH MODE C ON ALL RAMPS, TWYS AND RWYS. ...ADVS YOU HAVE INFO M.'
  const ATL_DEP = 'ATL DEP INFO Z 0752Z. 27004KT 10SM FEW250 09/06 A3014. SIMUL DEPS, DEPG RWYS, 26L, 28. XPECT INITIAL HEADING DEPTG RWY 26L, XPECT INITIAL HEADING DEPTG RWY 28. GROUND CONTROL WILL ASSIGN RUNWAY WITH TAXI INSTRUCTIONS. NOTAMS... RWY 26R CLSD.'
  const ORD =
    'ORD ATIS INFO E 0751Z. 24005KT 10SM FEW250 09/03 A2998. ARR EXP VECTORS ILS RWY 28C APCH. LAND AND HOLD SHORT OPERATIONS ARE IN EFFECT. RWY 28C ARR PLAN TO H/S OF TWY Z, 9 THSD 6 HND TEN FT AVBL. DEPS EXP RWYS 28R. RWY 4L, 22R CLSD, RWY 9L, 27R CLSD. RWY 9L IM OTS, RWY 28C IM OTS, RWY 28R IM OTS.'
  const JFK = 'JFK ATIS INFO Q 0751Z. 31009KT 10SM SCT046 BKN250 10/02 A2999. APPROACH IN USE ILS RY 31L. DEPG RY 31L. RWY 4L, 22R CLSD, RWY 13L, 31R CLSD. RY 31L PAPI OTS. READBACK ALL RWY ASSIGNMENTS AND HOLD SHORT INSTRUCTIONS.'
  const DEN_ARR = 'DEN ARR INFO S 0753Z. 24008KT 10SM CLR 06/M03 A3018. EXPC ILS, RNAV, OR VISUAL APCH, SIMUL APCHS IN USE, RWY 26, EXPECT OFFSET RNAV APPROACH RWY 16R, EXPECT VISUAL APCH RWY 16L, RWY16R ILS NA. TWY G CLSD BTN TWY, WA AND RWY 26 .'
  const DEN_DEP = 'DEN DEP INFO B 0753Z. 24008KT 10SM CLR 06/M03 A3018. DEPG RWY17L, RWY17R. NOTICE TO AIRMEN. TWY G CLSD BTN TWY, WA AND RWY 26 .'

  it('reads split arrival and departure broadcasts', () => {
    expect(runwaysFromAtis([ATL_ARR, ATL_DEP], runwayEnds('ATL'))).toEqual({ landing: ['26L', '28'], departing: ['26L', '28'] })
  })

  it('reads combined broadcasts and ignores closures and outages', () => {
    expect(runwaysFromAtis([ORD], ends)).toEqual({ landing: ['28C'], departing: ['28R'] })
    expect(runwaysFromAtis([JFK], runwayEnds('JFK'))).toEqual({ landing: ['31L'], departing: ['31L'] })
  })

  it('reads lists and runway numbers run together with RWY', () => {
    expect(runwaysFromAtis([DEN_ARR, DEN_DEP], runwayEnds('DEN'))).toEqual({ landing: ['16L', '16R', '26'], departing: ['17L', '17R'] })
  })

  it('keeps only runways the airport has', () => {
    expect(runwaysFromAtis(['DEPG RWY 33X, RWY 99.'], ends)).toEqual({ landing: [], departing: [] })
  })

  it('is used when the traffic says nothing, ahead of the wind', () => {
    const a = activeRunways(createRunwayUse(), ends, T0, { windDirDeg: 100, windKt: 10 }, { landing: ['28C'], departing: ['28R', '28C'] })
    expect(a.basis).toBe('atis')
    expect(a.runways.map((r) => `${r.ident}:${r.role}`)).toEqual(['28C:both', '28R:departures'])
    expect(summariseRunwayUse(a)).toBe('Landing 28C · Departing 28C 28R')
    const s = createRunwayUse()
    observeEvents(s, [ev({ runway: '10L' })])
    expect(activeRunways(s, ends, T0, null, { landing: ['28C'], departing: [] }).landing).toEqual(['10L'])
  })
})

describe('helpers', () => {
  it('sorts designators numerically', () => {
    expect(sortIdents(['27C', '4R', '22L', '4L', '9'])).toEqual(['4L', '4R', '9', '22L', '27C'])
  })

  it('pairs the two ends of each runway', () => {
    const opp = oppositeEnds(ends)
    for (const e of ends) expect(opp.get(opp.get(e.ident)!)).toBe(e.ident)
  })
})
