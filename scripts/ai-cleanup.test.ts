/**
 * The data-cleanup script on a small fixture repository: reading the tables
 * out of TypeScript, the dry run (no key), turning model answers into a
 * patch, the report, and applying the patch in the files' own style.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyPatch, buildRequests, loadTables, localChecks, main, mergeSeen, parseArgs, parseFieldValue, renderReport, serializeRow, toOps, unknownSeen } from './ai-cleanup.mjs'

const AIRLINES = `export type AirlineInfo = { icao: string; iata: string | null; name: string }

const AIRLINES: Record<string, [string, string]> = {
  // United States
  DAL: ['DL', 'Delta'],
  EDV: ['9E', 'Endeavor'],
  FFT: ['F9', 'Frontier Airlines Inc'],
  XAA: ['DL', 'Duplicate'],
}

const FLIES_FOR: Record<string, string | ((n: number) => string | null)> = {
  EDV: 'DAL',
  RPA: (n) => (n >= 5000 ? 'DAL' : null),
}
`

const TELEPHONY = `export const TELEPHONY: Record<string, string[]> = {
  DAL: ['Delta'],
  EDV: ['Endeavor', 'Endeavour'],
  FFT: ['Frontier Flight', 'Frontier'],
}

export function telephonyKey(s: string) {
  return s
}
`

const TYPES = `import type { ShapeId } from './shapes'

const jet = (n: number) => ({ count: n, type: 'turbofan' as const })
const NARROW = 'Narrow-body airliner'

export const TYPES: Record<string, TypeFacts> = {
  B738: { name: '737-800', manufacturer: 'Boeing', kind: NARROW, engines: jet(2), spanM: 35.8, lengthM: 39.5, seats: '162–189', rangeNm: 2900, cruise: { mach: 0.785 }, firstFlight: 1997 },
  A320: { name: 'A320', manufacturer: 'Airbus', kind: NARROW, engines: jet(2), spanM: 37.6, lengthM: 35.8, firstFlight: 2087 },
}
`

const RUN = `export const DEFAULT_CLAUDE_MODEL = 'model-under-test'
export const OPENROUTER_MODEL_FOR: Record<string, string> = {
  'model-under-test': 'anthropic/model-under-test',
}
`

const SEEN = {
  kind: 'atc-web-seen',
  types: [
    { code: 'B738', count: 4 },
    { code: 'E35L', count: 2 },
  ],
  prefixes: [
    { prefix: 'QQQ', count: 3, example: 'QQQ12' },
    { prefix: 'RCH', count: 1, example: 'RCH871' },
  ],
}

let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ai-cleanup-'))
  const put = async (rel: string, text: string) => {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true })
    await writeFile(path.join(root, rel), text)
  }
  await put('src/airline/airlines.ts', AIRLINES)
  await put('src/live/radio/telephony.ts', TELEPHONY)
  await put('src/aircraft/types.ts', TYPES)
  await put('src/api/ai/run.ts', RUN)
  await put('seen.json', JSON.stringify(SEEN))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('reading the tables', () => {
  it('evaluates the literals straight from the TypeScript files', async () => {
    const t = await loadTables(root)
    expect(t.airlines.DAL).toEqual(['DL', 'Delta'])
    expect(t.fliesFor.EDV).toBe('DAL')
    expect(t.fliesFor.RPA).toMatch(/^by flight number: /)
    expect(t.telephony.EDV).toEqual(['Endeavor', 'Endeavour'])
    expect(t.types.B738.engines).toEqual({ count: 2, type: 'turbofan' })
    expect(t.types.B738.kind).toBe('Narrow-body airliner')
  })

  it('serialises a row exactly as the file writes it', async () => {
    const t = await loadTables(root)
    expect(serializeRow('TYPES', 'B738', t.types.B738)).toBe(TYPES.split('\n').find((l) => l.includes('B738:')))
    expect(serializeRow('AIRLINES', 'DAL', t.airlines.DAL)).toBe("  DAL: ['DL', 'Delta'],")
    expect(serializeRow('TELEPHONY', 'EDV', ["O'Hare", 'X'])).toBe("  EDV: ['O\\'Hare', 'X'],")
  })
})

describe('checks without AI', () => {
  it('finds duplicate codes, impossible figures and unknown traffic, skipping military callsigns', async () => {
    const t = await loadTables(root)
    const unknown = unknownSeen(mergeSeen([SEEN, { aircraft: [{ callsign: 'ZZZ9', type: 'E35L' }, { callsign: 'N123AB', type: 'C172' }] }]), t)
    expect(unknown.types.map(([c]) => c)).toEqual(['E35L', 'C172'])
    expect(unknown.prefixes.map(([p]) => p)).toEqual(['QQQ', 'ZZZ'])
    const found = localChecks(t, unknown, 2026).map((f) => `${f.kind} ${f.key}: ${f.message}`)
    expect(found).toContain('airlines DAL, XAA: share the IATA code DL')
    expect(found).toContain('airlines RPA: flies for a brand but has no airline entry of its own')
    expect(found).toContain('types A320: first flight 2087 looks wrong')
    expect(found.some((f) => f.startsWith('callsigns QQQ'))).toBe(true)
  })
})

describe('dry run', () => {
  it('works without a key and shows what would be sent', async () => {
    const out: string[] = []
    const code = await main(['--dry-run', '--root', root, '--seen', path.join(root, 'seen.json'), '--chunk', '5'], { log: (s: string) => out.push(s), env: {} })
    expect(code).toBe(0)
    const text = out.join('\n')
    expect(text).toContain('Tables: 4 airlines, 3 radio names, 2 aircraft types.')
    expect(text).toContain('Seen in traffic and unknown: 1 types, 1 callsign prefixes.')
    expect(text).toContain('to no provider (no key set) with model model-under-test')
    expect(text).toMatch(/airlines-1: 4 entries/)
    expect(text).toMatch(/newTypes-1: 1 entries/)
    expect(text).toMatch(/callsigns-1: 1 entries/)
    expect(text).toContain('--- airlines-1 prompt ---')
    expect(text).toContain('{"icao":"EDV","iata":"9E","name":"Endeavor","fliesFor":"DAL"}')
    // Nothing written.
    await expect(readFile(path.join(root, 'reports', 'x'), 'utf8')).rejects.toThrow()
  })

  it('says it would batch on Claude when there are many requests', async () => {
    const out: string[] = []
    await main(['--dry-run', '--root', root, '--chunk', '5'], { log: (s: string) => out.push(s), env: { ANTHROPIC_API_KEY: 'x' } })
    expect(out.join('\n')).toContain('anthropic with model model-under-test, one by one')
    const out2: string[] = []
    await main(['--dry-run', '--root', root, '--chunk', '5', '--batch'], { log: (s: string) => out2.push(s), env: { ANTHROPIC_API_KEY: 'x' } })
    expect(out2.join('\n')).toContain('as one Message Batch')
  })

  it('refuses a real run without a key', async () => {
    const out: string[] = []
    expect(await main(['--root', root], { log: (s: string) => out.push(s), env: {} })).toBe(1)
    expect(out.join('\n')).toContain('No key')
  })

  it('reads its flags', () => {
    expect(parseArgs(['--only', 'airlines,types', '--model', 'm', '--no-batch', '--sample', 'ord,jfk'])).toMatchObject({ only: ['airlines', 'types'], model: 'm', batch: false, sample: ['ORD', 'JFK'] })
    expect(() => parseArgs(['--bogus'])).toThrow()
    expect(() => parseArgs(['--model'])).toThrow()
  })
})

describe('answers to patch to files', () => {
  it('turns confident findings into ops, the rest into notes for a person, and applies them', async () => {
    const t = await loadTables(root)
    const unknown = unknownSeen(mergeSeen([SEEN]), t)
    const reqs = buildRequests(t, unknown, { chunk: 40 })
    const answers = {
      'airlines-1': { json: { issues: [
        { key: 'FFT', problem: 'wrong-name', proposedIata: null, proposedName: 'Frontier', proposedBrand: null, reason: 'Everyday name', confidence: 'high' },
        { key: 'XAA', problem: 'not-an-airline', proposedIata: null, proposedName: null, proposedBrand: null, reason: 'Not assigned', confidence: 'medium' },
        { key: 'NOPE', problem: 'wrong-name', proposedIata: null, proposedName: 'x', proposedBrand: null, reason: 'not asked about', confidence: 'high' },
      ] } },
      'telephony-1': { json: { issues: [{ key: 'DAL', problem: 'missing-variant', proposedSpoken: ['Delta', 'Delta Air'], reason: 'variant', confidence: 'low' }] } },
      'types-1': { json: { issues: [
        { key: 'A320', field: 'firstFlight', current: '2087', proposed: '1987', reason: 'Typo', confidence: 'high' },
        { key: 'A320', field: 'spanM', current: '37.6', proposed: '35.8 m', reason: 'Span and length swapped', confidence: 'high' },
      ] } },
      'newTypes-1': { json: { issues: [{ key: 'E35L', known: true, name: 'Legacy 600/650', manufacturer: 'Embraer', kind: 'Business jet', engineCount: 2, engineType: 'turbofan', spanM: 21.2, lengthM: 26.3, seats: 'up to 14', rangeNm: null, firstFlight: 2001, reason: 'Known type', confidence: 'high' }] } },
      'callsigns-1': { json: { issues: [{ key: 'QQQ', known: false, iata: null, name: null, telephony: null, reason: 'Unknown', confidence: 'low' }] } },
    }
    const { ops, manual } = toOps(answers, reqs, t)
    expect(ops.map((o: { id: string }) => o.id)).toEqual(['airlines:FFT', 'types:A320:firstFlight', 'types:A320:spanM', 'types:E35L:add'])
    expect(manual.map((m: { key: string; note: string }) => `${m.key} ${m.note}`)).toEqual(['XAA not-an-airline', 'DAL low confidence'])

    const report = renderReport({ date: '2026-11-10', model: 'm', provider: 'anthropic', mode: 'batch', reqs, local: [], ops, manual, failures: [{ id: 'types-2', error: 'expired' }], tables: t, patchFile: 'reports/p.json' })
    expect(report).toContain("  -  FFT: ['F9', 'Frontier Airlines Inc'],")
    expect(report).toContain("  +  FFT: ['F9', 'Frontier'],")
    expect(report).toContain('firstFlight: 1987')
    expect(report).toContain('For a person to decide (2)')
    expect(report).toContain('types-2: expired')

    const res = await applyPatch(root, { ops })
    expect(res).toEqual({ applied: ['airlines:FFT', 'types:A320:firstFlight', 'types:A320:spanM', 'types:E35L:add'], skipped: [] })
    const airlines = await readFile(path.join(root, 'src/airline/airlines.ts'), 'utf8')
    expect(airlines).toContain("  FFT: ['F9', 'Frontier'],")
    const types = await readFile(path.join(root, 'src/aircraft/types.ts'), 'utf8')
    expect(types).toContain("  A320: { name: 'A320', manufacturer: 'Airbus', kind: NARROW, engines: jet(2), spanM: 35.8, lengthM: 35.8, firstFlight: 1987 },")
    expect(types).toContain('// Added by scripts/ai-cleanup.mjs')
    expect(types).toContain("  E35L: { name: 'Legacy 600/650', manufacturer: 'Embraer', kind: BIZ, engines: jet(2), spanM: 21.2, lengthM: 26.3, seats: 'up to 14', firstFlight: 2001 },")
    // Still a valid table.
    expect(Object.keys((await loadTables(root)).types)).toEqual(['B738', 'A320', 'E35L'])
    // Applying twice adds nothing twice.
    const again = await applyPatch(root, { ops: ops.filter((o: { action: string }) => o.action === 'add') })
    expect(again.skipped).toEqual([{ id: 'types:E35L:add', why: 'already present' }])
  })

  it('reads plain-text values for each field', () => {
    expect(parseFieldValue('engines', '4 × turbofan')).toEqual({ count: 4, type: 'turbofan' })
    expect(parseFieldValue('cruise', 'Mach 0.85')).toEqual({ mach: 0.85 })
    expect(parseFieldValue('cruise', '360 kt')).toEqual({ kt: 360 })
    expect(parseFieldValue('rangeNm', '7,370 nm')).toBe(7370)
    expect(parseFieldValue('spanM', 'about')).toBeNull()
  })
})
