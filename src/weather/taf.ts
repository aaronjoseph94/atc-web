/**
 * The terminal forecast (TAF), split and decoded for the forecast timeline.
 *
 * A TAF is a base forecast followed by change groups:
 *  - `FM101700`: from then on, a whole new forecast;
 *  - `BECMG 1020/1022`: conditions change gradually over that window and
 *    stay changed (only what is listed changes);
 *  - `TEMPO 1015/1018` / `PROB30 [TEMPO] ...`: temporary or possible
 *    conditions inside that window, on top of the main forecast.
 *
 * `parseTaf` turns that into a main line of back-to-back periods (base, FM
 * and BECMG, each complete) and a list of overlays (TEMPO and PROB) with the
 * main forecast filled in underneath for anything they don't mention.
 */
import type { FlightCategory } from '../api/types'
import { ceilingOf, flightCategory } from './decode'

/**
 * A raw TAF split into its periods, one per line, the way pilots read it:
 * the base forecast, then each FM / BECMG / TEMPO / PROB group on its own line.
 */
export function tafLines(raw: string | null | undefined): string[] {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return []
  // PROB30 TEMPO stays together; a TEMPO right after a PROB group doesn't start a line of its own.
  return text
    .split(/ (?=(?:FM\d{6}|BECMG|PROB\d{2}|(?<!PROB\d{2} )TEMPO)\b)/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export type TafWind = { dirDeg: number | null; variable: boolean; kt: number; gustKt: number | null }
export type TafCloud = { cover: string; baseFt: number | null }

/** What a group says; anything it leaves out is `undefined` (so BECMG and TEMPO can inherit it). */
type Conditions = {
  wind?: TafWind
  visibilitySm?: number
  visibilityPlus?: boolean
  /** Present weather codes, or null for "no significant weather". */
  weather?: string | null
  clouds?: TafCloud[]
}

export type TafPeriod = {
  kind: 'base' | 'from' | 'becoming' | 'tempo' | 'prob'
  /** Percent, for PROB groups. */
  probability: number | null
  /** Epoch ms. */
  from: number
  to: number
  wind: TafWind | null
  visibilitySm: number | null
  visibilityPlus: boolean
  weather: string | null
  clouds: TafCloud[]
  category: FlightCategory | null
  raw: string
}

export type Taf = { issuedAt: number | null; from: number; to: number; main: TafPeriod[]; overlays: TafPeriod[] }

const SM_PER_M = 1 / 1609.344

/** A `DDHH` or `DDHHMM` time, placed in the month of `ref` (or the one next to it when the day says so). */
function dayTime(day: number, hour: number, minute: number, ref: Date): number {
  let month = ref.getUTCMonth()
  if (day < ref.getUTCDate() - 15) month += 1
  else if (day > ref.getUTCDate() + 15) month -= 1
  // Date.UTC rolls hour 24 and month -1 / 12 over on its own.
  return Date.UTC(ref.getUTCFullYear(), month, day, hour, minute)
}

function parseConditions(tokens: string[]): Conditions {
  const out: Conditions = {}
  const weather: string[] = []
  let clouds: TafCloud[] | undefined
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    let m: RegExpMatchArray | null
    if ((m = t.match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/))) {
      const k = m[4] === 'MPS' ? 1.94384 : 1
      const kt = Math.round(+m[2] * k)
      out.wind = { dirDeg: m[1] === 'VRB' || kt === 0 ? null : +m[1], variable: m[1] === 'VRB', kt, gustKt: m[3] ? Math.round(+m[3] * k) : null }
    } else if (t === 'CAVOK') {
      out.visibilitySm = 6
      out.visibilityPlus = true
      out.weather = null
      clouds = []
    } else if ((m = t.match(/^(P|M)?(\d+)?(?:(\d)\/(\d{1,2}))?SM$/)) && (m[2] || m[3])) {
      let v = (m[2] ? +m[2] : 0) + (m[3] ? +m[3] / +m[4] : 0)
      if (m[3] && !m[2] && /^\d$/.test(tokens[i - 1] ?? '')) v += +tokens[i - 1]
      out.visibilitySm = v
      out.visibilityPlus = m[1] === 'P'
    } else if ((m = t.match(/^(\d{4})$/)) && out.visibilitySm == null && !clouds) {
      out.visibilitySm = Math.round(+m[1] * SM_PER_M * 10) / 10
      out.visibilityPlus = m[1] === '9999'
    } else if ((m = t.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)(CB|TCU)?$/))) {
      ;(clouds ??= []).push({ cover: m[1] === 'VV' ? 'OVX' : m[1], baseFt: m[2] === '///' ? null : +m[2] * 100 })
    } else if (/^(SKC|CLR|NSC)$/.test(t)) {
      clouds = [{ cover: 'SKC', baseFt: null }]
    } else if (t === 'NSW') {
      out.weather = null
    } else if (/^(?:[-+]|VC)?(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+$|^(?:VC)?(?:TS|SH)$/.test(t)) {
      weather.push(t)
    }
  }
  if (weather.length) out.weather = weather.join(' ')
  if (clouds) out.clouds = clouds
  return out
}

