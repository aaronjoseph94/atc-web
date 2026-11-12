/**
 * What goes with a call to the model: the station, the last few calls on
 * the channel, the traffic around, runways and taxiways. Kept under about
 * 2 KB by shedding the least useful context first.
 */
import { getRunways, paintedDesignator, icaoCode } from '../../../api/airportData'
import { getAirport, resolveStation } from '../../../api/airports'
import type { RadioCleanupInput } from '../../../api/ai/tasks/radioCleanup'
import { liveBuffer } from '../../session'
import { loadNetwork } from '../../taxi/network'
import { writtenCallsign, type Speaker } from '../callsigns'
import { useRadio, type Transmission } from '../radioStore'
import { hintCallsigns } from '../hints'

/** Target size of the request's input, in characters of JSON. */
export const INPUT_BUDGET = 2000
const RECENT = 4

export const toAiSpeaker = (s: Speaker | null | undefined): 'atc' | 'pilot' | 'unknown' => (s === 'controller' ? 'atc' : s === 'pilot' ? 'pilot' : 'unknown')

/** Trim the input until it fits the budget: older context and long lists go first, the call itself never. */
export function fitInput(input: RadioCleanupInput, budget = INPUT_BUDGET): RadioCleanupInput {
  const out: RadioCleanupInput = { ...input, text: input.text.slice(0, 600), recent: input.recent.map((r) => ({ ...r, text: r.text.slice(0, 240) })), traffic: input.traffic.slice(0, 30), taxiways: input.taxiways.slice(0, 80), runways: input.runways.slice(0, 16) }
  const size = () => JSON.stringify(out).length
  while (size() > budget) {
    if (out.taxiways.length > 30) out.taxiways = out.taxiways.slice(0, out.taxiways.length - 10)
    else if (out.traffic.length > 12) out.traffic = out.traffic.slice(0, out.traffic.length - 4)
    else if (out.recent.length > 2) out.recent = out.recent.slice(1)
    else if (out.taxiways.length) out.taxiways = out.taxiways.slice(0, Math.max(0, out.taxiways.length - 10))
    else if (out.traffic.length) out.traffic = out.traffic.slice(0, Math.max(0, out.traffic.length - 4))
    else if (out.recent.length) out.recent = out.recent.slice(1)
    else break
  }
  return out
}

/** Runway idents at an airport, as painted (`4L`, `22R`). */
export function runwayIdents(airport: string): string[] {
  const icao = icaoCode(airport)
  return [...new Set(getRunways(airport).flatMap((r) => [paintedDesignator(r.le.ident, icao), paintedDesignator(r.he.ident, icao)]))]
}

/** Taxiway names per airport, once the taxi network has been loaded (started on the first call heard there). */
const taxiwayNames = new Map<string, string[]>()
function taxiways(airport: string, kind: string | undefined): string[] {
  const known = taxiwayNames.get(airport)
  if (known) return known
  // Taxiways matter on the ground frequencies; the network is shared with the taxi routes, so it is loaded once.
  if (kind === 'GND' || kind === 'TWR' || kind === 'CLD') {
    taxiwayNames.set(airport, [])
    void loadNetwork(airport).then((net) => {
      if (net) taxiwayNames.set(airport, [...net.graph.refs].sort((a, b) => a.length - b.length || a.localeCompare(b)))
      else taxiwayNames.delete(airport)
    })
  }
  return []
}

/** The request for one heard call. `cleanedOf` gives the cleaned text of earlier calls, when there is one. */
export function gatherInput(t: Transmission, cleanedOf: (id: string) => { text: string | null; speaker: Speaker | null } | undefined): RadioCleanupInput {
  const airport = getAirport(t.airport)
  const station = resolveStation(airport, t.stationId)
  const log = useRadio.getState().log[t.stationId] ?? []
  const i = log.findIndex((x) => x.id === t.id)
  const before = (i >= 0 ? log.slice(0, i) : log.filter((x) => x.at < t.at)).filter((x) => x.status === 'done' && x.text).slice(-RECENT)
  const recent = before.map((x) => {
    const c = cleanedOf(x.id)
    return { speaker: toAiSpeaker(c?.speaker ?? x.speaker), text: c?.text ?? x.text }
  })
  // The callsigns the recogniser was steered with, plus the ICAO form so the model can answer in it.
  const hint = hintCallsigns(station?.kind, airport.elevationFt).split(', ').filter(Boolean)
  const byWritten = new Map<string, string>()
  for (const a of liveBuffer.sample()) {
    const w = writtenCallsign(a.callsign)
    if (w) byWritten.set(w, a.callsign)
  }
  const traffic = hint.map((w) => (byWritten.get(w) && byWritten.get(w) !== w ? `${byWritten.get(w)} (${w})` : w))
  return fitInput({
    text: t.text,
    station: { airport: airport.icao, name: airport.stations[0]?.name ?? airport.name, role: station?.kind ?? 'TWR', label: station?.label ?? 'Tower', mhz: station?.frequencyMhz ?? null },
    recent,
    traffic,
    runways: runwayIdents(airport.icao),
    taxiways: taxiways(airport.icao, station?.kind),
    guess: { speaker: toAiSpeaker(t.speaker), callsigns: t.callsigns.map((c) => c.callsign).slice(0, 6) },
  })
}
