import { describe, expect, it } from 'vitest'
import { TASKS } from '../tasks'
import { airportBriefing, type BriefingInput } from './airportBriefing'
import { catchUp } from './catchUp'
import { explainAlert } from './explainAlert'
import { explainTerm } from './explainTerm'
import { flightFacts } from './flightFacts'
import { flightStory } from './flightStory'
import { weatherBrief } from './weatherBrief'

const NEW = [airportBriefing, catchUp, explainAlert, explainTerm, flightFacts, flightStory, weatherBrief]

/** Every object in a schema must list all its properties as required and allow nothing else (structured outputs). */
function checkSchema(s: Record<string, unknown>, path = 'root') {
  if (s.type === 'object') {
    const props = Object.keys(s.properties as object)
    expect(s.additionalProperties, path).toBe(false)
    expect([...(s.required as string[])].sort(), path).toEqual(props.sort())
    for (const [k, v] of Object.entries(s.properties as Record<string, Record<string, unknown>>)) checkSchema(v, `${path}.${k}`)
  }
  if (s.type === 'array') checkSchema(s.items as Record<string, unknown>, `${path}[]`)
}

describe('insight AI tasks', () => {
  it('are registered under their names', () => {
    for (const t of NEW) expect(TASKS[t.name]).toBe(t)
  })

  it('have strict schemas, room to think, and cache as intended', () => {
    for (const t of NEW) {
      checkSchema(t.schema!)
      expect(t.maxTokens, t.name).toBeGreaterThanOrEqual(2000)
      expect(t.effort, t.name).toBe('low')
    }
    expect(explainTerm.cacheS).toBe(30 * 86_400)
    expect(airportBriefing.cacheS).toBe(600)
    expect(weatherBrief.cacheS).toBe(900)
    expect(flightStory.cacheS).toBeLessThanOrEqual(300)
  })

  it('tell the model not to invent anything', () => {
    for (const t of NEW) expect(t.system, t.name).toMatch(/never invent|only the|ONLY|never add/i)
  })

  it('build prompts from realistic input, and reject input missing what they need', () => {
    expect(explainTerm.prompt({ term: '  localizer  ' })).toBe('Term: "localizer"')
    expect(() => explainTerm.prompt({ term: '' })).toThrow(/term/)

    const brief: BriefingInput = {
      airport: 'ORD',
      name: 'Chicago O’Hare',
      partOfDay: 'evening',
      traffic: { arriving: 15, departing: 10, taxiing: 20, parked: 80, overflying: 3 },
      recent: { windowMin: 20, landings: 15, takeoffs: 10, goArounds: 1, emergencies: 0 },
      runways: { landing: ['28C', '27R'], departing: ['28R', '22L'], basis: 'traffic' },
      weather: { category: 'VFR', wind: '270° at 18 kt, gusting 27', visibility: '10+ mi', sky: 'Few clouds at 4,000 ft', weather: null, crosswind: '12 kt on 22L' },
      forecast: null,
      atis: null,
      notable: ['Delta flight 22 went around at runway 27R (5 min ago)'],
    }
    const p = airportBriefing.prompt(brief)
    expect(p).toContain('Airport: ORD (Chicago O’Hare)')
    expect(p).toContain('On the map now: 15 arriving, 10 departing, 20 taxiing, 80 parked, 3 passing overhead')
    expect(p).toContain('Landing runways: 28C, 27R')
    expect(p).toContain('Notable recent events: Delta flight 22 went around')
    // Missing optional data is left out, not printed as "null".
    expect(p).not.toMatch(/null|undefined/)
    expect(() => airportBriefing.prompt({ ...brief, airport: '' })).toThrow()

    const story = flightStory.prompt({ callsign: 'UAL1534', flight: 'United flight 1534', airline: 'United', aircraft: 'Airbus A320', from: 'Chicago ORD', to: 'Denver DEN', airport: 'ORD', role: 'departure', steps: [{ time: '19:15', what: 'Line up', runway: '28R' }], events: [], radio: [{ time: '19:14', speaker: 'controller', text: 'United 1534, runway 28R, line up and wait' }], now: 'Climb' })
    expect(story).toContain('- 19:15 Line up (runway 28R)')
    expect(story).toContain('controller: "United 1534, runway 28R, line up and wait"')
    expect(story).not.toContain('Tower log')

    expect(() => flightFacts.prompt({ callsign: 'UAL1', facts: [] })).toThrow(/No facts/)
    expect(flightFacts.prompt({ callsign: 'UAL1', facts: [{ id: 'route', text: 'Chicago to Denver is about 770 nm.' }] })).toContain('- [route] Chicago to Denver is about 770 nm.')

    const alert = explainAlert.prompt({ kind: 'goaround', title: 'Go-around: Delta flight 22', detail: 'went around at 27R', callsign: 'DAL22', aircraft: null, runway: '27R', radio: [], weather: 'wind 270° at 18 kt, gusting 30' })
    expect(alert).toContain('Radio calls: none transcribed')
    expect(alert).toContain('Weather: wind 270°')

    const wx = weatherBrief.prompt({ airport: 'SFO', metar: 'KSFO 101556Z 00000KT 1/4SM FG VV002 11/11 A3002', decoded: { category: 'LIFR', wind: 'Calm', visibility: '1/4 mi', sky: 'Sky obscured at 200 ft', weather: 'Fog', temperature: '11°C' }, forecast: [{ from: '10:00', to: '14:00', kind: 'from', text: 'VFR, scattered clouds at 1,500 ft' }], atis: null, runways: ['28L', '28R'], winds: [] })
    expect(wx).toContain("Forecast periods (viewer's local time):\n- 10:00–14:00 from: VFR")

    const cu = catchUp.prompt({ airport: 'ORD', awayMin: 42, counts: { takeoffs: 20, landings: 18, goArounds: 1, emergencies: 0, radioCalls: 80 }, moments: [{ time: '18:40', kind: 'goaround', text: 'American flight 3 went around', radio: 'going around, wind shear' }], runwayChanges: [] })
    expect(cu).toContain('Away for: 42 minutes')
    expect(cu).toContain('(radio: "going around, wind shear")')
  })

  it('caps oversized fields instead of passing them through', () => {
    const p = explainAlert.prompt({ kind: 'emergency', title: 'x'.repeat(500), detail: '', callsign: null, aircraft: null, runway: null, radio: Array.from({ length: 50 }, (_, i) => ({ time: `${i}`, speaker: 'pilot', text: 'y'.repeat(1000) })), weather: null })
    expect(p.length).toBeLessThan(2500)
  })
})
