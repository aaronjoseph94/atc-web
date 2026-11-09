/**
 * Pulls public-domain airport data from OurAirports and writes a compact
 * JSON file for the airports in our catalog:
 *   - voice frequencies (Tower, Ground, Approach, Departure, ATIS, Clearance)
 *   - runways with threshold coordinates and true headings
 *
 * Run `npm run data:airports` whenever you want to refresh. The output is
 * committed so builds are reproducible and need no network access.
 *
 * Source + terms: https://ourairports.com/data/ (public domain).
 */
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'https://davidmegginson.github.io/ourairports-data'
const OUT = path.resolve('src/api/airportData.json')

/** Our IATA codes → OurAirports ident (ICAO). */
const IDENTS = {
  ATL: 'KATL', LAX: 'KLAX', DFW: 'KDFW', DEN: 'KDEN', ORD: 'KORD', JFK: 'KJFK',
  MCO: 'KMCO', LAS: 'KLAS', CLT: 'KCLT', MIA: 'KMIA', SEA: 'KSEA', EWR: 'KEWR',
  SFO: 'KSFO', PHX: 'KPHX', IAH: 'KIAH', LGA: 'KLGA',
  YYZ: 'CYYZ', YVR: 'CYVR', YUL: 'CYUL', YYC: 'CYYC', YEG: 'CYEG',
}
const WANTED_FREQ_TYPES = new Set(['TWR', 'GND', 'APP', 'DEP', 'ATIS', 'CLD', 'ARR'])

/** Minimal RFC-4180 CSV parser (handles quoted fields with commas). */
function parseCsv(text) {
  const rows = []
  let row = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') inQ = false
      else field += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const [header, ...body] = rows
  return body.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])))
}

async function csv(name) {
  const res = await fetch(`${BASE}/${name}`)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  return parseCsv(await res.text())
}

const num = (v) => (v === '' || v == null ? null : Number(v))

const [freqs, runways] = await Promise.all([csv('airport-frequencies.csv'), csv('runways.csv')])
const byIdent = Object.fromEntries(Object.entries(IDENTS).map(([iata, icao]) => [icao, iata]))

const out = {}
for (const iata of Object.keys(IDENTS)) out[iata] = { icao: IDENTS[iata], frequencies: [], runways: [] }

for (const f of freqs) {
  const iata = byIdent[f.airport_ident]
  if (!iata || !WANTED_FREQ_TYPES.has(f.type)) continue
  const mhz = num(f.frequency_mhz)
  if (mhz == null || mhz < 108 || mhz > 137) continue // VHF airband only (skip UHF military)
  out[iata].frequencies.push({ type: f.type, description: f.description || f.type, mhz })
}

for (const r of runways) {
  const iata = byIdent[r.airport_ident]
  if (!iata || r.closed === '1') continue
  const le = { ident: r.le_ident, lat: num(r.le_latitude_deg), lon: num(r.le_longitude_deg), hdg: num(r.le_heading_degT) }
  const he = { ident: r.he_ident, lat: num(r.he_latitude_deg), lon: num(r.he_longitude_deg), hdg: num(r.he_heading_degT) }
  if (le.lat == null || he.lat == null || !le.ident || !he.ident) continue
  // Skip helipads / waterways
  if (/^H/.test(le.ident) || r.surface === 'WATER') continue
  out[iata].runways.push({ lengthFt: num(r.length_ft), widthFt: num(r.width_ft), le, he })
}

for (const a of Object.values(out)) {
  a.frequencies.sort((x, y) => x.type.localeCompare(y.type) || x.mhz - y.mhz)
  a.runways.sort((x, y) => x.le.ident.localeCompare(y.le.ident))
}

fs.writeFileSync(
  OUT,
  JSON.stringify({ source: 'OurAirports (public domain) — https://ourairports.com/data/', fetchedAt: new Date().toISOString().slice(0, 10), airports: out }, null, 2) + '\n',
)
console.log(`wrote ${OUT}: ${Object.keys(out).length} airports, ${Object.values(out).reduce((n, a) => n + a.runways.length, 0)} runways`)
