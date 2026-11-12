/**
 * "What did I miss?": what happened at the airport between two times, from
 * the history (tower log and radio calls), the alerts raised and the runway
 * changes seen. `buildCatchUp` gathers it; `fallbackCatchUp` lists it in plain
 * words when there is no AI to summarise it.
 */
import type { CatchUpInput } from '../api/ai/tasks/catchUp'
import type { HistoryEntry } from '../live/history/store'
import type { Alert } from './alerts'
import type { RunwayChange } from './insightsStore'
import type { Clock } from './weatherBrief'

/** Coming back after at least this long away offers a catch-up. */
export const AWAY_MS = 5 * 60_000

export type CatchUpMoment = { at: number; kind: string; text: string; radio?: string; icao24?: string | null }

export type CatchUpData = {
  airport: string
  since: number
  until: number
  entries: HistoryEntry[]
  alerts: Alert[]
  runwayLog: RunwayChange[]
  clock: Clock
}

const NOTABLE = new Set(['goaround', 'emergency', 'rto', 'diversion'])
const SAYS_WHY = /\bgo(?:ing)?[\s-]*around\b|\bmissed\b|\bwind\s*shear\b|\bunstable\b|\btraffic\b|\brunway\b.*\b(?:occupied|not\s+clear)\b|\bmay\s*day\b|\bpan[\s-]?pan\b|\bemergency\b|\bengine\b|\bmedical\b|\bdivert/i

/** The radio call that best explains a moment: from the same aircraft within two minutes, one that says why if possible. */
export function radioFor(entries: HistoryEntry[], ids: string[], callsigns: string[], at: number): HistoryEntry | null {
  const near = entries.filter((e) => e.source === 'radio' && Math.abs(e.at - at) < 120_000 && (e.ids.some((i) => ids.includes(i)) || e.callsigns.some((c) => callsigns.includes(c))))
  if (!near.length) return null
  return near.find((e) => SAYS_WHY.test(e.text)) ?? near.sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0]
}

const runwayText = (c: RunwayChange) => {
  const now = [c.landing.length ? `landing ${c.landing.join(' ')}` : '', c.departing.length ? `departing ${c.departing.join(' ')}` : ''].filter(Boolean).join(', ')
  const was = [c.prevLanding.length ? `landing ${c.prevLanding.join(' ')}` : '', c.prevDeparting.length ? `departing ${c.prevDeparting.join(' ')}` : ''].filter(Boolean).join(', ')
  return `Runways changed: now ${now || 'unclear'}${was ? ` (was ${was})` : ''}`
}

export function buildCatchUp(d: CatchUpData): { input: CatchUpInput; moments: CatchUpMoment[] } {
  const inWindow = <T extends { at: number }>(x: T) => x.at >= d.since && x.at <= d.until
  const entries = d.entries.filter((e) => e.airport === d.airport && inWindow(e))
  const events = entries.filter((e) => e.source === 'event')
  const count = (k: string) => events.filter((e) => e.eventKind === k).length

  const moments: CatchUpMoment[] = []
  for (const e of events) {
    if (!NOTABLE.has(e.eventKind ?? '')) continue
    const radio = radioFor(entries, e.ids, e.callsigns, e.at)
    moments.push({ at: e.at, kind: e.eventKind!, text: e.text, radio: radio?.text, icao24: e.ids[0] ?? null })
  }
  // Alerts the log doesn't have: heard on the radio, rejected takeoffs. One per aircraft and kind.
  for (const a of d.alerts.filter(inWindow)) {
    if (a.kind === 'runway') continue
    const dup = moments.some((m) => m.kind === a.kind && ((a.icao24 && m.icao24 === a.icao24) || Math.abs(m.at - a.at) < 30_000))
    if (!dup) moments.push({ at: a.at, kind: a.kind, text: a.body, radio: a.quote, icao24: a.icao24 })
  }
  moments.sort((a, b) => a.at - b.at)

  const runwayChanges = d.runwayLog.filter(inWindow).map((c) => ({ time: d.clock(c.at), text: runwayText(c) }))
  const input: CatchUpInput = {
    airport: d.airport,
    awayMin: Math.round((d.until - d.since) / 60_000),
    counts: {
      takeoffs: count('departed'),
      landings: count('landed'),
      goArounds: moments.filter((m) => m.kind === 'goaround').length,
      emergencies: moments.filter((m) => m.kind === 'emergency').length,
      radioCalls: entries.filter((e) => e.source === 'radio').length,
    },
    moments: moments.slice(-24).map((m) => {
      const out: CatchUpInput['moments'][number] = { time: d.clock(m.at), kind: m.kind, text: m.text }
      if (m.radio) out.radio = m.radio
      return out
    }),
    runwayChanges: runwayChanges.slice(-6),
  }
  return { input, moments }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The plain list: a one-line summary and the notable moments with their times. */
export function fallbackCatchUp(input: CatchUpInput): { summary: string; highlights: string[] } {
  const c = input.counts
  const movements = [c.takeoffs && plural(c.takeoffs, 'takeoff'), c.landings && plural(c.landings, 'landing')].filter(Boolean) as string[]
  const unusual = [c.goArounds && plural(c.goArounds, 'go-around'), c.emergencies && plural(c.emergencies, 'emergency', 'emergencies')].filter(Boolean) as string[]
  const away = input.awayMin >= 90 ? `${Math.round(input.awayMin / 60)} hours` : `${input.awayMin} minutes`
  let summary = `In the last ${away} at ${input.airport}: ${movements.length ? movements.join(' and ') : 'no takeoffs or landings logged'}`
  summary += unusual.length ? `, and ${unusual.join(' and ')}.` : '.'
  if (c.radioCalls) summary += ` ${plural(c.radioCalls, 'radio call')} transcribed.`
  const highlights = [
    ...input.runwayChanges.map((r) => `${r.time} · ${r.text}`),
    ...input.moments.map((m) => `${m.time} · ${m.text.replace(/\.$/, '')}${m.radio ? ` — “${m.radio.length > 90 ? `${m.radio.slice(0, 89)}…` : m.radio}”` : ''}`),
  ]
  return { summary, highlights: highlights.slice(-6) }
}
