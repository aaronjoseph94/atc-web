import { describe, expect, it } from 'vitest'
import { TASKS } from '../tasks'
import { RADIO_CLEANUP_MAX_INPUT, RADIO_CLEANUP_SCHEMA, radioCleanup, radioCleanupPrompt, type RadioCleanupInput } from './radioCleanup'

const input: RadioCleanupInput = {
  text: 'delta two eight eight runway three one left line up and wait',
  station: { airport: 'JFK', name: 'New York JFK', role: 'TWR', label: 'Tower (Rwy 4L-22R)', mhz: 119.1 },
  recent: [
    { speaker: 'pilot', text: 'Kennedy Tower, Delta 288, holding short 31L' },
    { speaker: 'atc', text: 'JetBlue 1407, runway 31L, cleared for takeoff' },
  ],
  traffic: ['DAL288 (Delta 288)', 'JBU1407 (JetBlue 1407)'],
  runways: ['4L', '22R', '31L', '13R'],
  taxiways: ['A', 'B', 'K', 'KA'],
  guess: { speaker: 'atc', callsigns: ['DAL288'] },
}

type Obj = { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean }

/** Every object in a schema lists all its properties as required and allows nothing else (structured outputs need both). */
function checkStrict(node: unknown, path = '$'): string[] {
  if (!node || typeof node !== 'object') return []
  const n = node as Partial<Obj> & { type?: string; items?: unknown }
  const out: string[] = []
  if (n.type === 'object') {
    const keys = Object.keys(n.properties ?? {})
    if (n.additionalProperties !== false) out.push(`${path}: additionalProperties`)
    if ([...keys].sort().join() !== [...(n.required ?? [])].sort().join()) out.push(`${path}: required`)
    for (const k of keys) out.push(...checkStrict(n.properties![k], `${path}.${k}`))
  }
  if (n.items) out.push(...checkStrict(n.items, `${path}[]`))
  return out
}

describe('radioCleanup task', () => {
  it('is registered and set up for one quick request per call', () => {
    expect(TASKS.radioCleanup).toBe(radioCleanup)
    expect(radioCleanup.effort).toBe('low')
    expect(radioCleanup.cacheS).toBe(0)
    expect(radioCleanup.maxTokens).toBeGreaterThanOrEqual(2000)
    expect(radioCleanup.maxInputChars).toBe(RADIO_CLEANUP_MAX_INPUT)
  })

  it('has a strict schema', () => {
    expect(checkStrict(RADIO_CLEANUP_SCHEMA)).toEqual([])
  })

  it('keeps per-request data out of the cached instructions', () => {
    expect(radioCleanup.system).not.toMatch(/Kennedy|Rwy 4L|Call as heard/)
  })

  it('builds the prompt from the call and its context', () => {
    const p = radioCleanupPrompt(input)
    expect(p).toContain('Airport: JFK (New York JFK)')
    expect(p).toContain('Position: TWR, Tower (Rwy 4L-22R), 119.1')
    expect(p).toContain('Runways: 4L, 22R, 31L, 13R')
    expect(p).toContain('Taxiways: A, B, K, KA')
    expect(p).toContain('Traffic nearby: DAL288 (Delta 288); JBU1407 (JetBlue 1407)')
    expect(p).toContain('- [pilot] Kennedy Tower, Delta 288, holding short 31L')
    expect(p).toContain('Rule-based guess: speaker atc, callsigns DAL288')
    expect(p.trim().endsWith('Call as heard: "delta two eight eight runway three one left line up and wait"')).toBe(true)
  })

  it('copes with thin or odd input, and refuses a call with no words', () => {
    const p = radioCleanupPrompt({ text: '  roger  ', station: { airport: 'ORD', name: '', role: '', label: '', mhz: null }, recent: [], traffic: [], runways: [], taxiways: [], guess: { speaker: 'unknown', callsigns: [] } })
    expect(p).toContain('Position: TWR')
    expect(p).not.toContain('Runways:')
    expect(p).toContain('Call as heard: "roger"')
    expect(() => radioCleanupPrompt({ ...input, text: '   ' })).toThrow()
    expect(() => radioCleanupPrompt(null as unknown as RadioCleanupInput)).toThrow()
  })

  it('clips long context', () => {
    const p = radioCleanupPrompt({ ...input, recent: Array.from({ length: 9 }, (_, i) => ({ speaker: 'atc' as const, text: `call ${i} ${'x'.repeat(400)}` })) })
    expect(p.match(/^- \[atc\]/gm)).toHaveLength(5)
    expect(p).not.toContain('call 3 ')
    expect(p.split('\n').every((l) => l.length < 700)).toBe(true)
  })
})
