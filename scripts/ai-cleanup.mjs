#!/usr/bin/env node
/**
 * AI data cleanup: reviews the app's hand-kept data tables in bulk and
 * proposes fixes as a reviewable report plus a JSON patch. It never rewrites
 * a file by itself: the owner reads the report, deletes any op they don't
 * want from the patch, then applies it with `--apply`.
 *
 * What it reviews:
 *   airlines   src/airline/airlines.ts      ICAO → IATA code and name, regional brand mapping
 *   telephony  src/live/radio/telephony.ts  radio callsigns ("Brickyard") per ICAO prefix
 *   types      src/aircraft/types.ts        aircraft facts: suspicious numbers
 *   newTypes   types seen in traffic (--seen / --sample) with no entry in the facts table
 *   callsigns  airline-style callsign prefixes seen in traffic that match nothing
 *
 * Providers (same as the app): Claude through the official SDK with
 * ANTHROPIC_API_KEY (the Message Batches API when there are many requests,
 * at half the price), or OpenRouter with OPENROUTER_API_KEY. The default
 * model is the app's default (DEFAULT_CLAUDE_MODEL in src/api/ai/run.ts).
 *
 *   node scripts/ai-cleanup.mjs --dry-run                 what would be sent, no key needed
 *   node scripts/ai-cleanup.mjs --seen seen.json          run, with types/codes copied from Settings > Data and diagnostics
 *   node scripts/ai-cleanup.mjs --sample ORD,JFK          also sample live traffic from the deployed site
 *   node scripts/ai-cleanup.mjs --apply reports/ai-cleanup-2026-11-10.patch.json [--ids a,b]
 *
 * Run with --help for every flag.
 */
/* oxlint-disable no-await-in-loop -- requests, polls and file edits run one at a time on purpose */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(HERE, '..')

export const FILES = {
  airlines: 'src/airline/airlines.ts',
  telephony: 'src/live/radio/telephony.ts',
  types: 'src/aircraft/types.ts',
  ai: 'src/api/ai/run.ts',
}

const MARKERS = {
  AIRLINES: 'const AIRLINES: Record<string, [string, string]> = {',
  FLIES_FOR: 'const FLIES_FOR: Record<string, string | ((n: number) => string | null)> = {',
  TELEPHONY: 'export const TELEPHONY: Record<string, string[]> = {',
  TYPES: 'export const TYPES: Record<string, TypeFacts> = {',
}
const TABLE_FILE = { AIRLINES: FILES.airlines, FLIES_FOR: FILES.airlines, TELEPHONY: FILES.telephony, TYPES: FILES.types }

/** Callsign prefixes of military and state flights: not airlines, never proposed as such. */
const MILITARY_PREFIXES = new Set('RCH CNV PAT SAM SPAR VENUS EXEC NAVY ARMY NATO CFC RRR GAF CTM IAM BAF'.split(' '))

const HELP = `AI data cleanup for atc-web: proposes fixes, never rewrites silently.

Usage: node scripts/ai-cleanup.mjs [options]

  --dry-run              Show what would be sent (no key needed, nothing written)
  --only <list>          airlines,telephony,types,newTypes,callsigns (default: all)
  --seen <file>          Traffic seen in the app: Settings > Data and diagnostics > Copy, or a saved
                         /api/aircraft response. Repeatable.
  --sample <codes>       Fetch live traffic for these airports (e.g. ORD,JFK) from --base
  --base <url>           Site to sample from (default https://atc-web-62t.pages.dev)
  --model <id>           Model (default: the app's default Claude model)
  --provider <p>         anthropic | openrouter (default: whichever key is set, Claude first)
  --chunk <n>            Items per request (default 40)
  --batch / --no-batch   Force or forbid the Message Batches API (Claude only;
                         default: batches when there are more than 3 requests)
  --resume-batch <id>    Collect the results of an earlier batch instead of sending
  --poll <seconds>       Batch polling interval (default 30)
  --out <dir>            Where reports go (default reports/)
  --root <dir>           Repository root to read (default: this repository)
  --apply <patch.json>   Apply a reviewed patch to the source files
  --ids <list>           With --apply: only these op ids
  --verbose              With --dry-run: print every prompt in full
  --help
`

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const o = { dryRun: false, only: null, seen: [], sample: [], base: 'https://atc-web-62t.pages.dev', model: null, provider: null, chunk: 40, batch: null, resumeBatch: null, poll: 30, out: 'reports', root: null, apply: null, ids: null, verbose: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v == null || v.startsWith('--')) throw new Error(`${a} needs a value`)
      return v
    }
    if (a === '--dry-run') o.dryRun = true
    else if (a === '--only') o.only = next().split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--seen') o.seen.push(next())
    else if (a === '--sample') o.sample.push(...next().split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))
    else if (a === '--base') o.base = next().replace(/\/+$/, '')
    else if (a === '--model') o.model = next()
    else if (a === '--provider') o.provider = next()
    else if (a === '--chunk') o.chunk = Math.max(5, Math.min(200, Number(next()) || 40))
    else if (a === '--batch') o.batch = true
    else if (a === '--no-batch') o.batch = false
    else if (a === '--resume-batch') o.resumeBatch = next()
    else if (a === '--poll') o.poll = Math.max(5, Number(next()) || 30)
    else if (a === '--out') o.out = next()
    else if (a === '--root') o.root = next()
    else if (a === '--apply') o.apply = next()
    else if (a === '--ids') o.ids = next().split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--verbose') o.verbose = true
    else if (a === '--help' || a === '-h') o.help = true
    else throw new Error(`Unknown option ${a} (see --help)`)
  }
  if (o.provider && o.provider !== 'anthropic' && o.provider !== 'openrouter') throw new Error('--provider is anthropic or openrouter')
  return o
}

