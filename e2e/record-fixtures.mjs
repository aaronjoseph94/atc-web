/**
 * Re-records the API fixtures the end-to-end tests stub the network with.
 *
 *   npx vite --port 5196 --strictPort &      # the dev server proxies the real feeds
 *   node e2e/record-fixtures.mjs http://localhost:5196
 *
 * Writes e2e/fixtures/api/*.json. The JFK snapshot is real traffic plus a few
 * hand-placed aircraft (an arrival, a departure, a light aircraft, a helicopter, a taxiing jet)
 * so every test has the kinds of aircraft it needs whatever the time of day
 * the recording was made. Review the diff before committing: the tests name
 * some of these aircraft (see e2e/support/fixtures.ts).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const base = process.argv[2] ?? 'http://localhost:5196'
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'api')
await mkdir(out, { recursive: true })

async function get(url, init) {
  const res = await fetch(base + url, init)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.json()
}

async function save(name, data) {
  await writeFile(path.join(out, name), JSON.stringify(data, null, 1) + '\n')
  process.stdout.write(`wrote ${name}\n`)
}

// Aircraft the tests rely on, placed on JFK's runways and approaches (wind from the north-west: 31s in use).
const JFK_EXTRA = [
  { icao24: 'a4f2c1', callsign: 'DAL1210', lat: 40.6094, lon: -73.684, heading: 301, altitudeFt: 1300, speedKt: 145, onGround: false, type: 'A321', registration: 'N391DN', verticalRateFpm: -750, category: 'A3', squawk: '3341' },
  { icao24: 'aa0b5e', callsign: 'AAL100', lat: 40.6655, lon: -73.8543, heading: 301, altitudeFt: 2400, speedKt: 190, onGround: false, type: 'B77W', registration: 'N717AN', verticalRateFpm: 2800, category: 'A5', squawk: '2251' },
  { icao24: 'a9d3b2', callsign: 'N738SP', lat: 40.5786, lon: -73.8121, heading: 250, altitudeFt: 1500, speedKt: 105, onGround: false, type: 'C172', registration: 'N738SP', verticalRateFpm: 0, category: 'A1', squawk: '1200' },
  { icao24: 'a2c7f0', callsign: 'N24HL', lat: 40.617, lon: -73.83, heading: 75, altitudeFt: 900, speedKt: 95, onGround: false, type: 'AS50', registration: 'N24HL', verticalRateFpm: 0, category: 'A7', squawk: '1200' },
]
const airport = (iata, icao, name, city, lat, lon) => ({ iata, icao, name, city, lat, lon })
const JFK_EXTRA_FLIGHTS = {
  DAL1210: { callsign: 'DAL1210', airline: 'Delta Air Lines', origin: airport('ATL', 'KATL', 'Hartsfield-Jackson Atlanta International Airport', 'Atlanta', 33.6367, -84.4281), destination: airport('JFK', 'KJFK', 'John F Kennedy International Airport', 'New York', 40.6398, -73.7789), typeName: 'AIRBUS A-321', manufacturer: 'Airbus', registration: 'N391DN', owner: 'DELTA AIR LINES INC', sources: ['adsbdb', 'feed'] },
  AAL100: { callsign: 'AAL100', airline: 'American Airlines', origin: airport('JFK', 'KJFK', 'John F Kennedy International Airport', 'New York', 40.6398, -73.7789), destination: airport('LHR', 'EGLL', 'London Heathrow Airport', 'London', 51.4706, -0.4619), typeName: 'BOEING 777-300ER', manufacturer: 'Boeing', registration: 'N717AN', owner: 'AMERICAN AIRLINES INC', sources: ['adsbdb', 'feed'] },
  N738SP: { callsign: 'N738SP', airline: null, origin: null, destination: null, typeName: 'CESSNA 172S', manufacturer: 'Cessna', registration: 'N738SP', owner: null, sources: ['feed'] },
  N24HL: { callsign: 'N24HL', airline: null, origin: null, destination: null, typeName: 'AS 350 B3', manufacturer: 'Airbus Helicopters', registration: 'N24HL', owner: null, sources: ['feed'] },
}
/** Real aircraft given a taxi speed, so one is moving on the ground. */
const JFK_TAXIING = { DAL2692: 14 }

const want = { JFK: 22, ATL: 20, YYC: 20 }
let jfk = []
for (const [code, max] of Object.entries(want)) {
  let list = await get(`/api/aircraft?airport=${code}`)
  list = list.slice(0, max)
  if (code === 'JFK') {
    list = list.map((a) => (JFK_TAXIING[a.callsign] ? { ...a, speedKt: JFK_TAXIING[a.callsign] } : a))
    list.push(...JFK_EXTRA.filter((x) => !list.some((a) => a.icao24 === x.icao24)))
    jfk = list
  }
  await save(`aircraft-${code}.json`, list)
  await save(`weather-${code}.json`, await get(`/api/weather?airport=${code}`))
}

// Route and airframe for every JFK aircraft, keyed by callsign (the tests answer unknown ones with nulls).
const flights = { ...JFK_EXTRA_FLIGHTS }
for (const a of jfk) {
  if (flights[a.callsign]) continue
  try {
    flights[a.callsign] = await get(`/api/flight?hex=${a.icao24}&callsign=${encodeURIComponent(a.callsign)}`)
  } catch (e) {
    console.warn('flight', a.callsign, e.message)
  }
}
await save('flights.json', flights)

await save('health-JFK.json', await get('/api/health?airport=JFK'))
await save('summarize-status.json', await get('/api/summarize'))
