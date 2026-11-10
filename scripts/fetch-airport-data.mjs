/**
 * Pulls public-domain airport data from OurAirports and writes a compact
 * JSON file for the airports in our catalog:
 *   - reference point and field elevation
 *   - voice frequencies (Tower, Ground, Approach, Departure, ATIS, Clearance)
 *   - runways with threshold coordinates, true headings, surface and
 *     displaced-threshold distances (used to paint the runway markings)
 *
 * US airports are then overlaid with the FAA's 28-day NASR subscription
 * (public domain), which is the authoritative source:
 *   - surveyed runway end points, lengths and displaced thresholds;
 *   - the full controller-position list: one tower frequency per runway, each
 *     ground sector, approach and departure sectors, clearance and ATIS.
 * OurAirports carries one frequency per type and can lag on runway changes.
 *
 * Run `npm run data:airports` whenever you want to refresh. The output is
 * committed so builds are reproducible and need no network access.
 *
 * Sources + terms: https://ourairports.com/data/ (public domain),
 * https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/ (US government work).
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const BASE = 'https://davidmegginson.github.io/ourairports-data'
const OUT = path.resolve('src/api/airportData.json')

/** Our IATA codes → OurAirports ident (ICAO). */
const IDENTS = {
  ATL: 'KATL', LAX: 'KLAX', DFW: 'KDFW', DEN: 'KDEN', ORD: 'KORD', JFK: 'KJFK',
  MCO: 'KMCO', LAS: 'KLAS', CLT: 'KCLT', MIA: 'KMIA', SEA: 'KSEA', EWR: 'KEWR',
  SFO: 'KSFO', PHX: 'KPHX', IAH: 'KIAH', LGA: 'KLGA',
  BOS: 'KBOS', MSP: 'KMSP', DTW: 'KDTW', PHL: 'KPHL', SLC: 'KSLC', DCA: 'KDCA',
  IAD: 'KIAD', SAN: 'KSAN', FLL: 'KFLL', MDW: 'KMDW', PDX: 'KPDX', AUS: 'KAUS', BNA: 'KBNA',
  YYZ: 'CYYZ', YVR: 'CYVR', YUL: 'CYUL', YYC: 'CYYC', YEG: 'CYEG',
  YOW: 'CYOW', YWG: 'CYWG', YHZ: 'CYHZ',
}
const WANTED_FREQ_TYPES = new Set(['TWR', 'GND', 'APP', 'DEP', 'ATIS', 'CLD', 'ARR'])
/** Plain names for OurAirports' terse type codes (used where the FAA list doesn't reach). */
const OA_NAME = { TWR: 'Tower', GND: 'Ground', APP: 'Approach', ARR: 'Arrival', DEP: 'Departure', ATIS: 'Airport information', CLD: 'Clearance delivery' }

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

const [airports, freqs, runways] = await Promise.all([
  csv('airports.csv'),
  csv('airport-frequencies.csv'),
  csv('runways.csv'),
])
const byIdent = Object.fromEntries(Object.entries(IDENTS).map(([iata, icao]) => [icao, iata]))

const out = {}
for (const iata of Object.keys(IDENTS)) out[iata] = { icao: IDENTS[iata], lat: null, lon: null, elevationFt: null, frequencies: [], runways: [] }

for (const a of airports) {
  const iata = byIdent[a.ident]
  if (!iata) continue
  out[iata].lat = num(a.latitude_deg)
  out[iata].lon = num(a.longitude_deg)
  out[iata].elevationFt = num(a.elevation_ft)
}

for (const f of freqs) {
  const iata = byIdent[f.airport_ident]
  if (!iata || !WANTED_FREQ_TYPES.has(f.type)) continue
  const mhz = num(f.frequency_mhz)
  if (mhz == null || mhz < 108 || mhz > 137) continue // VHF airband only (skip UHF military)
  out[iata].frequencies.push({ type: f.type === 'ARR' ? 'APP' : f.type, description: OA_NAME[f.type] ?? f.description ?? f.type, mhz, primary: true })
}

for (const r of runways) {
  const iata = byIdent[r.airport_ident]
  if (!iata || r.closed === '1') continue
  const le = { ident: r.le_ident, lat: num(r.le_latitude_deg), lon: num(r.le_longitude_deg), hdg: num(r.le_heading_degT), displacedFt: num(r.le_displaced_threshold_ft) ?? 0 }
  const he = { ident: r.he_ident, lat: num(r.he_latitude_deg), lon: num(r.he_longitude_deg), hdg: num(r.he_heading_degT), displacedFt: num(r.he_displaced_threshold_ft) ?? 0 }
  if (le.lat == null || he.lat == null || !le.ident || !he.ident) continue
  // Skip helipads / waterways
  if (/^H/.test(le.ident) || r.surface === 'WATER') continue
  out[iata].runways.push({ lengthFt: num(r.length_ft), widthFt: num(r.width_ft), surface: r.surface || null, le, he })
}