// ---------------------------------------------------------------------------
// Reading the tables straight from the TypeScript sources
// ---------------------------------------------------------------------------

/** The lines of one `X = { ... }` table: [first line after the marker, closing line). */
export function tableSpan(lines, marker) {
  const start = lines.findIndex((l) => l.startsWith(marker))
  if (start < 0) throw new Error(`Table not found: ${marker}`)
  const end = lines.findIndex((l, i) => i > start && /^}\s*$/.test(l))
  if (end < 0) throw new Error(`Table not closed: ${marker}`)
  return { start: start + 1, end }
}

/** Helpers and constants the facts table is written with, so its literal can be evaluated as plain JS. */
const TYPE_SCOPE = {
  jet: (n) => ({ count: n, type: 'turbofan' }),
  prop: (n) => ({ count: n, type: 'turboprop' }),
  piston: (n) => ({ count: n, type: 'piston' }),
  shaft: (n) => ({ count: n, type: 'turboshaft' }),
  NARROW: 'Narrow-body airliner',
  WIDE: 'Wide-body airliner',
  REGIONAL: 'Regional jet',
  BIZ: 'Business jet',
  TPROP: 'Turboprop airliner',
}

/** Evaluate a table literal from the repository's own source (trusted input). */
function evalLiteral(body, scope = {}) {
  const names = Object.keys(scope)
  return new Function(...names, `"use strict"; return ({${body}\n})`)(...names.map((n) => scope[n]))
}

export async function loadTables(root) {
  const read = async (f) => (await readFile(path.join(root, f), 'utf8')).split('\n')
  const airlinesSrc = await read(FILES.airlines)
  const telephonySrc = await read(FILES.telephony)
  const typesSrc = await read(FILES.types)
  const body = (lines, marker) => {
    const { start, end } = tableSpan(lines, marker)
    return lines.slice(start, end).join('\n')
  }
  const airlines = evalLiteral(body(airlinesSrc, MARKERS.AIRLINES))
  const fliesRaw = evalLiteral(body(airlinesSrc, MARKERS.FLIES_FOR))
  const fliesFor = Object.fromEntries(Object.entries(fliesRaw).map(([k, v]) => [k, typeof v === 'function' ? `by flight number: ${String(v).replace(/\s+/g, ' ')}` : v]))
  const telephony = evalLiteral(body(telephonySrc, MARKERS.TELEPHONY))
  const types = evalLiteral(body(typesSrc, MARKERS.TYPES), TYPE_SCOPE)
  return { airlines, fliesFor, telephony, types }
}

/** The app's default model and OpenRouter names, read from src/api/ai/run.ts so there is one source of truth. */
export async function loadModelDefaults(root) {
  try {
    const src = await readFile(path.join(root, FILES.ai), 'utf8')
    const def = /DEFAULT_CLAUDE_MODEL = '([^']+)'/.exec(src)?.[1] ?? null
    const map = {}
    for (const m of src.matchAll(/'([\w.-]+)': '(anthropic\/[\w.-]+)'/g)) map[m[1]] = m[2]
    return { defaultModel: def, openrouter: map }
  } catch {
    return { defaultModel: null, openrouter: {} }
  }
}

// ---------------------------------------------------------------------------
// What the app has seen in traffic
// ---------------------------------------------------------------------------

const prefixOf = (callsign) => /^([A-Z]{3})\d[A-Z0-9]{0,4}$/.exec(String(callsign ?? '').trim().toUpperCase())?.[1] ?? null

