import { describe, expect, it } from 'vitest'
import type { Aircraft, Metar } from '../api/types'
import type { FlightRole, Step, Timeline } from '../flight/timeline'
import type { HistoryEntry } from '../live/history/store'
import type { ActiveRunways } from '../live/runwayUse'
import type { RunwayEndGeometry } from '../map/airportDiagram'
import { buildBriefing, countTraffic, fallbackBriefing, partOfDay, roundCount } from './briefingModel'
import { buildCatchUp, fallbackCatchUp, radioFor } from './catchUpModel'
import { buildFacts } from './facts'
import { restoreInsightSettings } from './insightSettings'
import { cleanText, parseAlertWhy, parseCatchUp, parseFacts, parseStory, parseSummary, parseTerm } from './parse'
import { buildStoryInput, fallbackStory, storyKey, type StoryData } from './story'
import { buildWeatherInput, fallbackWeather, forecastHeadline, windText, windsOnRunways } from './weatherBrief'

const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16)

/** Runway 27 pointing west from a threshold just east of the field, and its other end 9. */
const ENDS: RunwayEndGeometry[] = [
  { ident: '27', threshold: [0.03, 0], bearing: 270, lengthM: 3000, widthM: 45 },
  { ident: '9', threshold: [0, 0], bearing: 90, lengthM: 3000, widthM: 45 },
]

const metar = (over: Partial<Metar> = {}): Metar => ({
  raw: 'KORD 101851Z 27015G28KT 10SM FEW040 BKN250 12/02 A2992',
  observedAt: '2026-11-10T18:51:00Z',
  windDirDeg: 270,
  windVariable: false,
  windKt: 15,
  gustKt: 28,
  visibilitySm: 10,
  visibilityPlus: true,
  tempC: 12,
  dewpointC: 2,
  altimeterInHg: 29.92,
  flightCategory: 'VFR',
  clouds: [
    { cover: 'FEW', baseFt: 4000 },
    { cover: 'BKN', baseFt: 25000 },
  ],
  weather: null,
  ...over,
})

const NOW = Date.UTC(2026, 10, 10, 19, 0)

const ac = (over: Partial<Aircraft>): Aircraft => ({ icao24: Math.random().toString(16).slice(2, 8), callsign: 'TST1', lat: 0.2, lon: 0.2, heading: 0, altitudeFt: 0, speedKt: 0, onGround: true, ...over })

const active = (landing: string[], departing: string[], basis: ActiveRunways['basis'] = 'traffic'): ActiveRunways => ({ runways: [], landing, departing, favoured: landing, basis })

