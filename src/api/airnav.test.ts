/* oxlint-disable no-await-in-loop -- the steps in these tests happen one after another on purpose */
import { describe, expect, it, vi } from 'vitest'
import badToken from './__fixtures__/airnav-bad-token.json'
import live from './__fixtures__/airnav-flights-live.json'
import { AIRNAV_BASE, airnavCaps, airnavFill, airnavQuery, airnavUsage, createGuard, fillGaps, flightGaps, parseAirnavFlights, requestsPerDay, type AirnavDeps } from './airnav'
import { memoryStorage, storeCounters } from './storage'
import type { FlightInfo } from './types'

const HEX = 'a09cad'
const CS = 'NKS455'
const unknown: FlightInfo & { sources: string[] } = { callsign: CS, airline: null, origin: null, destination: null, typeName: null, manufacturer: null, registration: null, owner: null, sources: [] }
const env = { AIRNAV_ODAPI_TOKEN: 'tok' }

/** A fresh world: empty stores, an isolated in-memory guard, and a fetch that answers with the fixture. */
function world(answer: () => Response | Promise<Response> = () => new Response(JSON.stringify(live))) {
  let now = Date.UTC(2026, 10, 12, 12)
  const clock = () => now
  const store = memoryStorage(clock)
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => answer())
  const deps = (): AirnavDeps => ({ counters: storeCounters(store, { mirror: new Map(), now: clock }), store, fetch: fetchMock as unknown as typeof fetch, now, guard })
  const guard = createGuard()
  return { store, fetchMock, deps, guard, advance: (ms: number) => (now += ms) }
}

describe('request and parsing (documented shape)', () => {
  it('asks by transponder address when there is one, else by callsign', () => {
    expect(airnavQuery(HEX, CS)).toEqual({ modeSHexCodes: ['A09CAD'] })
    expect(airnavQuery(null, 'nks455')).toEqual({ flightIds: ['NKS455'] })
    expect(airnavQuery(null, null)).toBeNull()
  })

  it('reads the route and airframe of the leg with our callsign', () => {
    const d = parseAirnavFlights(live, HEX, CS)
    expect(d.route).toMatchObject({ airline: 'Spirit Airlines', origin: { iata: 'FLL', icao: 'KFLL', city: 'Fort Lauderdale', lat: 26.0726 }, destination: { iata: 'JFK', icao: 'KJFK' } })
    expect(d.airframe).toEqual({ registration: 'N151NK', typeName: 'Airbus A320-271N', manufacturer: null, owner: null })
    // The next leg of the same aircraft is in the answer too; asked about that callsign, its route is the one used.
    expect(parseAirnavFlights(live, HEX, 'NKS456').route?.destination?.iata).toBe('FLL')
  })

  it('takes the airframe but not the route of a different flight on the same aircraft', () => {
    const d = parseAirnavFlights(live, HEX, 'NKS999')
    expect(d.route).toBeNull()
    expect(d.airframe?.registration).toBe('N151NK')
  })

  it('copes with empty and malformed answers', () => {
    expect(parseAirnavFlights({ success: true, flights: [] }, HEX, CS)).toEqual({ route: null, airframe: null })
    expect(parseAirnavFlights(null, HEX, CS)).toEqual({ route: null, airframe: null })
    expect(parseAirnavFlights({ flights: [{ aircraftModeS: 'A09CAD', depAirportIata: 'FLL' }] }, HEX, CS).route).toBeNull()
  })

  it('fills only what was missing and credits the source', () => {
    const d = parseAirnavFlights(live, HEX, CS)
    const known = { ...unknown, registration: 'N999ZZ', typeName: 'Boeing 737', sources: ['hexdb'] }
    expect(flightGaps(known)).toEqual({ route: true, airframe: false })
    const out = fillGaps(known, d)
    expect(out).toMatchObject({ registration: 'N999ZZ', typeName: 'Boeing 737', airline: 'Spirit Airlines', origin: { iata: 'FLL' }, sources: ['hexdb', 'airnav'] })
    expect(fillGaps(known, { route: null, airframe: null }).sources).toEqual(['hexdb'])
  })
})

