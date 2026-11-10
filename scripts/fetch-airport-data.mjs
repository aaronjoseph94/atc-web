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
 * Runways the FAA has announced as decommissioned are left out.
 *
 * Elsewhere (Canada) the OurAirports end points can be tens of metres off, so
 * they are moved onto the OpenStreetMap runway centrelines in the OpenFreeMap
 * vector tiles: the same geometry the map draws the pavement from.
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
/** Airports whose runway ends come from the FAA's survey rather than OurAirports. */
const surveyed = new Set()
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
  // NASR keeps listing a runway for a while after the FAA announces it is
  // being decommissioned ("RWY 14/32 WILL BE DECOMMISSIONED ON JUNE 15TH 2026"),
  // and by then the map data already shows grass or taxiway there.
  const retired = new Set()
  for (const m of parseCsv(unzipEntry(aptZip, 'APT_RMK.csv').toString('latin1'))) {
    if (!usIatas.has(m.ARPT_ID)) continue
    const x = /\bRWY (\d{1,2}[LCR]?\/\d{1,2}[LCR]?) (?:WILL BE |IS |WAS )?(?:DECOMMISSIONED|PERMANENTLY CLOSED|CLSD PERMANENTLY|PERMLY CLSD)(?: ON ([A-Z]+) (\d{1,2})\w* (\d{4}))?/i.exec(m.REMARK ?? '')
    if (!x) continue
    const when = x[2] ? Date.parse(`${x[2]} ${x[3]}, ${x[4]}`) : 0
    if (!(when > Date.now())) retired.add(`${m.ARPT_ID}|${x[1]}`)
  }
  const rebuilt = {}
  for (const r of faaRunways) {
    if (!usIatas.has(r.ARPT_ID) || !/^\d/.test(r.RWY_ID) || !r.RWY_ID.includes('/')) continue // helipads, placeholders
    if (retired.has(`${r.ARPT_ID}|${r.RWY_ID}`)) {
      console.log(`${r.ARPT_ID} ${r.RWY_ID}: decommissioned, left out`)
      continue
    }
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
  for (const [iata, list] of Object.entries(rebuilt)) {
    if (!list.length) continue
    out[iata].runways = list
    surveyed.add(iata)
  }
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

// ---------------------------------------------------------------------------
// Runway alignment with OpenStreetMap (airports without an FAA survey)
// ---------------------------------------------------------------------------
//
// OurAirports' end coordinates for Canadian airports are often tens of metres
// off (Halifax 05 sits 370 m short, Calgary's runways 25 m to one side), so the
// painted markings would float off the pavement the map draws. The map's
// pavement is OpenStreetMap's, served by OpenFreeMap, so the runway lines are
// read from those same vector tiles and the ends are moved onto them.

/** Minimal Mapbox Vector Tile reader: just the string tags and line geometry needed here. */
function decodeTile(buf) {
  let pos = 0
  const varint = () => {
    let v = 0
    let shift = 0
    let b
    do {
      b = buf[pos++]
      v += (b & 0x7f) * 2 ** shift
      shift += 7
    } while (b & 0x80)
    return v
  }
  const skip = (wire) => {
    if (wire === 0) varint()
    else if (wire === 1) pos += 8
    else if (wire === 2) pos += varint()
    else if (wire === 5) pos += 4
    else throw new Error(`bad wire type ${wire}`)
  }
  /** Run `fn(field, wire)` over each field of the message ending at `end`. */
  const fields = (end, fn) => {
    for (;;) {
      if (pos >= end) return
      const key = varint()
      if (!fn(key >> 3, key & 7)) skip(key & 7)
    }
  }
  const packed = () => {
    const end = varint() + pos
    const out = []
    for (;;) {
      if (pos >= end) return out
      out.push(varint())
    }
  }
  const string = () => {
    const len = varint()
    const s = buf.toString('utf8', pos, pos + len)
    pos += len
    return s
  }
  const layers = {}
  fields(buf.length, (f, w) => {
    if (f !== 3 || w !== 2) return false
    const end = varint() + pos
    const layer = { name: '', extent: 4096, keys: [], values: [], features: [] }
    fields(end, (lf) => {
      if (lf === 1) layer.name = string()
      else if (lf === 3) layer.keys.push(string())
      else if (lf === 5) layer.extent = varint()
      else if (lf === 4) {
        const vend = varint() + pos
        let value = null
        fields(vend, (vf) => {
          if (vf !== 1) return false
          value = string()
          return true
        })
        layer.values.push(value)
      } else if (lf === 2) {
        const fend = varint() + pos
        const feature = { type: 0, tags: [], geometry: [] }
        fields(fend, (ff) => {
          if (ff === 2) feature.tags = packed()
          else if (ff === 3) feature.type = varint()
          else if (ff === 4) feature.geometry = packed()
          else return false
          return true
        })
        layer.features.push(feature)
      } else return false
      return true
    })
    layers[layer.name] = layer
    return true
  })
  return layers
}

/** A feature's geometry as lines of tile-pixel `[x, y]` points (MoveTo starts a new line). */
function featureLines(geometry) {
  const lines = []
  let x = 0
  let y = 0
  for (let i = 0; i < geometry.length; ) {
    const cmd = geometry[i] & 7
    const count = geometry[i++] >> 3
    if (cmd === 7) continue
    for (let k = 0; k < count; k++) {
      x += (geometry[i] >> 1) ^ -(geometry[i] & 1)
      y += (geometry[i + 1] >> 1) ^ -(geometry[i + 1] & 1)
      i += 2
      if (cmd === 1) lines.push([])
      lines[lines.length - 1].push([x, y])
    }
  }
  return lines
}

const TILE_ZOOM = 14
const tileX = (lon) => Math.floor(((lon + 180) / 360) * 2 ** TILE_ZOOM)
const tileY = (lat) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** TILE_ZOOM)