describe('briefing', () => {
  it('counts traffic by what it is doing', () => {
    const list = [
      ac({ onGround: true, speedKt: 0 }),
      ac({ onGround: true, speedKt: 15 }),
      ac({ onGround: false, altitudeFt: 2000, verticalRateFpm: -800, speedKt: 160 }),
      ac({ onGround: false, altitudeFt: 1500, verticalRateFpm: 2000, speedKt: 180 }),
      ac({ onGround: false, altitudeFt: 36000, verticalRateFpm: 0, speedKt: 460 }),
      ac({ onGround: true, speedKt: 10, category: 'C1' }),
    ]
    expect(countTraffic(list, ENDS, 0)).toEqual({ arriving: 1, departing: 1, taxiing: 1, parked: 1, overflying: 1 })
  })

  it('rounds big counts so nearby asks are identical', () => {
    expect([3, 10, 12, 13, 27].map(roundCount)).toEqual([3, 10, 10, 15, 25])
  })

  it('knows the part of day from the sun', () => {
    // 19:00 UTC at Chicago's longitude is about 13:10 local solar time.
    expect(partOfDay(NOW, -87.9)).toBe('midday')
    expect(partOfDay(NOW, 0)).toBe('evening')
  })

  it('builds the input and a sensible template briefing', () => {
    const aircraft = [
      ...Array.from({ length: 12 }, () => ac({ onGround: false, altitudeFt: 2500, verticalRateFpm: -700, speedKt: 170 })),
      ...Array.from({ length: 8 }, () => ac({ onGround: false, altitudeFt: 2500, verticalRateFpm: 1800, speedKt: 190 })),
      ...Array.from({ length: 6 }, () => ac({ onGround: true, speedKt: 14 })),
    ]
    const events = [{ id: 'g', at: NOW - 4 * 60_000, kind: 'goaround' as const, icao24: 'a', callsign: 'DAL22', runway: '27', text: 'Delta flight 22 went around at runway 27 and is climbing away.', lon: 0, lat: 0 }]
    const input = buildBriefing({
      airport: { icao: 'ORD', name: 'Chicago O’Hare', center: [-87.9, 41.98], elevationFt: 0 },
      aircraft,
      ends: ENDS,
      events,
      runways: active(['27'], ['27']),
      metar: metar(),
      taf: null,
      atis: [],
      now: NOW,
      clock,
    })
    expect(input.traffic).toMatchObject({ arriving: 10, departing: 8, taxiing: 6 })
    expect(input.recent.goArounds).toBe(1)
    expect(input.notable[0]).toBe('Delta flight 22 went around at runway 27 and is climbing away (5 min ago)')
    expect(input.weather?.wind).toBe('270° at 15 kt, gusting 28')
    const text = fallbackBriefing(input)
    expect(text).toMatch(/^Steady traffic midday at ORD: 10 arriving, 8 departing and 6 taxiing\./)
    expect(text).toContain('Landing and departing 27.')
    expect(text).toContain('Wind 270° at 15 kt, gusting 28.')
    expect(text).toContain('Delta flight 22 went around')
    expect(text.split('. ').length).toBeLessThanOrEqual(5)
  })

  it('says it is quiet and that the wind only favours a runway', () => {
    const input = buildBriefing({ airport: { icao: 'YYC', name: 'Calgary', center: [-114, 51.1], elevationFt: 3557 }, aircraft: [], ends: ENDS, events: [], runways: active(['27'], [], 'wind'), metar: null, taf: null, atis: [], now: NOW, clock })
    expect(fallbackBriefing(input)).toBe('Quiet at YYC right now, with nothing moving. The wind favours runway 27.')
  })
})

describe('weather made readable', () => {
  const TAF = 'TAF KORD 101720Z 1018/1124 27015G25KT P6SM BKN250 FM102200 30012KT 2SM -RA BR OVC008 FM110600 31010KT P6SM SCT030'

  it('formats wind', () => {
    expect(windText(metar())).toBe('270° at 15 kt, gusting 28')
    expect(windText(metar({ windKt: 0, gustKt: null }))).toBe('Calm')
    expect(windText(metar({ windDirDeg: 90, windKt: 6, gustKt: null }))).toBe('090° at 6 kt')
  })

  it('finds the forecast change worth mentioning', () => {
    expect(forecastHeadline(TAF, NOW, clock)).toBe('Forecast worsening to IFR from 22:00 (light rain and mist)')
    expect(forecastHeadline(TAF, Date.UTC(2026, 10, 11, 0, 0), clock)).toBe('Forecast improving to VFR from 06:00')
  })

  it('picks the runways in use for crosswind, else the best two', () => {
    const w = metar({ windDirDeg: 180, windKt: 20, gustKt: null })
    expect(windsOnRunways(w, ENDS, active(['27'], []))).toEqual([{ ident: '27', headwindKt: 0, crosswindKt: 20, from: 'left' }])
    expect(windsOnRunways(w, ENDS, null)).toHaveLength(2)
  })

  it('explains impact in plain words', () => {
    const cross = metar({ windDirDeg: 180, windKt: 20, gustKt: 30 })
    const text = fallbackWeather(cross, windsOnRunways(cross, ENDS, active(['27'], [])), null)
    expect(text).toBe('A 20 kt crosswind on 27, enough that pilots will notice. Gusts to 30 kt make for a bumpy final approach.')
    const fog = metar({ flightCategory: 'LIFR', weather: 'FG', visibilitySm: 0.25, clouds: [{ cover: 'VV', baseFt: 100 }], windKt: 3, gustKt: null })
    expect(fallbackWeather(fog, [], 'Forecast improving to VFR from 10:00')).toMatch(/^Fog \(sky obscured at 100 ft\): arrivals need precise instrument approaches.*Forecast improving to VFR from 10:00\.$/)
    const nice = metar({ windKt: 6, gustKt: null })
    expect(fallbackWeather(nice, windsOnRunways(nice, ENDS, active(['27'], [])), null)).toBe('Good flying weather: pilots can see the runway from miles out.')
  })

  it('builds the AI input with local forecast times', () => {
    const input = buildWeatherInput({ airport: 'ORD', metar: metar(), taf: TAF, atis: [{ code: 'D', kind: 'combined', text: 'ORD ATIS INFO D 1851Z. LANDING RWY 27.', updatedAt: null }], active: active(['27'], []), ends: ENDS, now: NOW, clock })
    expect(input?.forecast[0]).toMatchObject({ from: '19:00', to: '22:00', kind: 'forecast' })
    expect(input?.forecast[1]).toMatchObject({ from: '22:00', kind: 'from' })
    expect(input?.forecast[1].text).toMatch(/^IFR, light rain and mist, overcast at 800 ft, wind 300° 12 kt$/)
    expect(input?.winds).toEqual([{ runway: '27', headKt: 15, crossKt: 0 }])
    expect(input?.atis).toMatch(/^Information D:/)
    expect(buildWeatherInput({ airport: 'X', metar: null, taf: null, atis: [], active: null, ends: [], now: NOW })).toBeNull()
  })
})