/** Merge any of the accepted shapes into `{ types: Map<code,count>, prefixes: Map<prefix,{count,example}> }`. */
export function mergeSeen(docs) {
  const types = new Map()
  const prefixes = new Map()
  const addType = (code, n = 1) => {
    const c = String(code ?? '').trim().toUpperCase()
    if (/^[A-Z0-9]{2,4}$/.test(c) && c !== 'ZZZZ') types.set(c, (types.get(c) ?? 0) + n)
  }
  const addPrefix = (p, n = 1, example = null) => {
    if (!p || MILITARY_PREFIXES.has(p)) return
    const prev = prefixes.get(p)
    prefixes.set(p, { count: (prev?.count ?? 0) + n, example: prev?.example ?? example })
  }
  const visit = (d) => {
    if (!d || typeof d !== 'object') return
    if (Array.isArray(d)) return d.forEach(visit)
    if (Array.isArray(d.types)) for (const t of d.types) addType(t.code ?? t, t.count ?? 1)
    if (Array.isArray(d.prefixes)) for (const p of d.prefixes) addPrefix(String(p.prefix ?? '').toUpperCase(), p.count ?? 1, p.example ?? null)
    if (Array.isArray(d.callsigns)) for (const c of d.callsigns) addPrefix(prefixOf(c), 1, String(c).toUpperCase())
    if (Array.isArray(d.aircraft)) {
      for (const a of d.aircraft) {
        if (a?.type) addType(a.type)
        const p = prefixOf(a?.callsign)
        if (p) addPrefix(p, 1, String(a.callsign).trim().toUpperCase())
      }
    }
  }
  docs.forEach(visit)
  return { types, prefixes }
}

/** Keep only what the tables can't name. */
export function unknownSeen(seen, tables) {
  const types = [...seen.types].filter(([c]) => !tables.types[c]).sort((a, b) => b[1] - a[1])
  const prefixes = [...seen.prefixes].filter(([p]) => !tables.airlines[p] && !tables.telephony[p]).sort((a, b) => b[1].count - a[1].count)
  return { types, prefixes }
}

// ---------------------------------------------------------------------------
// Checks that need no AI
// ---------------------------------------------------------------------------

export function localChecks(tables, unknown, year = new Date().getFullYear()) {
  const out = []
  const add = (kind, key, message) => out.push({ kind, key, message })
  const byIata = new Map()
  for (const [icao, [iata, name]] of Object.entries(tables.airlines)) {
    if (!/^[A-Z]{3}$/.test(icao)) add('airlines', icao, 'ICAO airline code should be three letters')
    if (iata && !/^[A-Z0-9]{2}$/.test(iata)) add('airlines', icao, `IATA code "${iata}" should be two letters or digits`)
    if (!name?.trim()) add('airlines', icao, 'has no name')
    if (iata) byIata.set(iata, [...(byIata.get(iata) ?? []), icao])
  }
  for (const [iata, list] of byIata) if (list.length > 1) add('airlines', list.join(', '), `share the IATA code ${iata}`)
  for (const [op, brand] of Object.entries(tables.fliesFor)) {
    if (!tables.airlines[op]) add('airlines', op, 'flies for a brand but has no airline entry of its own')
    if (!brand.startsWith('by flight number') && !tables.airlines[brand]) add('airlines', op, `flies for ${brand}, which has no airline entry`)
  }
  const spoken = new Map()
  for (const [icao, names] of Object.entries(tables.telephony)) {
    if (!names.length) add('telephony', icao, 'has no spoken name')
    for (const n of names) {
      const k = n.toLowerCase().replace(/[\s-]+/g, '')
      if (spoken.has(k) && spoken.get(k) !== icao) add('telephony', `${spoken.get(k)}, ${icao}`, `both answer to "${n}"`)
      spoken.set(k, icao)
    }
  }
  for (const [code, f] of Object.entries(tables.types)) {
    if (!f.name || !f.manufacturer || !f.kind) add('types', code, 'is missing its name, manufacturer or kind')
    if (!(f.engines?.count >= 1 && f.engines.count <= 8)) add('types', code, `engine count ${f.engines?.count} looks wrong`)
    if (f.spanM != null && (f.spanM < 5 || f.spanM > 90)) add('types', code, `wingspan ${f.spanM} m looks wrong`)
    if (f.lengthM != null && (f.lengthM < 5 || f.lengthM > 90)) add('types', code, `length ${f.lengthM} m looks wrong`)
    if (f.rangeNm != null && (f.rangeNm < 100 || f.rangeNm > 9000)) add('types', code, `range ${f.rangeNm} nm looks wrong`)
    if (f.firstFlight != null && (f.firstFlight < 1900 || f.firstFlight > year)) add('types', code, `first flight ${f.firstFlight} looks wrong`)
    if (f.cruise && 'mach' in f.cruise && !(f.cruise.mach > 0.3 && f.cruise.mach < 1)) add('types', code, `cruise Mach ${f.cruise.mach} looks wrong`)
    if (f.spanM != null && f.lengthM != null && (f.spanM / f.lengthM > 2.5 || f.lengthM / f.spanM > 3)) add('types', code, `span ${f.spanM} m against length ${f.lengthM} m looks swapped or wrong`)
  }
  for (const [code, n] of unknown.types) add('newTypes', code, `seen ${n}× in traffic, no facts entry`)
  for (const [p, v] of unknown.prefixes) add('callsigns', p, `seen ${v.count}× (e.g. ${v.example ?? p}), no airline or radio name`)
  return out
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const SYSTEM = [
  'You review reference data used by a web app that shows live airport traffic and air traffic control radio in North America.',
  'You get one batch of entries of a single kind and report only the entries that need a change, with a short reason each.',
  'Use well-established public facts only: ICAO/IATA airline designators, ICAO radiotelephony designators, manufacturers’ published aircraft specifications.',
  'If you are not sure, say so with confidence "low" rather than guessing; leave an entry out if it looks right.',
  'Never propose anything about private individuals or who owns an aircraft; callsign prefixes here are airline-style codes only.',
  'Answer with the JSON requested and nothing else.',
].join('\n')

const nullable = (t) => ({ anyOf: [{ type: t }, { type: 'null' }] })
const CONF = { type: 'string', enum: ['high', 'medium', 'low'] }
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const list = (item) => obj({ issues: { type: 'array', items: obj(item) } })

export const SCHEMAS = {
  airlines: list({ key: { type: 'string' }, problem: { type: 'string', enum: ['wrong-iata', 'wrong-name', 'wrong-brand', 'not-an-airline', 'other'] }, proposedIata: nullable('string'), proposedName: nullable('string'), proposedBrand: nullable('string'), reason: { type: 'string' }, confidence: CONF }),
  telephony: list({ key: { type: 'string' }, problem: { type: 'string', enum: ['wrong-official', 'missing-variant', 'wrong-airline', 'other'] }, proposedSpoken: { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] }, reason: { type: 'string' }, confidence: CONF }),
  types: list({ key: { type: 'string' }, field: { type: 'string', enum: ['name', 'manufacturer', 'kind', 'engines', 'spanM', 'lengthM', 'seats', 'rangeNm', 'cruise', 'firstFlight'] }, current: { type: 'string' }, proposed: { type: 'string' }, reason: { type: 'string' }, confidence: CONF }),
  newTypes: list({ key: { type: 'string' }, known: { type: 'boolean' }, name: { type: 'string' }, manufacturer: { type: 'string' }, kind: { type: 'string' }, engineCount: { type: 'integer' }, engineType: { type: 'string', enum: ['turbofan', 'turboprop', 'piston', 'turboshaft'] }, spanM: nullable('number'), lengthM: nullable('number'), seats: nullable('string'), rangeNm: nullable('integer'), firstFlight: nullable('integer'), reason: { type: 'string' }, confidence: CONF }),
  callsigns: list({ key: { type: 'string' }, known: { type: 'boolean' }, iata: nullable('string'), name: nullable('string'), telephony: nullable('string'), reason: { type: 'string' }, confidence: CONF }),
}