// ---------------------------------------------------------------------------
// FAA NASR frequencies (US airports)
// ---------------------------------------------------------------------------

/** Effective date of the NASR cycle in force today (28-day AIRAC cadence). */
function currentCycle(now = new Date()) {
  const anchor = Date.UTC(2025, 0, 23) // AIRAC 2501
  const cycles = Math.floor((now.getTime() - anchor) / (28 * 86400000))
  return new Date(anchor + cycles * 28 * 86400000)
}

/** Read one file out of a zip archive (stored or deflated entries only). */
function unzipEntry(buf, wanted) {
  let eocd = buf.length - 22
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--
  if (eocd < 0) throw new Error('not a zip archive')
  let p = buf.readUInt32LE(eocd + 16)
  const n = buf.readUInt16LE(eocd + 10)
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    if (name === wanted) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const data = buf.subarray(start, start + size)
      return method === 0 ? data : zlib.inflateRawSync(data)
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  throw new Error(`${wanted} not in archive`)
}

const title = (s) =>
  s
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bRwy\b/gi, 'Rwy')
    // Runway designators keep their capitals: "10l-28r" → "10L-28R"
    .replace(/\b(\d{1,2})([lcr])\b/gi, (_, n, l) => `${n}${l.toUpperCase()}`)

/** "RWY 10L/28R" → "Rwy 10L-28R"; "150-219 SOUTH" → "South (150°–219°)". */
function sectorName(sector) {
  const s = (sector ?? '').trim()
  if (!s) return ''
  const rwy = /^RWYS? (.+)$/i.exec(s)
  // "RWY 1L/19R, RWY 12/30" lists several runways; only the first keeps the word.
  if (rwy) return `Rwy ${rwy[1].replace(/\bRWYS?\s+/gi, '').replace(/\//g, '-').replace(/\b0(\d[LCR]?)\b/g, '$1')}`
  const arc = /^(\d{3})-(\d{3})(?: (.+))?$/.exec(s)
  if (arc) return arc[3] ? `${title(arc[3])} (${arc[1]}°–${arc[2]}°)` : `${arc[1]}°–${arc[2]}°`
  return title(s.replace(/^TWR /i, ''))
}

/** FAA `FREQ_USE` → our group + a readable position name. `null` = not a position we list. */
function classify(use, sector) {
  const u = use.toUpperCase().trim()
  const name = sectorName(sector)
  const secondary = /\/S\b/.test(u)
  const or = (fallback) => name || (secondary ? 'Secondary' : fallback)
  if (/^LCL\b/.test(u)) return { type: 'TWR', description: or('Tower'), primary: !secondary }
  if (/^GND METERING/.test(u)) return { type: 'GND', description: 'Metering', primary: false }
  if (/^GND\b/.test(u)) return { type: 'GND', description: or('Ground'), primary: !secondary }
  if (/PRE[- ]?TAXI/.test(u)) return { type: 'CLD', description: 'Pre-taxi clearance', primary: false }
  if (/^CD\b/.test(u)) return { type: 'CLD', description: or('Clearance delivery'), primary: !secondary }
  if (/^APCH\b/.test(u)) return { type: 'APP', description: or('Approach'), primary: !secondary }
  if (/^DEP\b/.test(u)) return { type: 'DEP', description: or('Departure'), primary: !secondary }
  if (/ATIS/.test(u)) return { type: 'ATIS', description: /ARR/.test(u) ? 'Arrival information' : /DEP/.test(u) ? 'Departure information' : 'Airport information', primary: true }
  if (/^CLASS [BC]\b/.test(u)) return { type: 'CLB', description: or(title(u)), primary: false }
  if (/^PRM\b/.test(u)) return { type: 'OTH', description: `Precision monitor${name ? `, ${name}` : ''}`, primary: false }
  if (/^VFR ADZY/.test(u)) return { type: 'OTH', description: 'VFR advisory', primary: false }
  return null
}