const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({ id: Math.random().toString(36), source: 'event', airport: 'ORD', stationId: '', at: NOW, durationMs: 0, text: '', callsigns: [], ids: [], speaker: null, ...over })

describe('what did I miss', () => {
  const since = NOW - 30 * 60_000
  const entries: HistoryEntry[] = [
    entry({ at: since + 60_000, eventKind: 'departed', text: 'United flight 1 took off from runway 27.', callsigns: ['UAL1'], ids: ['u1'] }),
    entry({ at: since + 120_000, eventKind: 'landed', text: 'Delta flight 2 landed on runway 27.', callsigns: ['DAL2'], ids: ['d2'] }),
    entry({ at: since + 600_000, eventKind: 'goaround', text: 'American flight 3 went around at runway 27 and is climbing away.', callsigns: ['AAL3'], ids: ['a3'] }),
    entry({ at: since + 590_000, source: 'radio', text: 'American 3 going around, wind shear on final', callsigns: ['AAL3'], ids: ['a3'], speaker: 'pilot' }),
    entry({ at: since + 700_000, source: 'radio', text: 'American 3 roger, fly heading 270', callsigns: ['AAL3'], ids: ['a3'], speaker: 'controller' }),
    entry({ at: since - 60_000, eventKind: 'landed', text: 'Too early', callsigns: ['X'], ids: ['x'] }),
    entry({ at: since + 100, eventKind: 'landed', airport: 'JFK', text: 'Elsewhere', callsigns: ['Y'], ids: ['y'] }),
  ]

  it('prefers the radio call that says why', () => {
    expect(radioFor(entries, ['a3'], ['AAL3'], since + 600_000)?.text).toMatch(/wind shear/)
  })

  it('counts what happened in the window and keeps the notable moments with their radio', () => {
    const { input, moments } = buildCatchUp({ airport: 'ORD', since, until: NOW, entries, alerts: [], runwayLog: [{ at: since + 900_000, landing: ['9'], departing: ['9'], prevLanding: ['27'], prevDeparting: ['27'] }], clock })
    expect(input.awayMin).toBe(30)
    expect(input.counts).toEqual({ takeoffs: 1, landings: 1, goArounds: 1, emergencies: 0, radioCalls: 2 })
    expect(moments).toHaveLength(1)
    expect(input.moments[0]).toMatchObject({ time: '18:40', kind: 'goaround', radio: 'American 3 going around, wind shear on final' })
    expect(input.runwayChanges[0].text).toBe('Runways changed: now landing 9, departing 9 (was landing 27, departing 27)')
    const out = fallbackCatchUp(input)
    expect(out.summary).toBe('In the last 30 minutes at ORD: 1 takeoff and 1 landing, and 1 go-around. 2 radio calls transcribed.')
    expect(out.highlights).toEqual(['18:45 · Runways changed: now landing 9, departing 9 (was landing 27, departing 27)', '18:40 · American flight 3 went around at runway 27 and is climbing away — “American 3 going around, wind shear on final”'])
  })

  it('adds alerts the log does not have, without duplicating', () => {
    const { moments } = buildCatchUp({
      airport: 'ORD',
      since,
      until: NOW,
      entries,
      alerts: [
        { id: '1', kind: 'goaround', at: since + 600_000, icao24: 'a3', callsign: 'AAL3', runway: null, title: '', body: 'dup', source: 'radio', count: 1 },
        { id: '2', kind: 'rto', at: since + 1_200_000, icao24: 'z9', callsign: 'SWA9', runway: '27', title: '', body: 'Southwest flight 9 reached 90 kt on runway 27, then slowed.', source: 'traffic', count: 1 },
      ],
      runwayLog: [],
      clock,
    })
    expect(moments.map((m) => m.kind)).toEqual(['goaround', 'rto'])
  })
})