/** A forecast with every field settled. */
type Full = { wind: TafWind | null; visibilitySm: number | null; visibilityPlus: boolean; weather: string | null; clouds: TafCloud[] }

/** What a group says, with anything it leaves out taken from the forecast it changes. */
function complete(c: Conditions, under: Full | null): Full {
  return {
    wind: c.wind ?? under?.wind ?? null,
    visibilitySm: c.visibilitySm ?? under?.visibilitySm ?? null,
    visibilityPlus: c.visibilitySm != null ? !!c.visibilityPlus : !!under?.visibilityPlus,
    weather: c.weather !== undefined ? c.weather : (under?.weather ?? null),
    clouds: c.clouds ?? under?.clouds ?? [],
  }
}

function period(kind: TafPeriod['kind'], probability: number | null, from: number, to: number, c: Full, raw: string): TafPeriod {
  // "Sky clear" is only worth keeping when it is all there is.
  const layers = c.clouds.filter((l) => l.cover !== 'SKC')
  return { kind, probability, from, to, ...c, clouds: layers.length ? layers : c.clouds, category: flightCategory(ceilingOf(c.clouds), c.visibilitySm), raw }
}

/** Decode a raw TAF. `ref` is any time near its issue (now, or the fetch time); returns null if it can't be read. */
export function parseTaf(raw: string | null | undefined, ref: Date = new Date()): Taf | null {
  const lines = tafLines(raw?.replace(/=\s*$/, ''))
  if (!lines.length) return null
  const head = lines[0].split(' ')
  let i = 0
  while (head[i] === 'TAF' || head[i] === 'AMD' || head[i] === 'COR') i++
  i++ // station
  let issuedAt: number | null = null
  const issued = head[i]?.match(/^(\d{2})(\d{2})(\d{2})Z$/)
  if (issued) {
    issuedAt = dayTime(+issued[1], +issued[2], +issued[3], ref)
    i++
  }
  const valid = head[i]?.match(/^(\d{2})(\d{2})\/(\d{2})(\d{2})$/)
  if (!valid) return null
  const anchor = new Date(issuedAt ?? ref.getTime())
  const from = dayTime(+valid[1], +valid[2], 0, anchor)
  const to = dayTime(+valid[3], +valid[4], 0, anchor)
  const range = (s: string) => {
    const m = s.match(/^(\d{2})(\d{2})\/(\d{2})(\d{2})$/)
    return m ? [dayTime(+m[1], +m[2], 0, anchor), dayTime(+m[3], +m[4], 0, anchor)] : null
  }

  const main: TafPeriod[] = []
  const overlays: TafPeriod[] = []
  let current = complete(parseConditions(head.slice(i + 1)), null)
  main.push(period('base', null, from, to, current, lines[0]))

  for (const line of lines.slice(1)) {
    const t = line.split(' ')
    let m: RegExpMatchArray | null
    if ((m = t[0].match(/^FM(\d{2})(\d{2})(\d{2})$/))) {
      const at = dayTime(+m[1], +m[2], +m[3], anchor)
      // An FM group is a whole new forecast: weather it doesn't mention has stopped.
      const next = parseConditions(t.slice(1))
      current = complete({ ...next, weather: next.weather ?? null }, current)
      main[main.length - 1].to = at
      main.push(period('from', null, at, to, current, line))
    } else if (t[0] === 'BECMG') {
      const r = range(t[1] ?? '')
      if (!r) continue
      // Treat the change as done by the start of its window: the timeline shows the new state from there.
      current = complete(parseConditions(t.slice(2)), current)
      main[main.length - 1].to = r[0]
      main.push(period('becoming', null, r[0], to, current, line))
    } else if ((m = t[0].match(/^PROB(\d{2})$/)) || t[0] === 'TEMPO') {
      const prob = m ? +m[1] : null
      const skip = t[1] === 'TEMPO' ? 2 : 1
      const r = range(t[skip] ?? '')
      if (!r) continue
      const under = main.find((p) => p.from <= r[0] && r[0] < p.to) ?? main[main.length - 1]
      overlays.push(period(prob != null ? 'prob' : 'tempo', prob, r[0], r[1], complete(parseConditions(t.slice(skip + 1)), under), line))
    }
  }
  return { issuedAt, from, to, main: main.filter((p) => p.to > p.from), overlays }
}

/** The periods still to come at `now` (the current one first, clipped to start now), main and overlays in time order. */
export function upcoming(taf: Taf, now: number): { main: TafPeriod[]; overlays: TafPeriod[] } {
  const clip = (p: TafPeriod) => (p.from < now ? { ...p, from: now } : p)
  return { main: taf.main.filter((p) => p.to > now).map(clip), overlays: taf.overlays.filter((p) => p.to > now).map(clip) }
}
