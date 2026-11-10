/**
 * Downloads the FAA's Coded Instrument Flight Procedures (CIFP) and writes
 * one small GeoJSON file per US airport in our catalog to
 * `public/procedures/{code}.json`: the arrival (STAR), departure (SID) and
 * approach paths the map draws when "Procedures" is on.
 *
 * The CIFP is the FAA's ARINC 424 database of every US instrument procedure,
 * published free each 28-day AIRAC cycle by Aeronautical Information Services.
 * It is a US government work (public domain). Parsing and geometry live in
 * `src/map/procedures/` (pure TypeScript, unit tested); Node runs them
 * directly thanks to type stripping (Node 22.18+).
 *
 * Canadian airports are not in the CIFP. NAV CANADA's procedure data (CFS,
 * CAP, the AIP) isn't licensed for redistribution, so for them the map keeps
 * drawing the extended runway centrelines only.
 *
 * Usage: `npm run data:procedures` (or `CIFP_ZIP=path/to/CIFP_YYMMDD.zip` to
 * use a file already downloaded). The output is committed so builds need no
 * network access; refresh it every cycle or two.
 *
 * Source: https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { parseCifp } from '../src/map/procedures/cifp.ts'
import { buildAirportFile } from '../src/map/procedures/build.ts'

const OUT_DIR = path.resolve('public/procedures')
const AIRPORTS = JSON.parse(fs.readFileSync(path.resolve('src/api/airportData.json'), 'utf8')).airports
const DOWNLOAD_PAGE = 'https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/download/'

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

/** The CIFP zip in force today: the download page lists the current and the next cycle. */
async function currentZipUrl() {
  const res = await fetch(DOWNLOAD_PAGE)
  if (!res.ok) throw new Error(`CIFP download page: HTTP ${res.status}`)
  const html = await res.text()
  const links = [...new Set(html.match(/https:\/\/aeronav\.faa\.gov\/[^"']*CIFP_\d{6}\.zip/g) ?? [])]
  const today = new Date().toISOString().slice(2, 10).replace(/-/g, '')
  const dated = links.map((url) => ({ url, d: /CIFP_(\d{6})\.zip/.exec(url)[1] })).sort((a, b) => a.d.localeCompare(b.d))
  const current = dated.filter((x) => x.d <= today).pop() ?? dated[0]
  if (!current) throw new Error('no CIFP link on the download page')
  return current.url
}

async function main() {
  let zip
  if (process.env.CIFP_ZIP) {
    console.log(`Reading ${process.env.CIFP_ZIP}`)
    zip = fs.readFileSync(process.env.CIFP_ZIP)
  } else {
    const url = await currentZipUrl()
    console.log(`Downloading ${url}`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`CIFP: HTTP ${res.status}`)
    zip = Buffer.from(await res.arrayBuffer())
  }
  const text = unzipEntry(zip, 'FAACIFP18').toString('latin1')

  // Our catalog uses three-letter codes; the CIFP uses ICAO idents. Only US fields are in it.
  const wanted = new Map(Object.entries(AIRPORTS).filter(([, a]) => /^K/.test(a.icao ?? '')).map(([code, a]) => [a.icao, code]))
  const data = parseCifp(text, new Set(wanted.keys()))
  console.log(`CIFP cycle ${data.cycle}: ${data.procedures.length} procedure branches for ${wanted.size} airports`)

  fs.mkdirSync(OUT_DIR, { recursive: true })
  for (const f of fs.readdirSync(OUT_DIR)) if (f.endsWith('.json')) fs.unlinkSync(path.join(OUT_DIR, f))
  let total = 0
  for (const [icao, code] of wanted) {
    const file = buildAirportFile(data, icao)
    if (!file) {
      console.warn(`${code}: nothing in the CIFP`)
      continue
    }
    const json = JSON.stringify(file)
    fs.writeFileSync(path.join(OUT_DIR, `${code}.json`), json)
    total += json.length
    const count = (k) => file.features.filter((x) => x.properties.k === k).length
    console.log(`${code}: ${count('final')} finals, ${count('trans')} approach transitions, ${count('star')} arrival and ${count('sid')} departure lines, ${count('fix')} fixes, ${(json.length / 1024).toFixed(0)} KB`)
  }
  console.log(`Wrote ${wanted.size} files, ${(total / 1024).toFixed(0)} KB in all, to ${path.relative(process.cwd(), OUT_DIR)}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