const INSTRUCTIONS = {
  airlines: 'Airline table: ICAO code → [IATA code, everyday name], and "fliesFor" = the mainline brand a regional operator flies for. Report wrong IATA codes, wrong or outdated names (use the name passengers know, e.g. "Delta"), wrong brand mappings, and codes that are not airlines. Use problem "wrong-brand" with proposedBrand as the ICAO code of the right brand.',
  telephony: 'Radio callsigns: ICAO prefix → spoken names, the official ICAO telephony designator first, then common variants speech recognition may produce. Report a wrong or outdated official designator, an entry under the wrong prefix, or an important missing variant. proposedSpoken is the full new list, official first.',
  types: 'Aircraft facts by ICAO type designator (span and length in metres, range in nautical miles, cruise as Mach for jets or knots, first flight year of the model). Report only figures that are clearly wrong against the manufacturer’s published specifications; current and proposed are the values as plain text (engines as "2 × turbofan", cruise as "Mach 0.78" or "360 kt", a number for numeric fields).',
  newTypes: 'ICAO aircraft type designators seen in traffic that our facts table lacks. For each, if you know the type, give its facts (manufacturer’s published figures, rounded; null where it varies a lot or you are unsure); set known false for designators you cannot identify. kind is a short description like "Business jet", "Narrow-body airliner", "Light helicopter".',
  callsigns: 'Airline-style callsign prefixes (three-letter ICAO operator designators) seen in traffic that match nothing in our airline table. For each, if it is an assigned ICAO airline designator you know, give the IATA code (or null), the everyday name and the official radio telephony designator; set known false otherwise. These are companies, never private individuals.',
}