describe('caps', () => {
  it('defaults to 3 a day and 90 in all, and never above the credits owned', () => {
    expect(airnavCaps({})).toEqual({ credits: 100, total: 90, daily: 3 })
    expect(airnavCaps({ AIRNAV_TOTAL_CAP: '500', AIRNAV_DAILY_CAP: '1' })).toEqual({ credits: 100, total: 100, daily: 1 })
    expect(airnavCaps({ AIRNAV_TOTAL_CAP: 'lots' }).total).toBe(90)
  })
})

describe('airnavFill', () => {
  it('does nothing without a token, a gap or an id', async () => {
    const w = world()
    expect((await airnavFill(unknown, HEX, CS, {}, w.deps())).reason).toBe('no-token')
    const complete = { ...unknown, registration: 'N1', typeName: 'A320', origin: { iata: 'A', icao: null, name: null, city: null, lat: null, lon: null } }
    expect((await airnavFill(complete, HEX, CS, env, w.deps())).reason).toBe('no-gap')
    expect((await airnavFill(unknown, null, null, env, w.deps())).reason).toBe('no-id')
    expect(w.fetchMock).not.toHaveBeenCalled()
  })

  it('spends one request, with the bearer token, and counts its cost', async () => {
    const w = world()
    const out = await airnavFill(unknown, HEX, CS, env, w.deps())
    expect(out.reason).toBe('asked')
    expect(out.info).toMatchObject({ registration: 'N151NK', origin: { iata: 'FLL' }, destination: { iata: 'JFK' }, sources: ['airnav'] })
    expect(w.fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = w.fetchMock.mock.calls[0]
    expect(url).toBe(`${AIRNAV_BASE}/flights/live`)
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ modeSHexCodes: ['A09CAD'] }) })
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    expect(await airnavUsage(env, w.deps().counters, w.deps().now)).toMatchObject({ configured: true, used: 1, today: 1, credits: 100, cap: 90, dailyCap: 3 })
  })

  it('never pays twice for the same flight: the answer is remembered', async () => {
    const w = world()
    await airnavFill(unknown, HEX, CS, env, w.deps())
    const again = await airnavFill(unknown, HEX, CS, env, w.deps())
    expect(again.reason).toBe('remembered')
    expect(again.info.registration).toBe('N151NK')
    expect(w.fetchMock).toHaveBeenCalledTimes(1)
  })

  it('remembers that nothing is known, too', async () => {
    const w = world(() => new Response(JSON.stringify({ success: true, cost: 1, flights: [] })))
    expect((await airnavFill(unknown, HEX, CS, env, w.deps())).reason).toBe('asked')
    const again = await airnavFill(unknown, HEX, CS, env, w.deps())
    expect(again.reason).toBe('remembered')
    expect(again.info).toEqual(unknown)
    expect(w.fetchMock).toHaveBeenCalledTimes(1)
  })

  it('stops at the daily cap, and starts again the next day', async () => {
    const w = world()
    for (let i = 0; i < 3; i++) expect((await airnavFill(unknown, `a0000${i}`, `TST${i}`, env, w.deps())).reason).toBe('asked')
    expect((await airnavFill(unknown, 'a00009', 'TST9', env, w.deps())).reason).toBe('daily-cap')
    expect(w.fetchMock).toHaveBeenCalledTimes(3)
    w.advance(24 * 3600_000)
    expect((await airnavFill(unknown, 'a00009', 'TST9', env, w.deps())).reason).toBe('asked')
  })

  it('never goes past the lifetime cap', async () => {
    const w = world()
    const capped = { ...env, AIRNAV_TOTAL_CAP: '2', AIRNAV_DAILY_CAP: '50' }
    expect((await airnavFill(unknown, 'a00001', 'TST1', capped, w.deps())).reason).toBe('asked')
    expect((await airnavFill(unknown, 'a00002', 'TST2', capped, w.deps())).reason).toBe('asked')
    expect((await airnavFill(unknown, 'a00003', 'TST3', capped, w.deps())).reason).toBe('total-cap')
    w.advance(5 * 24 * 3600_000)
    expect((await airnavFill(unknown, 'a00004', 'TST4', capped, w.deps())).reason).toBe('total-cap')
    expect(w.fetchMock).toHaveBeenCalledTimes(2)
  })

  it('learns what a request costs and leaves room for it', async () => {
    const w = world(() => new Response(JSON.stringify({ ...live, cost: 2 })))
    await airnavFill(unknown, 'a00001', 'TST1', env, w.deps())
    // Assumed 1, charged 2: both counts are corrected.
    expect(await airnavUsage(env, w.deps().counters, w.deps().now)).toMatchObject({ used: 2, today: 2 })
    // Another 2 would make 4 today: over the cap of 3, so it is not asked.
    expect((await airnavFill(unknown, 'a00002', 'TST2', env, w.deps())).reason).toBe('daily-cap')
    expect(w.fetchMock).toHaveBeenCalledTimes(1)
  })

  it('two requests arriving together cannot both take the last credit', async () => {
    const w = world()
    const capped = { ...env, AIRNAV_DAILY_CAP: '1' }
    const [a, b] = await Promise.all([airnavFill(unknown, 'a00001', 'TST1', capped, w.deps()), airnavFill(unknown, 'a00002', 'TST2', capped, w.deps())])
    expect([a.reason, b.reason].sort()).toEqual(['asked', 'daily-cap'])
    expect(w.fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a second tap on a flight still being looked up does not spend again', async () => {
    const w = world()
    const [a, b] = await Promise.all([airnavFill(unknown, HEX, CS, env, w.deps()), airnavFill(unknown, HEX, CS, env, w.deps())])
    expect([a.reason, b.reason].sort()).toEqual(['asked', 'busy'])
    expect(w.fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a rejected token stops every lookup for a while, without retrying', async () => {
    const w = world(() => new Response('{}', { status: 401 }))
    expect((await airnavFill(unknown, HEX, CS, env, w.deps())).reason).toBe('failed')
    expect((await airnavFill(unknown, 'a00002', 'TST2', env, w.deps())).reason).toBe('blocked')
    expect(w.fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a token AirNav does not recognise (HTTP 200, success false: a real answer) costs nothing and stops every lookup for a day', async () => {
    const w = world(() => new Response(JSON.stringify(badToken)))
    expect((await airnavFill(unknown, HEX, CS, env, w.deps())).reason).toBe('failed')
    // The answer said it cost nothing, so nothing is counted.
    expect(await airnavUsage(env, w.deps().counters, w.deps().now)).toMatchObject({ used: 0, today: 0 })
    expect((await airnavFill(unknown, 'a00002', 'TST2', env, w.deps())).reason).toBe('blocked')
    w.advance(23 * 3600_000)
    expect((await airnavFill(unknown, 'a00003', 'TST3', env, w.deps())).reason).toBe('blocked')
    expect(w.fetchMock).toHaveBeenCalledTimes(1)
  })

  it('counts what each answer says it cost: a lookup that finds nothing and costs nothing is free', async () => {
    const w = world(() => new Response(JSON.stringify({ success: true, cost: 0, flights: [] })))
    expect((await airnavFill(unknown, HEX, CS, env, w.deps())).reason).toBe('asked')
    expect(await airnavUsage(env, w.deps().counters, w.deps().now)).toMatchObject({ used: 0, today: 0 })
  })

  it('even free answers are not asked for without end: a ceiling on requests a day', async () => {
    const w = world(() => new Response(JSON.stringify({ success: true, cost: 0, flights: [] })))
    const limit = requestsPerDay(3)
    expect(limit).toBe(15)
    for (let i = 0; i < limit; i++) expect((await airnavFill(unknown, `b000${String(i).padStart(2, '0')}`, `FRE${i}`, env, w.deps())).reason).toBe('asked')
    expect((await airnavFill(unknown, 'b00099', 'FRE99', env, w.deps())).reason).toBe('daily-cap')
    expect(w.fetchMock).toHaveBeenCalledTimes(limit)
  })

  it('a failed request is not retried for that flight and still counts', async () => {
    const w = world(() => {
      throw new Error('network')
    })
    const out = await airnavFill(unknown, HEX, CS, env, w.deps())
    expect(out).toEqual({ info: unknown, reason: 'failed' })
    expect((await airnavFill(unknown, HEX, CS, env, w.deps())).reason).toBe('remembered')
    expect(w.fetchMock).toHaveBeenCalledTimes(1)
    expect((await airnavUsage(env, w.deps().counters, w.deps().now)).used).toBe(1)
  })
})
