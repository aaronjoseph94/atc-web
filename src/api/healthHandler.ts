/**
 * Backend diagnostics shared by the Pages Function and the dev middleware.
 *
 * Runs one real traffic round-trip (what the map would get), then probes every
 * upstream source on its own so a feed that has quietly died shows up even
 * while failover hides it from the map. Each source reports its last result,
 * latency and circuit-breaker state. Probe results are cached for a few
 * seconds so an open Settings page doesn't multiply upstream traffic.
 */
import { ALL_PROVIDERS, feedBlock, getJson, getText, handleAircraftRequest, providersFor, withFeedGuards, type SourceEnv } from './aircraftHandler'
import { icaoCode } from './airportData'
import { getAirport, knownAirport } from './airports'
import type { Health } from './client'
import { errorText, noCache, PacedSkip, sourceHealth, type JsonCache, type SourceHealth, type SourceKind, type SourceStatus } from './sourceHealth'

const PROBE_TIMEOUT_MS = 5000
const PROBE_TTL_S = 20
/** A transponder every metadata database knows, for probing them. */
const PROBE_HEX = 'a0b169'

export type HealthOptions = {
  env?: SourceEnv
  cache?: JsonCache
  health?: SourceHealth
}

type Probe = { name: string; kind: SourceKind; run: (signal: AbortSignal) => Promise<number | null> }

/** Time one probe and fold its result into the breaker's view of the source. */
async function runProbe(p: Probe, health: SourceHealth): Promise<SourceStatus> {
  const t0 = Date.now()
  try {
    const count = await p.run(AbortSignal.timeout(PROBE_TIMEOUT_MS))
    const latencyMs = Date.now() - t0
    health.recordSuccess(p.name, latencyMs, count ?? undefined)
    return { ...health.status(p.name, p.kind), ok: true, latencyMs, count, error: null }
  } catch (err) {
    if (err instanceof PacedSkip) return { ...health.status(p.name, p.kind), note: 'Within the shared limit; not asked again yet' }
    health.recordFailure(p.name, err)
    return { ...health.status(p.name, p.kind), ok: false, latencyMs: Date.now() - t0, error: errorText(err) }
  }
}

/** Probe every upstream source once. */
export async function probeSources(airport: string, opts: HealthOptions = {}): Promise<SourceStatus[]> {
  const health = opts.health ?? sourceHealth
  const apt = getAirport(airport)
  const icao = icaoCode(apt.icao) ?? `K${apt.icao}`
  const cache = opts.cache ?? noCache
  // Same pause and gap as the map, so a health check can't spend a feed the map is saving.
  const active = withFeedGuards(providersFor(opts.env), cache, opts.env)
  const probes: Probe[] = []
  const passive: SourceStatus[] = []
  const blocks = new Map(await Promise.all(ALL_PROVIDERS.map(async (p) => [p.name, await feedBlock(cache, p.name)] as const)))

  for (const p of ALL_PROVIDERS) {
    const live = active.find((a) => a.name === p.name)
    if (!live) {
      passive.push({ ...health.status(p.name, 'adsb'), enabled: false, note: 'Needs the provider’s permission first (see docs/data-sources.md)' })
    } else if (live.lastResort) {
      // Report what real traffic requests last saw instead of spending the allowance.
      passive.push({ ...health.status(p.name, 'adsb'), note: 'Last resort; not probed (small anonymous allowance)' })
    } else if (live.minIntervalMs != null && health.sinceLastAttempt(p.name) < live.minIntervalMs + 1000) {
      // Just called for the map: its result is fresh, and a probe now would trip the rate limit.
      passive.push(health.status(p.name, 'adsb'))
    } else {
      const block = blocks.get(p.name) ?? null
      if (block != null) {
        const status = health.status(p.name, 'adsb')
        // A pause carries the refusal; a gap just means the map already asked.
        passive.push(block ? { ...status, ok: false, error: block, note: 'Paused so the feed is not asked again until the block lifts' } : status)
        continue
      }
      probes.push({
        name: p.name,
        kind: 'adsb',
        run: async (s) => {
          health.markAttempt(p.name)
          return (await live.fetch(apt, s)).length
        },
      })
    }
  }

  probes.push(
    { name: 'adsbdb.com', kind: 'metadata', run: async (s) => (await getJson<{ response?: unknown }>(`https://api.adsbdb.com/v0/aircraft/${PROBE_HEX}`, s)).response ? 1 : 0 },
    { name: 'hexdb.io', kind: 'metadata', run: async (s) => ((await getJson<{ registration?: string }>(`https://hexdb.io/api/v2/aircraft/${PROBE_HEX}`, s)).registration ? 1 : 0) },
    { name: 'aviationweather.gov', kind: 'weather', run: async (s) => (await getJson<unknown[]>(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json`, s)).length },
    { name: 'tgftp.nws.noaa.gov', kind: 'weather', run: async (s) => ((await getText(`https://tgftp.nws.noaa.gov/data/observations/metar/stations/${icao}.TXT`, s)).includes(icao) ? 1 : 0) },
  )
  if (icao.startsWith('K') || icao.startsWith('P')) {
    probes.push({ name: 'atis.info', kind: 'weather', run: async (s) => (await getJson<unknown[]>(`https://atis.info/api/${icao}`, s)).length })
  }

  // Rehearsed failures (ATC_FAIL_SOURCES) show up here as they do for real requests.
  const broken = new Set((opts.env?.ATC_FAIL_SOURCES ?? '').split(',').map((s) => s.trim()))
  const rehearse = (p: Probe): Probe => (broken.has(p.name) ? { ...p, run: (s) => getJson<number>('https://invalid.invalid/rehearsed-failure', s) } : p)
  const results = await Promise.all(probes.map((p) => runProbe(rehearse(p), health)))
  const order: SourceKind[] = ['adsb', 'metadata', 'weather']
  return [...results, ...passive].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
}

/** Diagnostics for one airport; null when the code is not one this site serves (callers answer 404). */
export async function buildHealth(airport: string, runtime: string, region?: string, opts: HealthOptions = {}): Promise<Health | null> {
  const known = knownAirport(airport)
  if (!known) return null
  airport = known.icao
  const cache = opts.cache ?? noCache
  const key = `health:${airport}:std`
  const hit = await cache.get<Health>(key)
  if (hit) return hit

  const t0 = Date.now()
  // The map round-trip first, so the probes see its pause and gap and don't
  // spend a second request on a feed the map just used.
  const res = await handleAircraftRequest(airport, cache, opts.env)
  const sources = await probeSources(airport, { ...opts, cache })
  const latencyMs = Date.now() - t0
  const list = (await res.json()) as unknown[]
  const error = res.headers.get('X-Upstream-Error')
  const provider = res.headers.get('X-Provider')

  const base = { runtime, region, sources, checkedAt: new Date().toISOString(), latencyMs }
  const health: Health =
    provider && !res.headers.get('X-Stale')
      ? { ...base, ok: true, provider, aircraft: list.length }
      : { ...base, ok: false, provider, aircraft: list.length, error: error ?? 'no feed answered' }
  await cache.put(key, health, PROBE_TTL_S)
  return health
}