/** Every OSM runway centreline around an airport, as `{ ref, coords: [lon, lat][] }`. */
async function osmRunwayLines(template, runways) {
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const r of runways) {
    for (const end of [r.le, r.he]) {
      w = Math.min(w, end.lon)
      e = Math.max(e, end.lon)
      s = Math.min(s, end.lat)
      n = Math.max(n, end.lat)
    }
  }
  const tiles = []
  for (let x = tileX(w - 0.012); x <= tileX(e + 0.012); x++) for (let y = tileY(n + 0.008); y <= tileY(s - 0.008); y++) tiles.push([x, y])
  const decoded = await Promise.all(
    tiles.map(async ([x, y]) => {
      const res = await fetch(template.replace('{z}', TILE_ZOOM).replace('{x}', x).replace('{y}', y))
      if (!res.ok) throw new Error(`tile ${TILE_ZOOM}/${x}/${y}: HTTP ${res.status}`)
      return { x, y, layer: decodeTile(Buffer.from(await res.arrayBuffer())).aeroway }
    }),
  )
  const lines = []
  for (const { x, y, layer } of decoded) {
    if (!layer) continue
    for (const f of layer.features) {
      if (f.type !== 2) continue
      const tags = {}
      for (let i = 0; i < f.tags.length; i += 2) tags[layer.keys[f.tags[i]]] = layer.values[f.tags[i + 1]]
      if (tags.class !== 'runway') continue
      const toLngLat = ([px, py]) => {
        const gx = (x + px / layer.extent) / 2 ** TILE_ZOOM
        const gy = (y + py / layer.extent) / 2 ** TILE_ZOOM
        return [gx * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - 2 * gy))) * 180) / Math.PI]
      }
      for (const line of featureLines(f.geometry)) if (line.length > 1) lines.push({ ref: tags.ref ?? null, coords: line.map(toLngLat) })
    }
  }
  return lines
}

/** "08L/26R", "8L-26R" → "8L/26R", so the OSM ref and the data idents compare equal. */
const runwayKey = (a, b) => [a, b].map((s) => s.trim().toUpperCase().replace(/^0(?=\d)/, '')).join('/')

/**
 * Move a runway's ends onto the OSM centreline. Where the OSM line's length
 * agrees with the published length its end points are used outright;
 * otherwise (the line stops at a displaced threshold, or is drawn in pieces)
 * only the line's position and direction are trusted, and the published ends
 * are slid onto it.
 */