let faaCycle = null
try {
  const eff = currentCycle()
  const stamp = `${String(eff.getUTCDate()).padStart(2, '0')}_${eff.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })}_${eff.getUTCFullYear()}`
  const usIatas = new Set(Object.entries(IDENTS).filter(([, icao]) => icao.startsWith('K')).map(([iata]) => iata))

  // ---- runways: the FAA's surveyed end points are current where OurAirports can lag
  // (a runway extension shows up as a new length with the old coordinates).
  const aptRes = await fetch(`https://nfdc.faa.gov/webContent/28DaySub/extra/${stamp}_APT_CSV.zip`)
  if (!aptRes.ok) throw new Error(`APT HTTP ${aptRes.status}`)
  const aptZip = Buffer.from(await aptRes.arrayBuffer())
  const faaRunways = parseCsv(unzipEntry(aptZip, 'APT_RWY.csv').toString('latin1'))
  const faaEnds = parseCsv(unzipEntry(aptZip, 'APT_RWY_END.csv').toString('latin1'))
  const endsByRunway = new Map()
  for (const e of faaEnds) {
    if (!usIatas.has(e.ARPT_ID)) continue
    const key = `${e.ARPT_ID}|${e.RWY_ID}`
    endsByRunway.set(key, [...(endsByRunway.get(key) ?? []), e])
  }
  const rebuilt = {}
  for (const r of faaRunways) {
    if (!usIatas.has(r.ARPT_ID) || !/^\d/.test(r.RWY_ID) || !r.RWY_ID.includes('/')) continue // helipads, placeholders
    const [leId, heId] = r.RWY_ID.split('/')
    const ends = endsByRunway.get(`${r.ARPT_ID}|${r.RWY_ID}`) ?? []
    const end = (id) => {
      const e = ends.find((x) => x.RWY_END_ID === id)
      if (!e || e.LAT_DECIMAL === '' || e.LONG_DECIMAL === '') return null
      return { ident: id, lat: Number(e.LAT_DECIMAL), lon: Number(e.LONG_DECIMAL), hdg: num(e.TRUE_ALIGNMENT), displacedFt: num(e.DISPLACED_THR_LEN) ?? 0 }
    }
    const le = end(leId)
    const he = end(heId)
    if (!le || !he || !(Number(r.RWY_LEN) > 0)) continue
    ;(rebuilt[r.ARPT_ID] ??= []).push({ lengthFt: num(r.RWY_LEN), widthFt: num(r.RWY_WIDTH), surface: r.SURFACE_TYPE_CODE || null, le, he })
  }
  for (const [iata, list] of Object.entries(rebuilt)) if (list.length) out[iata].runways = list
  console.log(`FAA NASR runways for ${Object.keys(rebuilt).length} US airports`)

  const res = await fetch(`https://nfdc.faa.gov/webContent/28DaySub/extra/${stamp}_FRQ_CSV.zip`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const rows = parseCsv(unzipEntry(Buffer.from(await res.arrayBuffer()), 'FRQ.csv').toString('latin1'))

  const byAirport = {}
  for (const r of rows) {
    if (r.SERVICED_SITE_TYPE !== 'AIRPORT' || !usIatas.has(r.SERVICED_FACILITY)) continue
    const mhz = Number(r.FREQ)
    if (!(mhz >= 118 && mhz < 137)) continue // civil VHF voice only
    const c = classify(r.FREQ_USE ?? '', r.SECTORIZATION)
    if (!c) continue
    ;(byAirport[r.SERVICED_FACILITY] ??= []).push({ ...c, mhz })
  }

  for (const [iata, list] of Object.entries(byAirport)) {
    // One row per (type, frequency): sectors sharing a frequency are joined.
    const merged = new Map()
    for (const f of list) {
      const key = `${f.type}|${f.mhz}`
      const prev = merged.get(key)
      if (!prev) merged.set(key, { ...f })
      else {
        if (!prev.description.split(', ').includes(f.description)) prev.description += `, ${f.description}`
        prev.primary ||= f.primary
      }
    }
    const freqs = [...merged.values()]
    // Only trust the FAA list when it at least has a tower; otherwise keep OurAirports.
    if (freqs.some((f) => f.type === 'TWR')) out[iata].frequencies = freqs
  }
  faaCycle = eff.toISOString().slice(0, 10)
  console.log(`FAA NASR ${faaCycle}: positions for ${Object.keys(byAirport).length} US airports`)
} catch (err) {
  console.warn(`FAA NASR data unavailable (${err.message}); keeping OurAirports runways and frequencies`)
}

for (const a of Object.values(out)) {
  a.frequencies.sort(
    (x, y) => x.type.localeCompare(y.type) || Number(y.primary ?? true) - Number(x.primary ?? true) || x.description.localeCompare(y.description, 'en', { numeric: true }) || x.mhz - y.mhz,
  )
  a.runways.sort((x, y) => x.le.ident.localeCompare(y.le.ident))
}

fs.writeFileSync(
  OUT,
  JSON.stringify(
    {
      source: 'OurAirports (public domain) — https://ourairports.com/data/; FAA NASR 28-day subscription (US frequencies)',
      fetchedAt: new Date().toISOString().slice(0, 10),
      faaCycle,
      airports: out,
    },
    null,
    2,
  ) + '\n',
)
const missing = Object.entries(out).filter(([, a]) => a.lat == null || a.runways.length === 0).map(([k]) => k)
if (missing.length) throw new Error(`no reference point or runways for: ${missing.join(', ')}`)
console.log(`wrote ${OUT}: ${Object.keys(out).length} airports, ${Object.values(out).reduce((n, a) => n + a.runways.length, 0)} runways`)
