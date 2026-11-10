/**
 * Shared logic for `GET /api/weather` (Pages Function + Vite dev plugin).
 *
 * Two free, key-less sources are merged:
 *  - aviationweather.gov (US NWS, public domain): the current METAR, decoded.
 *  - atis.info: the digital ATIS text for US airports that publish one. This
 *    is the same recorded broadcast pilots tune in to, so it names the runways
 *    in use and any closures. Canadian airports have none; `atis` is then [].
 *
 * Either source may fail independently; the other half is still returned.
 */
import { getJson } from './aircraftHandler'
import { icaoCode } from './airportData'
import { getAirport } from './airports'
import type { Atis, FlightCategory, Metar, Weather } from './types'

const TIMEOUT_MS = 6000
const HPA_PER_INHG = 33.8639

/** Subset of the aviationweather.gov METAR JSON that we read. */
export type AwcMetar = {
  rawOb?: string
  obsTime?: number
  reportTime?: string
  temp?: number | null
  dewp?: number | null
  wdir?: number | string | null
  wspd?: number | null
  wgst?: number | null
  visib?: number | string | null
  /** Hectopascals. */
  altim?: number | null
  wxString?: string | null
  clouds?: { cover?: string; base?: number | null }[]
  fltCat?: string | null
}

export type AtisInfoRow = { type?: string; code?: string; datis?: string; updatedAt?: string }

const CATEGORIES = new Set<FlightCategory>(['VFR', 'MVFR', 'IFR', 'LIFR'])

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** aviationweather.gov JSON → our `Metar`. Returns null for an unusable row. */
export function normalizeMetar(m: AwcMetar | null | undefined): Metar | null {
  if (!m?.rawOb) return null

  const variable = typeof m.wdir === 'string' && m.wdir.toUpperCase() === 'VRB'
  const windKt = finite(m.wspd)
  // 0° at 0 kt is "calm", not "from the north".
  const windDirDeg = variable || !windKt ? null : finite(m.wdir)

  let visibilitySm: number | null = null
  let visibilityPlus = false
  if (typeof m.visib === 'number') visibilitySm = m.visib
  else if (typeof m.visib === 'string') {
    visibilityPlus = m.visib.includes('+')
    const v = Number.parseFloat(m.visib)
    visibilitySm = Number.isFinite(v) ? v : null
  }

  const altim = finite(m.altim)
  const cat = (m.fltCat ?? '').toUpperCase() as FlightCategory
  const observed = m.obsTime ? new Date(m.obsTime * 1000) : m.reportTime ? new Date(m.reportTime) : new Date()

  return {
    raw: m.rawOb.replace(/^(METAR|SPECI)\s+/, ''),
    observedAt: observed.toISOString(),
    windDirDeg,
    windVariable: variable,
    windKt,
    gustKt: finite(m.wgst),
    visibilitySm,
    visibilityPlus,
    tempC: finite(m.temp),
    dewpointC: finite(m.dewp),
    altimeterInHg: altim == null ? null : Math.round((altim / HPA_PER_INHG) * 100) / 100,
    flightCategory: CATEGORIES.has(cat) ? cat : null,
    clouds: (m.clouds ?? [])
      .filter((c) => c.cover)
      .map((c) => ({ cover: String(c.cover).toUpperCase(), baseFt: finite(c.base) })),
    weather: m.wxString?.trim() || null,
  }
}

const ATIS_KIND: Record<string, Atis['kind']> = { combined: 'combined', arr: 'arrival', dep: 'departure' }

/** atis.info rows → `Atis[]` (arrival before departure, combined first). */
export function normalizeAtis(rows: AtisInfoRow[] | null | undefined): Atis[] {
  if (!Array.isArray(rows)) return []
  const order: Atis['kind'][] = ['combined', 'arrival', 'departure']
  return rows
    .filter((r) => typeof r.datis === 'string' && r.datis.trim())
    .map((r) => ({
      code: (r.code ?? '').trim().toUpperCase().slice(0, 1),
      kind: ATIS_KIND[(r.type ?? 'combined').toLowerCase()] ?? 'combined',
      text: r.datis!.trim(),
      updatedAt: r.updatedAt ?? null,
    }))
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
}

/** Fetch and merge both sources. Never throws; missing halves come back empty. */
export async function fetchWeather(airportCode: string): Promise<Weather> {
  const airport = getAirport(airportCode)
  const icao = icaoCode(airport.icao) ?? `K${airport.icao}`

  const [metar, atis] = await Promise.all([
    getJson<AwcMetar[]>(
      `https://aviationweather.gov/api/data/metar?ids=${icao}&format=json`,
      AbortSignal.timeout(TIMEOUT_MS),
    )
      .then((rows) => normalizeMetar(rows?.[0]))
      .catch(() => null),
    // D-ATIS exists only at US airports.
    icao.startsWith('K') || icao.startsWith('P')
      ? getJson<AtisInfoRow[]>(`https://atis.info/api/${icao}`, AbortSignal.timeout(TIMEOUT_MS))
          .then(normalizeAtis)
          .catch(() => [] as Atis[])
      : Promise.resolve([] as Atis[]),
  ])

  return { airport: airport.icao, icao, metar, atis, fetchedAt: new Date().toISOString() }
}