const step = (key: Step['key'], at: number | null, runway: string | null = null, extra: Partial<Step> = {}): Step => ({ key, at, until: null, approx: false, inProgress: false, state: 'done', runway, altitudeFt: null, ...extra })

const timeline = (role: FlightRole, steps: Step[], current: Step['key'] | null): Timeline => ({ role, steps, wheelsUp: null, touchdown: null, finalRunway: null, current })

describe('flight story', () => {
  const base: StoryData = {
    callsign: 'UAL1534',
    name: 'United flight 1534',
    airline: 'United',
    aircraft: 'Airbus A320',
    from: 'Chicago ORD',
    to: 'Denver DEN',
    airport: 'ORD',
    timeline: timeline('departure', [step('pushback', NOW), step('taxiOut', NOW + 120_000), step('lineUp', NOW + 900_000, '28R'), step('takeoffRoll', NOW + 960_000, '28R'), step('airborne', NOW + 1_000_000, '28R'), step('climb', NOW + 1_010_000, null, { state: 'current' }), step('touchdown', null, null, { state: 'upcoming' })], 'climb'),
    events: [],
    calls: [{ at: NOW + 880_000, speaker: 'controller', text: 'United 1534, runway 28R, line up and wait' }],
    clock,
  }

  it('builds a stable input from the seen phases', () => {
    const input = buildStoryInput(base)
    expect(input.steps.map((s) => s.what)).toEqual(['Pushback', 'Taxi out', 'Line up', 'Takeoff roll', 'Wheels up'])
    expect(input.steps[2]).toEqual({ time: '19:15', what: 'Line up', runway: '28R' })
    expect(input.now).toBe('Climb')
    expect(input.flight).toBe('United flight 1534')
    expect(storyKey(input)).toBe(storyKey(buildStoryInput({ ...base })))
  })

  it('tells it in order without AI', () => {
    expect(fallbackStory(base)).toBe(
      'United flight 1534, an Airbus A320 bound for Denver DEN, pushed back at 19:00, started taxiing at 19:02, lined up on runway 28R at 19:15, began its takeoff roll on 28R at 19:16 and was airborne from 28R at 19:16. It is now climbing. Last heard on the radio at 19:14: “United 1534, runway 28R, line up and wait”',
    )
  })

  it('says something sensible about a flight just spotted', () => {
    const short = { ...base, timeline: timeline('arrival', [step('approach', NOW, '27', { inProgress: true, state: 'current' })], 'approach'), calls: [], from: 'Denver DEN' }
    expect(fallbackStory(short)).toBe('United flight 1534, an Airbus A320 in from Denver DEN, was first seen on final approach at 19:00.')
  })
})

