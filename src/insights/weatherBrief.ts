/**
 * "What it means": the weather's practical impact in a sentence or two, for
 * the weather panel (and the airport briefing). The rules below are the
 * built-in version; the `weatherBrief` AI task words the same inputs more
 * naturally when a key is set.
 */
import type { WeatherBriefInput } from '../api/ai/tasks/weatherBrief'
import type { Atis, FlightCategory, Metar } from '../api/types'
import type { ActiveRunways } from '../live/runwayUse'
import type { RunwayEndGeometry } from '../map/airportDiagram'
import { runwayWinds, type RunwayWind } from '../weather/atis'
import { ceilingOf, describeSky, describeWeather, formatVisibility } from '../weather/decode'
import { parseTaf, upcoming, type TafPeriod } from '../weather/taf'

/** Formats an epoch-ms time for people (the viewer's clock). Injected so tests don't depend on the machine's zone. */
export type Clock = (ms: number) => string

export const localClock: Clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

const RANK: Record<FlightCategory, number> = { LIFR: 0, IFR: 1, MVFR: 2, VFR: 3 }

/** `270° at 15 kt, gusting 25`, `Variable at 4 kt`, `Calm`. */
export function windText(m: Pick<Metar, 'windDirDeg' | 'windVariable' | 'windKt' | 'gustKt'> | null | undefined): string | null {
  if (!m || m.windKt == null) return null
  if (m.windKt === 0) return 'Calm'
  const dir = m.windDirDeg == null || m.windVariable ? 'Variable' : `${String(m.windDirDeg).padStart(3, '0')}°`
  return `${dir} at ${m.windKt} kt${m.gustKt ? `, gusting ${m.gustKt}` : ''}`
}

/** Short words for a forecast period: `IFR, light rain, overcast at 800 ft, wind 190° 18 kt gusting 30`. */
export function periodText(p: TafPeriod): string {
  const wx = describeWeather(p.weather)
  const sky = describeSky(p.clouds)
  const wind = p.wind ? (p.wind.kt === 0 ? 'calm' : `wind ${p.wind.dirDeg == null ? 'variable' : `${String(p.wind.dirDeg).padStart(3, '0')}°`} ${p.wind.kt} kt${p.wind.gustKt ? ` gusting ${p.wind.gustKt}` : ''}`) : null
  return [p.category, wx?.toLowerCase(), sky === 'No cloud reported' ? null : sky.toLowerCase(), wind].filter(Boolean).join(', ')
}

const KIND: Record<TafPeriod['kind'], string> = { base: 'forecast', from: 'from', becoming: 'becoming', tempo: 'at times', prob: 'chance' }

/** The forecast still to come, in the viewer's time, at most eight periods. */
export function forecastPeriods(tafRaw: string | null | undefined, now: number, clock: Clock = localClock): WeatherBriefInput['forecast'] {
  const taf = parseTaf(tafRaw, new Date(now))
  if (!taf) return []
  const { main, overlays } = upcoming(taf, now)
  return [...main, ...overlays]
    .sort((a, b) => a.from - b.from)
    .slice(0, 8)
    .map((p) => ({ from: clock(p.from), to: clock(p.to), kind: p.kind === 'prob' ? `${p.probability ?? ''}% chance` : KIND[p.kind], text: periodText(p) }))
}

/**
 * The one forecast change worth a mention: the next main period whose
 * category differs from now (improving or worsening), or a chance of
 * thunderstorms. Null when the forecast holds steady.
 */
export function forecastHeadline(tafRaw: string | null | undefined, now: number, clock: Clock = localClock, horizonMs = 8 * 3_600_000): string | null {
  const taf = parseTaf(tafRaw, new Date(now))
  if (!taf) return null
  const { main, overlays } = upcoming(taf, now)
  const cur = main[0]
  const storm = overlays.find((p) => p.from < now + horizonMs && /TS/.test(p.weather ?? ''))
  const next = main.slice(1).find((p) => p.from < now + horizonMs && p.category && cur?.category && p.category !== cur.category)
  if (next?.category && cur?.category) {
    const better = RANK[next.category] > RANK[cur.category]
    const why = describeWeather(next.weather)
    return `Forecast ${better ? 'improving' : 'worsening'} to ${next.category} from ${clock(next.from)}${!better && why ? ` (${why.toLowerCase()})` : ''}`
  }
  if (storm) return `Thunderstorms possible ${clock(storm.from)}–${clock(storm.to)}`
  return null
}

