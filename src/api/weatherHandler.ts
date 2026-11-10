/**
 * Shared logic for `GET /api/weather` (Pages Function + Vite dev plugin).
 *
 * Free, key-less sources, merged:
 *  - METAR and TAF: aviationweather.gov's data API (US NWS, public domain),
 *    decoded. Its fallback is the same reports as plain text from NOAA's file
 *    server (tgftp.nws.noaa.gov), decoded here. The API can be slow (10 s+
 *    for some stations), so the text file is started if it hasn't answered
 *    within a couple of seconds and whichever is good first wins.
 *  - atis.info: the digital ATIS text for US airports that publish one. This
 *    is the same recorded broadcast pilots tune in to, so it names the runways
 *    in use and any closures. Canadian airports have none; `atis` is then [].
 *    (datis.clowd.io, the other public D-ATIS API, now redirects to it.)
 *
 * Each part may fail independently; the rest is still returned.
 */
import { getJson, getText } from './aircraftHandler'
import { icaoCode } from './airportData'
import { getAirport } from './airports'
import { hedgedFirst, sourceHealth, type SourceHealth } from './sourceHealth'
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

// ---------------------------------------------------------------------------
// Fallback: plain-text METAR from NOAA's file server
// ---------------------------------------------------------------------------

const SM_PER_M = 1 / 1609.344
const WX = /^(?:[-+]|VC)?(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+$|^(?:VC)?(?:TS|SH)$/

/**
 * Split a tgftp station file ("2026/11/10 06:51" line, then the report) into
 * its UTC timestamp and report text.
 */
export function parseTgftp(text: string): { issued: Date | null; body: string } {
  const lines = text.replace(/\r/g, '').split('\n')
  const m = lines[0]?.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})/)
  const issued = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : null
  const body = lines
    .slice(m ? 1 : 0)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
  return { issued, body }
}

/** FAA flight category from the ceiling (lowest broken/overcast layer) and visibility. */
export function flightCategoryFor(ceilingFt: number | null, visibilitySm: number | null): FlightCategory | null {
  if (ceilingFt == null && visibilitySm == null) return null
  const c = ceilingFt ?? Infinity
  const v = visibilitySm ?? Infinity
  if (c < 500 || v < 1) return 'LIFR'
  if (c < 1000 || v < 3) return 'IFR'
  if (c <= 3000 || v <= 5) return 'MVFR'
  return 'VFR'
}

/**
 * Decode a raw METAR (US or ICAO style) into our `Metar`. Covers what the
 * weather panel shows: wind, visibility, present weather, clouds, temperature,
 * altimeter. Remarks and trend groups are ignored. `ref` dates the report
 * (the file's timestamp); the day/time group inside the report refines it.
 */
export function parseMetarText(raw: string, ref: Date = new Date()): Metar | null {
  const text = raw.trim().replace(/^(METAR|SPECI)\s+/, '').replace(/=$/, '')
  const tokens = text.split(/\s+/)
  if (tokens.length < 3 || !/^[A-Z][A-Z0-9]{3}$/.test(tokens[0])) return null

  const out: Metar = {
    raw: text,
    observedAt: ref.toISOString(),
    windDirDeg: null,
    windVariable: false,
    windKt: null,
    gustKt: null,
    visibilitySm: null,
    visibilityPlus: false,
    tempC: null,
    dewpointC: null,
    altimeterInHg: null,
    flightCategory: null,
    clouds: [],
    weather: null,
  }
  const weather: string[] = []
  let ceiling: number | null = null

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === 'RMK' || t === 'TEMPO' || t === 'BECMG' || t === 'NOSIG') break
    let m: RegExpMatchArray | null
    if ((m = t.match(/^(\d{2})(\d{2})(\d{2})Z$/))) {
      // A report from the 31st read on the 1st belongs to last month (Date.UTC wraps month -1 to December).
      const day = +m[1]
      const month = day > ref.getUTCDate() + 1 ? ref.getUTCMonth() - 1 : ref.getUTCMonth()
      out.observedAt = new Date(Date.UTC(ref.getUTCFullYear(), month, day, +m[2], +m[3])).toISOString()
    } else if ((m = t.match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/))) {
      const k = m[4] === 'MPS' ? 1.94384 : 1
      out.windKt = Math.round(+m[2] * k)
      out.gustKt = m[3] ? Math.round(+m[3] * k) : null
      out.windVariable = m[1] === 'VRB'
      // 0° at 0 kt is "calm", not "from the north".
      out.windDirDeg = out.windVariable || out.windKt === 0 ? null : +m[1]
    } else if (t === 'CAVOK') {
      out.visibilitySm = 6
      out.visibilityPlus = true
    } else if ((m = t.match(/^(P|M)?(\d+)?(?:(\d)\/(\d{1,2}))?SM$/))) {
      let v = (m[2] ? +m[2] : 0) + (m[3] ? +m[3] / +m[4] : 0)
      // "1 1/2SM" arrives as two tokens.
      if (m[3] && !m[2] && /^\d$/.test(tokens[i - 1])) v += +tokens[i - 1]
      out.visibilitySm = v
      out.visibilityPlus = m[1] === 'P'
    } else if ((m = t.match(/^(\d{4})(?:NDV)?$/)) && out.visibilitySm == null && i <= 4) {
      // ICAO visibility in metres; 9999 means 10 km or more.
      out.visibilitySm = Math.round(+m[1] * SM_PER_M * 10) / 10
      out.visibilityPlus = m[1] === '9999'
    } else if ((m = t.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)(CB|TCU)?$/))) {
      const base = m[2] === '///' ? null : +m[2] * 100
      out.clouds.push({ cover: m[1] === 'VV' ? 'OVX' : m[1], baseFt: base })
      if ((m[1] === 'BKN' || m[1] === 'OVC' || m[1] === 'VV') && base != null && (ceiling == null || base < ceiling)) ceiling = base
    } else if (/^(SKC|CLR|NSC|NCD)$/.test(t)) {
      out.clouds.push({ cover: t === 'NSC' || t === 'NCD' ? 'CLR' : t, baseFt: null })
    } else if ((m = t.match(/^(M?\d{2})\/(M?\d{2})?$/))) {
      const c = (s: string) => (s.startsWith('M') ? -Number(s.slice(1)) : Number(s))
      out.tempC = c(m[1])
      out.dewpointC = m[2] ? c(m[2]) : null
    } else if ((m = t.match(/^A(\d{4})$/))) {
      out.altimeterInHg = +m[1] / 100
    } else if ((m = t.match(/^Q(\d{4})$/))) {
      out.altimeterInHg = Math.round((+m[1] / HPA_PER_INHG) * 100) / 100
    } else if (WX.test(t)) {
      weather.push(t)
    }
  }
  out.weather = weather.length ? weather.join(' ') : null
  out.flightCategory = flightCategoryFor(ceiling, out.visibilitySm)
  return out
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/** Where each part of a weather answer came from (null when nothing answered). */
export type WeatherSources = { metar: string | null; taf: string | null; atis: string | null }