function chunks(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

/** Items to review per kind, in the compact shape the prompt shows. */
export function reviewItems(tables, unknown) {
  return {
    airlines: Object.entries(tables.airlines).map(([icao, [iata, name]]) => {
      const row = { icao, iata: iata || null, name }
      if (tables.fliesFor[icao]) row.fliesFor = tables.fliesFor[icao]
      return row
    }),
    telephony: Object.entries(tables.telephony).map(([icao, spoken]) => ({ icao, airline: tables.airlines[icao]?.[1] ?? null, spoken })),
    types: Object.entries(tables.types).map(([code, f]) => Object.assign({ code }, f)),
    newTypes: unknown.types.map(([code, count]) => ({ code, seen: count })),
    callsigns: unknown.prefixes.map(([prefix, v]) => ({ prefix, seen: v.count, example: v.example })),
  }
}

export const KINDS = ['airlines', 'telephony', 'types', 'newTypes', 'callsigns']

export function buildRequests(tables, unknown, { only = null, chunk = 40 } = {}) {
  const items = reviewItems(tables, unknown)
  const reqs = []
  for (const kind of KINDS) {
    if (only && !only.includes(kind)) continue
    chunks(items[kind], chunk).forEach((part, i) => {
      reqs.push({
        id: `${kind}-${i + 1}`,
        kind,
        count: part.length,
        keys: part.map((x) => x.icao ?? x.code ?? x.prefix),
        system: SYSTEM,
        prompt: `${INSTRUCTIONS[kind]}\n\nEntries (JSON lines):\n${part.map((x) => JSON.stringify(x)).join('\n')}\n\nReport the entries that need a change.`,
        schema: SCHEMAS[kind],
      })
    })
  }
  return reqs
}

// ---------------------------------------------------------------------------
// Calling the model
// ---------------------------------------------------------------------------

export function pickProvider(opts, env = process.env) {
  if (opts.provider === 'openrouter') return env.OPENROUTER_API_KEY ? 'openrouter' : null
  if (opts.provider === 'anthropic') return env.ANTHROPIC_API_KEY ? 'anthropic' : null
  return env.ANTHROPIC_API_KEY ? 'anthropic' : env.OPENROUTER_API_KEY ? 'openrouter' : null
}

function claudeParams(model, r) {
  return {
    model,
    max_tokens: 16000,
    system: [{ type: 'text', text: r.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: r.prompt }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: r.schema } },
  }
}

const textOf = (message) => message.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim()

function parseAnswer(text) {
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
  } catch {
    return null
  }
}

async function sdk() {
  const mod = await import('@anthropic-ai/sdk')
  return mod.default
}

async function runClaudeDirect(reqs, model, log) {
  const Anthropic = await sdk()
  const client = new Anthropic({ maxRetries: 2, timeout: 300_000 })
  const out = {}
  for (const r of reqs) {
    log(`  ${r.id}: ${r.count} entries…`)
    try {
      const msg = await client.messages.create(claudeParams(model, r))
      out[r.id] = msg.stop_reason === 'refusal' ? { error: 'refused' } : { json: parseAnswer(textOf(msg)) }
    } catch (err) {
      out[r.id] = { error: err instanceof Error ? err.message : String(err) }
    }
  }
  return out
}

async function runClaudeBatch(reqs, model, opts, log) {
  const Anthropic = await sdk()
  const client = new Anthropic()
  let id = opts.resumeBatch
  if (!id) {
    const batch = await client.messages.batches.create({ requests: reqs.map((r) => ({ custom_id: r.id, params: claudeParams(model, r) })) })
    id = batch.id
    log(`Batch ${id} created (${reqs.length} requests). If this stops, collect it later with --resume-batch ${id}`)
  }
  for (;;) {
    const b = await client.messages.batches.retrieve(id)
    if (b.processing_status === 'ended') break
    log(`  batch ${b.processing_status}: ${b.request_counts.processing} processing, ${b.request_counts.succeeded} done`)
    await new Promise((res) => setTimeout(res, opts.poll * 1000))
  }
  const out = {}
  for await (const r of await client.messages.batches.results(id)) {
    if (r.result.type === 'succeeded') out[r.custom_id] = r.result.message.stop_reason === 'refusal' ? { error: 'refused' } : { json: parseAnswer(textOf(r.result.message)) }
    else out[r.custom_id] = { error: r.result.type === 'errored' ? `errored: ${r.result.error?.error?.type ?? r.result.error?.type ?? 'unknown'}` : r.result.type }
  }
  return out
}