describe('flight facts', () => {
  it('only states what the data supports', () => {
    const facts = buildFacts({
      callsign: 'SKW5432',
      info: { callsign: 'SKW5432', airline: 'SkyWest', origin: { iata: 'ORD', icao: 'KORD', name: 'O’Hare', city: 'Chicago', lat: 41.98, lon: -87.9 }, destination: { iata: 'DEN', icao: 'KDEN', name: 'Denver Intl', city: 'Denver', lat: 39.86, lon: -104.67 }, typeName: null, manufacturer: null, registration: 'N123SY', owner: 'SkyWest Airlines' },
      aircraftTitle: 'Embraer E175',
      typeFacts: { name: 'E175', manufacturer: 'Embraer', kind: 'Regional jet', engines: { count: 2, type: 'turbofan' }, seats: '76–88', firstFlight: 2003 },
      airport: 'ORD',
      history: [entry({ source: 'radio', callsigns: ['SKW5432'], ids: ['abc'] }), entry({ source: 'radio', callsigns: ['SKW5432'], ids: ['abc'] }), entry({ eventKind: 'departed', callsigns: ['SKW5432'], ids: ['abc'] })],
      icao24: 'abc',
      now: NOW + 1000,
    })
    const ids = facts.map((f) => f.id)
    expect(ids).toEqual(expect.arrayContaining(['route', 'typeAge', 'typeSize', 'heard']))
    expect(facts.find((f) => f.id === 'route')?.text).toBe('Chicago (ORD) to Denver (DEN) is about 770 nautical miles (1,430 km) in a straight line.')
    expect(facts.find((f) => f.id === 'typeAge')?.text).toBe('The Embraer E175 first flew in 2003.')
    expect(facts.find((f) => f.id === 'heard')?.text).toBe('SKW5432 has been heard on the radio here 2 times in the last 24 hours, with 1 takeoff or landing logged.')
    // The owner is the operator itself: nothing interesting to say.
    expect(ids).not.toContain('owner')
  })

  it('has nothing to say about an unknown private flight', () => {
    expect(buildFacts({ callsign: 'N123AB', info: null, aircraftTitle: null, typeFacts: null, airport: 'ORD', history: [], icao24: 'x', now: NOW })).toEqual([])
  })
})

describe('insight settings', () => {
  it('restores only known keys and alert kinds', () => {
    expect(restoreInsightSettings({ learn: true, alerts: 'yes', alertKinds: ['goaround', 'bogus'], extra: 1 })).toEqual({ learn: true, alertKinds: ['goaround'] })
    expect(restoreInsightSettings(null)).toEqual({})
  })
})

describe('AI answer checks', () => {
  it('tidies text and refuses the wrong shapes', () => {
    expect(cleanText('  "**Busy** evening at ORD."  ', 100)).toBe('Busy evening at ORD.')
    expect(cleanText('', 100)).toBeNull()
    expect(cleanText('x'.repeat(101), 100)).toBeNull()
    expect(parseSummary(200)({ summary: 'Quiet at JFK.' })).toBe('Quiet at JFK.')
    expect(parseSummary(200)({ text: 'nope' })).toBeNull()
    expect(parseSummary(200)(null)).toBeNull()
    expect(parseStory({ story: 'It left.' })).toBe('It left.')
    expect(parseTerm({ explanation: 'A beacon.', known: true })).toEqual({ explanation: 'A beacon.', known: true })
    expect(parseTerm({ explanation: 'A beacon.' })).toBeNull()
    expect(parseAlertWhy({ why: 'The pilot reported wind shear.', basis: 'radio' })).toEqual({ why: 'The pilot reported wind shear.', basis: 'radio' })
    expect(parseAlertWhy({ why: 'x', basis: 'guess' })).toBeNull()
    expect(parseCatchUp({ summary: 'Quiet.', highlights: ['a', 3, ''] })).toEqual({ summary: 'Quiet.', highlights: ['a'] })
  })

  it('throws away facts the model made up', () => {
    const parse = parseFacts(new Set(['route', 'typeAge']))
    expect(
      parse({
        facts: [
          { id: 'route', text: 'About 770 nm from Chicago to Denver.' },
          { id: 'invented', text: 'This aircraft once carried a president.' },
          { id: 'route', text: 'Again.' },
        ],
      }),
    ).toEqual([{ id: 'route', text: 'About 770 nm from Chicago to Denver.' }])
    expect(parse({ facts: [{ id: 'invented', text: 'x' }] })).toBeNull()
  })
})