/** How long the slow primary gets before the text fallback starts alongside it. */
const WEATHER_HEDGE_MS = 2500

/** Base URLs, swappable so failover can be rehearsed (see `ATC_FAIL_SOURCES`). */
export const WEATHER_URLS = {
  awc: 'https://aviationweather.gov/api/data',
  tgftp: 'https://tgftp.nws.noaa.gov/data',
}

/** METAR: aviationweather.gov JSON, else NOAA's text file. */
export function fetchMetar(icao: string, health: SourceHealth = sourceHealth, urls = WEATHER_URLS) {
  return hedgedFirst<Metar | null>(
    [
      {
        name: 'aviationweather.gov',
        run: (s) => getJson<AwcMetar[]>(`${urls.awc}/metar?ids=${icao}&format=json`, s).then((rows) => normalizeMetar(rows?.[0])),
      },
      {
        name: 'tgftp.nws.noaa.gov',
        run: (s) =>
          getText(`${urls.tgftp}/observations/metar/stations/${icao}.TXT`, s).then((txt) => {
            const { issued, body } = parseTgftp(txt)
            return parseMetarText(body, issued ?? new Date())
          }),
      },
    ],
    { hedgeMs: WEATHER_HEDGE_MS, timeoutMs: TIMEOUT_MS, health },
  )
}

/** TAF raw text: aviationweather.gov JSON, else NOAA's text file. Null where none is issued. */
export function fetchTaf(icao: string, health: SourceHealth = sourceHealth, urls = WEATHER_URLS) {
  return hedgedFirst<string | null>(
    [
      {
        name: 'aviationweather.gov',
        run: (s) => getJson<{ rawTAF?: string }[]>(`${urls.awc}/taf?ids=${icao}&format=json`, s).then((rows) => rows?.[0]?.rawTAF?.trim() || null),
      },
      {
        name: 'tgftp.nws.noaa.gov',
        run: (s) => getText(`${urls.tgftp}/forecasts/taf/stations/${icao}.TXT`, s).then((txt) => parseTgftp(txt).body || null),
      },
    ],
    { hedgeMs: WEATHER_HEDGE_MS, timeoutMs: TIMEOUT_MS, health },
  )
}

/** Fetch and merge every part. Never throws; missing parts come back empty. */
export async function fetchWeather(airportCode: string, env: { ATC_FAIL_SOURCES?: string } = {}): Promise<Weather & { sources: WeatherSources }> {
  const airport = getAirport(airportCode)
  const icao = icaoCode(airport.icao) ?? `K${airport.icao}`
  // D-ATIS exists only at US airports.
  const hasAtis = icao.startsWith('K') || icao.startsWith('P')
  const broken = env.ATC_FAIL_SOURCES ?? ''
  const urls = broken.includes('aviationweather.gov') ? { ...WEATHER_URLS, awc: 'https://invalid.invalid' } : WEATHER_URLS

  const [metar, taf, atis] = await Promise.all([
    fetchMetar(icao, sourceHealth, urls),
    fetchTaf(icao, sourceHealth, urls),
    hasAtis
      ? getJson<AtisInfoRow[]>(`https://atis.info/api/${icao}`, AbortSignal.timeout(TIMEOUT_MS))
          .then(normalizeAtis)
          .catch(() => [] as Atis[])
      : Promise.resolve([] as Atis[]),
  ])

  return {
    airport: airport.icao,
    icao,
    metar: metar.value,
    taf: taf.value,
    atis,
    sources: { metar: metar.source, taf: taf.source, atis: atis.length ? 'atis.info' : null },
    fetchedAt: new Date().toISOString(),
  }
}