async function runOpenRouter(reqs, model, log) {
  const out = {}
  for (const r of reqs) {
    log(`  ${r.id}: ${r.count} entries…`)
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'x-title': 'atc-web data cleanup' },
        body: JSON.stringify({
          model,
          max_tokens: 16000,
          messages: [
            { role: 'system', content: r.system },
            { role: 'user', content: r.prompt },
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'review', strict: true, schema: r.schema } },
        }),
      })
      if (!res.ok) throw new Error(`OpenRouter ${res.status}`)
      const data = await res.json()
      out[r.id] = { json: parseAnswer(String(data.choices?.[0]?.message?.content ?? '')) }
    } catch (err) {
      out[r.id] = { error: err instanceof Error ? err.message : String(err) }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Answers → patch ops
// ---------------------------------------------------------------------------

const ENGINE_FN = { turbofan: 'jet', turboprop: 'prop', piston: 'piston', turboshaft: 'shaft' }
const KIND_CONST = Object.fromEntries(Object.entries(TYPE_SCOPE).filter(([, v]) => typeof v === 'string').map(([k, v]) => [v, k]))

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const num = (n) => (Number.isInteger(n) ? `${n}.0` : String(n))

/** One table row in the file's own style. */
export function serializeRow(table, key, value) {
  if (table === 'AIRLINES') return `  ${key}: [${q(value[0] ?? '')}, ${q(value[1])}],`
  if (table === 'TELEPHONY') return `  ${key}: [${value.map(q).join(', ')}],`
  if (table === 'TYPES') {
    const f = value
    const parts = [`name: ${q(f.name)}`, `manufacturer: ${q(f.manufacturer)}`, `kind: ${KIND_CONST[f.kind] ?? q(f.kind)}`, `engines: ${ENGINE_FN[f.engines.type]}(${f.engines.count})`]
    if (f.spanM != null) parts.push(`spanM: ${num(f.spanM)}`)
    if (f.lengthM != null) parts.push(`lengthM: ${num(f.lengthM)}`)
    if (f.seats != null) parts.push(`seats: ${q(f.seats)}`)
    if (f.rangeNm != null) parts.push(`rangeNm: ${Math.round(f.rangeNm)}`)
    if (f.cruise) parts.push('mach' in f.cruise ? `cruise: { mach: ${f.cruise.mach} }` : `cruise: { kt: ${f.cruise.kt} }`)
    if (f.firstFlight != null) parts.push(`firstFlight: ${f.firstFlight}`)
    return `  ${key}: { ${parts.join(', ')} },`
  }
  throw new Error(`Unknown table ${table}`)
}

/** Turn a plain-text value from the review into the field's real type; null when it can't be read. */
export function parseFieldValue(field, text) {
  const t = String(text ?? '').trim()
  if (['spanM', 'lengthM'].includes(field)) return Number.isFinite(Number.parseFloat(t)) ? Math.round(Number.parseFloat(t) * 10) / 10 : null
  if (['rangeNm', 'firstFlight'].includes(field)) return /^\d+/.test(t.replace(/,/g, '')) ? Number.parseInt(t.replace(/,/g, ''), 10) : null
  if (field === 'engines') {
    const m = /(\d+)\s*[×x*]\s*(turbofan|turboprop|piston|turboshaft)/i.exec(t)
    return m ? { count: Number(m[1]), type: m[2].toLowerCase() } : null
  }
  if (field === 'cruise') {
    const mach = /mach\s*(0?\.\d+)/i.exec(t)
    if (mach) return { mach: Number(mach[1]) }
    const kt = /(\d+)\s*(kt|knots)/i.exec(t)
    return kt ? { kt: Number(kt[1]) } : null
  }
  return t || null
}

const okConf = (c) => c === 'high' || c === 'medium'

/**
 * Patch ops from the answers. Low-confidence findings, and ones that need a
 * human (brand rules, "not an airline"), go to `manual` instead.
 */
export function toOps(answers, reqs, tables) {
  const ops = []
  const manual = []
  const kindOf = Object.fromEntries(reqs.map((r) => [r.id, r]))
  for (const [id, a] of Object.entries(answers)) {
    const req = kindOf[id]
    if (!req || !a?.json?.issues) continue
    for (const it of a.json.issues) {
      if (!req.keys.includes(it.key)) continue
      // "Don't know this one" is not a finding.
      if ((req.kind === 'newTypes' || req.kind === 'callsigns') && !it.known) continue
      const base = { kind: req.kind, key: it.key, reason: it.reason, confidence: it.confidence }
      if (!okConf(it.confidence)) {
        manual.push({ ...base, note: 'low confidence', detail: it })
        continue
      }
      if (req.kind === 'airlines') {
        const cur = tables.airlines[it.key]
        if (it.problem === 'wrong-iata' || it.problem === 'wrong-name') {
          const value = [it.proposedIata ?? cur[0], it.proposedName ?? cur[1]]
          if (value[0] !== cur[0] || value[1] !== cur[1]) ops.push({ ...base, id: `airlines:${it.key}`, file: FILES.airlines, table: 'AIRLINES', action: 'set', value, before: cur })
        } else manual.push({ ...base, note: it.problem, detail: it })
      } else if (req.kind === 'telephony') {
        if (Array.isArray(it.proposedSpoken) && it.proposedSpoken.length) ops.push({ ...base, id: `telephony:${it.key}`, file: FILES.telephony, table: 'TELEPHONY', action: 'set', value: it.proposedSpoken, before: tables.telephony[it.key] })
        else manual.push({ ...base, note: it.problem, detail: it })
      } else if (req.kind === 'types') {
        const v = parseFieldValue(it.field, it.proposed)
        if (v == null) manual.push({ ...base, note: `unreadable ${it.field}`, detail: it })
        else ops.push({ ...base, id: `types:${it.key}:${it.field}`, file: FILES.types, table: 'TYPES', action: 'set', field: it.field, value: v, before: tables.types[it.key]?.[it.field] ?? null })
      } else if (req.kind === 'newTypes') {
        const value = { name: it.name, manufacturer: it.manufacturer, kind: it.kind, engines: { count: it.engineCount, type: it.engineType }, spanM: it.spanM, lengthM: it.lengthM, seats: it.seats, rangeNm: it.rangeNm, firstFlight: it.firstFlight }
        ops.push({ ...base, id: `types:${it.key}:add`, file: FILES.types, table: 'TYPES', action: 'add', value })
      } else if (req.kind === 'callsigns') {
        if (!it.name) continue
        ops.push({ ...base, id: `airlines:${it.key}:add`, file: FILES.airlines, table: 'AIRLINES', action: 'add', value: [it.iata ?? '', it.name] })
        if (it.telephony) ops.push({ ...base, id: `telephony:${it.key}:add`, file: FILES.telephony, table: 'TELEPHONY', action: 'add', value: [it.telephony] })
      }
    }
  }
  return { ops, manual }
}

/** The line an op would write, for the report. */
export function opLine(op, tables) {
  if (op.table === 'TYPES' && op.action === 'set') return serializeRow('TYPES', op.key, { ...tables.types[op.key], [op.field]: op.value })
  return serializeRow(op.table, op.key, op.value)
}

// ---------------------------------------------------------------------------
// Applying a reviewed patch
// ---------------------------------------------------------------------------

const ADDED = '  // Added by scripts/ai-cleanup.mjs: review before shipping.'

export async function applyPatch(root, patch, ids = null) {
  const applied = []
  const skipped = []
  const files = new Map()
  const lines = async (f) => {
    if (!files.has(f)) files.set(f, (await readFile(path.join(root, f), 'utf8')).split('\n'))
    return files.get(f)
  }
  for (const op of patch.ops ?? []) {
    if (ids && !ids.includes(op.id)) continue
    const marker = MARKERS[op.table]
    if (!marker || TABLE_FILE[op.table] !== op.file) {
      skipped.push({ id: op.id, why: 'unknown table' })
      continue
    }
    const L = await lines(op.file)
    const { start, end } = tableSpan(L, marker)
    const re = new RegExp(`^\\s*'?${op.key}'?: `)
    const at = L.slice(start, end).findIndex((l) => re.test(l))
    if (op.action === 'add') {
      if (at >= 0) {
        skipped.push({ id: op.id, why: 'already present' })
        continue
      }
      const insert = [serializeRow(op.table, op.key, op.value)]
      if (!L.slice(start, end).includes(ADDED)) insert.unshift(ADDED)
      L.splice(end, 0, ...insert)
    } else {
      if (at < 0) {
        skipped.push({ id: op.id, why: 'not found' })
        continue
      }
      let value = op.value
      if (op.table === 'TYPES') {
        const cur = evalLiteral(L[start + at], TYPE_SCOPE)[op.key]
        value = { ...cur, [op.field]: op.value }
      }
      L[start + at] = serializeRow(op.table, op.key, value)
    }
    applied.push(op.id)
  }
  for (const [f, L] of files) await writeFile(path.join(root, f), L.join('\n'))
  return { applied, skipped }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export function renderReport({ date, model, provider, mode, reqs, local, ops, manual, failures, tables, patchFile }) {
  const md = []
  md.push(`# Data cleanup report, ${date}`, '')
  md.push(`Model: \`${model}\` via ${provider} (${mode}). ${reqs.length} requests, ${reqs.reduce((n, r) => n + r.count, 0)} entries reviewed.`, '')
  md.push('Nothing has been changed. Review the proposals, delete any op you disagree with from the patch file, then:', '')
  md.push('```bash', `node scripts/ai-cleanup.mjs --apply ${patchFile}`, '```', '')
  md.push(`## Checks without AI (${local.length})`, '')
  if (!local.length) md.push('None.', '')
  else {
    md.push('| Table | Entry | Finding |', '| --- | --- | --- |')
    for (const f of local) md.push(`| ${f.kind} | ${f.key} | ${f.message.replace(/\|/g, '/')} |`)
    md.push('')
  }
  md.push(`## Proposed changes (${ops.length})`, '')
  for (const kind of KINDS) {
    const mine = ops.filter((o) => o.kind === kind)
    if (!mine.length) continue
    md.push(`### ${kind}`, '')
    for (const o of mine) {
      md.push(`- **${o.id}** (${o.confidence}): ${o.reason}`, '', '  ```diff')
      if (o.action === 'set') {
        const before = o.table === 'TYPES' ? serializeRow('TYPES', o.key, tables.types[o.key]) : serializeRow(o.table, o.key, o.before)
        md.push(`  -${before}`)
      }
      md.push(`  +${opLine(o, tables)}`, '  ```', '')
    }
  }
  if (manual.length) {
    md.push(`## For a person to decide (${manual.length})`, '')
    for (const m of manual) md.push(`- **${m.kind} ${m.key}** (${m.note}, ${m.confidence}): ${m.reason}`)
    md.push('')
  }
  if (failures.length) {
    md.push(`## Requests that failed (${failures.length})`, '')
    for (const f of failures) md.push(`- ${f.id}: ${f.error}`)
    md.push('')
  }
  return md.join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(argv, { log = console.log, env = process.env, fetchFn = fetch } = {}) {
  const opts = parseArgs(argv)
  if (opts.help) {
    log(HELP)
    return 0
  }
  const root = path.resolve(opts.root ?? REPO_ROOT)

  if (opts.apply) {
    const patch = JSON.parse(await readFile(path.resolve(opts.apply), 'utf8'))
    const { applied, skipped } = await applyPatch(root, patch, opts.ids)
    log(`Applied ${applied.length} change(s)${applied.length ? `: ${applied.join(', ')}` : ''}.`)
    for (const s of skipped) log(`  skipped ${s.id}: ${s.why}`)
    if (applied.length) log('Run npx tsc -b --noEmit and npx vitest run src/aircraft src/airline src/live/radio before committing.')
    return 0
  }

  const tables = await loadTables(root)
  const docs = []
  for (const f of opts.seen) docs.push(JSON.parse(await readFile(path.resolve(f), 'utf8')))
  for (const code of opts.sample) {
    try {
      const res = await fetchFn(`${opts.base}/api/aircraft?airport=${encodeURIComponent(code)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      docs.push(await res.json())
    } catch (err) {
      log(`Could not sample ${code}: ${err instanceof Error ? err.message : err}`)
    }
  }
  const unknown = unknownSeen(mergeSeen(docs), tables)
  const local = localChecks(tables, unknown)
  const reqs = buildRequests(tables, unknown, { only: opts.only, chunk: opts.chunk })
  const defaults = await loadModelDefaults(root)
  const model = opts.model ?? defaults.defaultModel
  if (!model) throw new Error('Could not read the default model from src/api/ai/run.ts; pass --model.')
  const provider = pickProvider(opts, env)
  const useBatch = provider === 'anthropic' && (opts.resumeBatch != null || (opts.batch ?? reqs.length > 3))

  if (opts.dryRun) {
    log(`Dry run: nothing is sent and nothing is written.`)
    log(`Tables: ${Object.keys(tables.airlines).length} airlines, ${Object.keys(tables.telephony).length} radio names, ${Object.keys(tables.types).length} aircraft types.`)
    log(`Seen in traffic and unknown: ${unknown.types.length} types, ${unknown.prefixes.length} callsign prefixes.`)
    log(`Checks without AI: ${local.length} finding(s).`)
    for (const f of local.slice(0, 30)) log(`  [${f.kind}] ${f.key}: ${f.message}`)
    log(`Would send ${reqs.length} request(s) to ${provider ?? 'no provider (no key set)'} with model ${model}${provider === 'anthropic' ? (useBatch ? ', as one Message Batch' : ', one by one') : ''}:`)
    for (const r of reqs) log(`  ${r.id}: ${r.count} entries, ${r.prompt.length.toLocaleString('en-US')} characters`)
    const show = opts.verbose ? reqs : reqs.slice(0, 1)
    for (const r of show) {
      log(`\n--- ${r.id} system ---\n${r.system}\n--- ${r.id} prompt ---\n${r.prompt}\n--- ${r.id} schema ---\n${JSON.stringify(r.schema)}`)
    }
    return 0
  }

  if (!provider) {
    log('No key: set ANTHROPIC_API_KEY or OPENROUTER_API_KEY (or use --dry-run).')
    return 1
  }
  if (!reqs.length) {
    log('Nothing to review.')
    return 0
  }
  const runModel = provider === 'openrouter' ? (defaults.openrouter[model] ?? (model.includes('/') ? model : `anthropic/${model}`)) : model
  log(`Reviewing ${reqs.reduce((n, r) => n + r.count, 0)} entries in ${reqs.length} request(s) with ${runModel} on ${provider}${useBatch ? ' (Message Batches)' : ''}…`)
  const answers = provider === 'openrouter' ? await runOpenRouter(reqs, runModel, log) : useBatch ? await runClaudeBatch(reqs, runModel, opts, log) : await runClaudeDirect(reqs, runModel, log)
  const failures = Object.entries(answers).filter(([, a]) => a.error || !a.json).map(([id, a]) => ({ id, error: a.error ?? 'no JSON in the answer' }))
  const { ops, manual } = toOps(answers, reqs, tables)

  const date = new Date().toISOString().slice(0, 10)
  const outDir = path.resolve(root, opts.out)
  await mkdir(outDir, { recursive: true })
  let stem = `ai-cleanup-${date}`
  for (let n = 2; existsSync(path.join(outDir, `${stem}.md`)); n++) stem = `ai-cleanup-${date}-${n}`
  const patchFile = path.relative(root, path.join(outDir, `${stem}.patch.json`))
  await writeFile(path.join(outDir, `${stem}.patch.json`), JSON.stringify({ version: 1, generated: new Date().toISOString(), model: runModel, provider, ops }, null, 2))
  await writeFile(path.join(outDir, `${stem}.md`), renderReport({ date, model: runModel, provider, mode: useBatch ? 'batch' : 'direct', reqs, local, ops, manual, failures, tables, patchFile }))
  log(`Wrote ${path.relative(root, path.join(outDir, `${stem}.md`))} and ${patchFile}: ${ops.length} proposed change(s), ${manual.length} for a person, ${failures.length} failed request(s).`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(1)
    },
  )
}