function alignRunway(r, lines) {
  const key = runwayKey(r.le.ident, r.he.ident)
  const mine = lines.filter((l) => l.ref && runwayKey(...l.ref.split(/[/-]/).concat('').slice(0, 2)) === key)
  if (!mine.length) return null
  const lat0 = (r.le.lat + r.he.lat) / 2
  const lon0 = (r.le.lon + r.he.lon) / 2
  const kx = 111412.84 * Math.cos((lat0 * Math.PI) / 180)
  const ky = 111132.92 - 559.82 * Math.cos((2 * lat0 * Math.PI) / 180)
  const local = ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky]
  const fit = (pts) => {
    // Principal axis of the points: the runway's direction.
    const cx = pts.reduce((t, p) => t + p[0], 0) / pts.length
    const cy = pts.reduce((t, p) => t + p[1], 0) / pts.length
    let sxx = 0
    let syy = 0
    let sxy = 0
    for (const [x, y] of pts) {
      sxx += (x - cx) ** 2
      syy += (y - cy) ** 2
      sxy += (x - cx) * (y - cy)
    }
    const th = Math.atan2(2 * sxy, sxx - syy) / 2
    return { cx, cy, ux: Math.cos(th), uy: Math.sin(th) }
  }
  const published = (r.lengthFt ?? 0) * 0.3048
  const tolerance = Math.max(0.03 * published, 60)
  const dLe = (r.le.displacedFt ?? 0) * 0.3048
  const dHe = (r.he.displacedFt ?? 0) * 0.3048
  const measure = (pts) => {
    const axis = fit(pts)
    const along = pts.map(([x, y]) => (x - axis.cx) * axis.ux + (y - axis.cy) * axis.uy)
    const lo = Math.min(...along)
    const hi = Math.max(...along)
    const project = (end) => {
      const [x, y] = local([end.lon, end.lat])
      return (x - axis.cx) * axis.ux + (y - axis.cy) * axis.uy
    }
    // Which way round the published ends lie on this line.
    const sign = project(r.he) > project(r.le) ? 1 : -1
    const [a, b] = sign > 0 ? [lo, hi] : [hi, lo]
    // OSM sometimes starts the runway line at a displaced threshold rather than the pavement end.
    let best = null
    for (const le of dLe ? [a, a - sign * dLe] : [a]) {
      for (const he of dHe ? [b, b + sign * dHe] : [b]) {
        const err = Math.abs(Math.abs(he - le) - published)
        if (published > 0 && err <= tolerance && (!best || err < best.err)) best = { le, he, err }
      }
    }
    return { axis, project, osmLen: hi - lo, best }
  }
  const named = mine.flatMap((l) => l.coords.map(local))
  let m = measure(named)
  if (!m.best) {
    // The rest of the runway may be drawn as separate pieces without a ref, on the same line.
    const pieces = lines.filter((l) => !l.ref).map((l) => l.coords.map(local))
    const onLine = pieces.filter((q) => q.every(([x, y]) => Math.abs((x - m.axis.cx) * m.axis.uy - (y - m.axis.cy) * m.axis.ux) < 12))
    const joined = onLine.length ? measure(named.concat(...onLine)) : m
    if (joined.best) m = joined
  }
  const { axis, project, osmLen, best } = m
  const whole = best != null
  const at = (t) => [lon0 + (axis.cx + axis.ux * t) / kx, lat0 + (axis.cy + axis.uy * t) / ky]
  const tLe = best ? best.le : project(r.le)
  const tHe = best ? best.he : project(r.he)
  const le = at(tLe)
  const he = at(tHe)
  const moved = (end, p) => Math.hypot(...local([end.lon, end.lat]).map((v, i) => v - local(p)[i]))
  return { le, he, whole, osmLen, shiftLe: moved(r.le, le), shiftHe: moved(r.he, he) }
}

try {
  const tilejson = await (await fetch('https://tiles.openfreemap.org/planet')).json()
  const template = tilejson.tiles?.[0]
  if (!template) throw new Error('no tile URL in the OpenFreeMap TileJSON')
  const todo = Object.entries(out).filter(([iata, a]) => !surveyed.has(iata) && a.runways.length)
  const osm = await Promise.all(todo.map(([, a]) => osmRunwayLines(template, a.runways)))
  for (const [k, [iata, a]] of todo.entries()) {
    const lines = osm[k]
    for (const r of a.runways) {
      const fix = alignRunway(r, lines)
      const name = `${iata} ${r.le.ident}/${r.he.ident}`
      if (!fix) {
        console.warn(`${name}: no OSM runway with that ref; keeping OurAirports ends`)
        continue
      }
      if (Math.max(fix.shiftLe, fix.shiftHe) > 800) {
        console.warn(`${name}: OSM line is ${Math.round(Math.max(fix.shiftLe, fix.shiftHe))} m away; keeping OurAirports ends`)
        continue
      }
      const round = (v) => Math.round(v * 1e6) / 1e6
      ;[r.le.lon, r.le.lat] = fix.le.map(round)
      ;[r.he.lon, r.he.lat] = fix.he.map(round)
      const brg = (p, q) => ((Math.atan2((q[0] - p[0]) * Math.cos((p[1] * Math.PI) / 180), q[1] - p[1]) * 180) / Math.PI + 360) % 360
      r.le.hdg = Math.round(brg(fix.le, fix.he) * 10) / 10
      r.he.hdg = Math.round(brg(fix.he, fix.le) * 10) / 10
      console.log(`${name}: moved ${Math.round(fix.shiftLe)} m / ${Math.round(fix.shiftHe)} m onto OSM (${fix.whole ? 'ends' : 'axis only'}, OSM ${Math.round(fix.osmLen)} m)`)
    }
  }
} catch (err) {
  console.warn(`OpenStreetMap runway alignment skipped (${err.message})`)
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