/** Wind on the runways in use (or, failing that, the ones the wind favours). */
export function windsOnRunways(metar: Metar | null, ends: RunwayEndGeometry[], active: ActiveRunways | null): RunwayWind[] {
  const all = runwayWinds(metar, ends)
  if (!all.length) return []
  const using = new Set([...(active?.landing ?? []), ...(active?.departing ?? [])])
  const picked = using.size ? all.filter((w) => using.has(w.ident)) : all.slice(0, 2)
  return picked.length ? picked : all.slice(0, 2)
}

export type WeatherData = {
  airport: string
  metar: Metar | null
  taf: string | null
  atis: Atis[]
  active: ActiveRunways | null
  ends: RunwayEndGeometry[]
  now: number
  clock?: Clock
}

export function buildWeatherInput(d: WeatherData): WeatherBriefInput | null {
  if (!d.metar && !d.taf && !d.atis.length) return null
  const m = d.metar
  const winds = windsOnRunways(m, d.ends, d.active)
  return {
    airport: d.airport,
    metar: m?.raw ?? null,
    decoded: {
      category: m?.flightCategory ?? null,
      wind: windText(m),
      visibility: m ? formatVisibility(m.visibilitySm, m.visibilityPlus) : null,
      sky: m ? describeSky(m.clouds) : null,
      weather: describeWeather(m?.weather),
      temperature: m?.tempC != null ? `${Math.round(m.tempC)}°C${m.dewpointC != null ? `, dew point ${Math.round(m.dewpointC)}°C` : ''}` : null,
    },
    forecast: forecastPeriods(d.taf, d.now, d.clock),
    atis: d.atis.map((a) => `Information ${a.code}: ${a.text}`).join(' ').slice(0, 700) || null,
    runways: [...new Set([...(d.active?.landing ?? []), ...(d.active?.departing ?? [])])],
    winds: winds.map((w) => ({ runway: w.ident, headKt: w.headwindKt, crossKt: w.crosswindKt })),
  }
}

/**
 * The built-in "what it means": one to three short sentences from the decoded
 * report. `headline` is the forecast change (forecastHeadline), if any.
 */
export function fallbackWeather(metar: Metar | null, winds: RunwayWind[], headline: string | null): string | null {
  if (!metar) return headline ? `${headline}.` : null
  const out: string[] = []
  const ceiling = ceilingOf(metar.clouds)
  const sky = describeSky(metar.clouds)
  const wx = metar.weather ?? ''
  const vis = metar.visibilitySm

  // Conditions: can pilots see the runway from a distance, or are they on instruments?
  if (metar.flightCategory === 'LIFR') out.push(`${/FG/.test(wx) ? 'Fog' : 'Very low cloud'}${ceiling != null ? ` (${sky.toLowerCase()})` : ''}: arrivals need precise instrument approaches, and some may hold or divert`)
  else if (metar.flightCategory === 'IFR') out.push(`${ceiling != null && ceiling < 1000 ? `Low cloud (${sky.toLowerCase()})` : 'Poor visibility'}: arrivals are flying instrument approaches`)
  else if (metar.flightCategory === 'MVFR') out.push(`Lowish cloud or haze: still flyable by sight, but marginal`)
  else if (metar.flightCategory === 'VFR' && !winds.some((w) => w.crosswindKt >= 15) && !(metar.gustKt && metar.gustKt >= 25)) out.push('Good flying weather: pilots can see the runway from miles out')

  // Wind: crosswind on the runways in use, tailwind, gusts.
  const cross = [...winds].sort((a, b) => b.crosswindKt - a.crosswindKt)[0]
  const tail = winds.find((w) => w.headwindKt <= -5)
  if (cross && cross.crosswindKt >= 25) out.push(`Strong crosswind on ${cross.ident} (${cross.crosswindKt} kt): expect crabbed approaches and firm landings`)
  else if (cross && cross.crosswindKt >= 15) out.push(`A ${cross.crosswindKt} kt crosswind on ${cross.ident}, enough that pilots will notice`)
  if (tail) out.push(`A ${-tail.headwindKt} kt tailwind on ${tail.ident}`)
  if (metar.gustKt && metar.gustKt >= 25) out.push(`Gusts to ${metar.gustKt} kt make for a bumpy final approach`)

  // Weather that changes how the airport works.
  if (/TS/.test(wx)) out.push('Thunderstorms nearby can pause departures and send arrivals into holding')
  else if (/FZ/.test(wx)) out.push('Freezing precipitation: expect de-icing before departure')
  else if (/SN|PL|GR|GS/.test(wx)) out.push('Snow or ice: expect de-icing and slower runway operations')
  else if (vis != null && vis < 1 && metar.flightCategory !== 'LIFR') out.push('Visibility under a mile')

  if (headline) out.push(headline)
  if (!out.length) return null
  return out.slice(0, 3).map((s) => `${s}.`).join(' ')
}
