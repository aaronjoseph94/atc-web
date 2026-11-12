/**
 * The searchable history of an airport: every transcribed radio call (all
 * channels listened to) and every tower-log event, kept for the session and
 * saved to IndexedDB for a day so a reload or a later visit still has them.
 */
import { create } from 'zustand'
import type { LiveEvent } from '../events'
import { useRadio, type Transmission } from '../radio/radioStore'
import { usePlayhead } from '../../playback/playheadStore'
import { getByIndex, prune, putAll, STORE } from './db'
import type { SearchItem } from './search'

export type HistoryEntry = SearchItem & {
  source: 'radio' | 'event'
  airport: string
  durationMs: number
  speaker: 'pilot' | 'controller' | null
  /** The words as recognised, when `text` is the AI's cleaned version (searched as well). */
  raw?: string
  /** Shown without the AI pass. */
  unprocessed?: boolean
}

/** Saved history older than this is dropped. */
export const HISTORY_MS = 24 * 3_600_000
/** Most entries kept in the database (all airports) and in memory (one airport). */
const DB_LIMIT = 5000
const MEMORY_LIMIT = 2500
const FLUSH_MS = 2000
const PRUNE_MS = 10 * 60_000

type HistoryState = {
  airport: string
  /** Oldest first. */
  entries: HistoryEntry[]
  /** The aircraft last selected: "my flight" even after its card is closed. */
  lastFlight: string | null
}

export const useHistory = create<HistoryState>(() => ({ airport: '', entries: [], lastFlight: null }))

export function fromTransmission(t: Transmission): HistoryEntry {
  const ids = [...new Set([t.icao24, ...t.callsigns.map((c) => c.icao24)].filter((x): x is string => !!x))]
  return {
    id: t.id,
    source: 'radio',
    airport: t.airport,
    stationId: t.stationId,
    at: t.at,
    durationMs: t.durationMs,
    text: t.text,
    callsigns: [...new Set(t.callsigns.map((c) => c.callsign))],
    ids,
    speaker: t.speaker,
    ...(t.raw != null && t.raw !== t.text ? { raw: t.raw } : {}),
    ...(t.unprocessed ? { unprocessed: true } : {}),
  }
}

export function fromEvent(e: LiveEvent, airport: string): HistoryEntry {
  return { id: e.id, source: 'event', airport, stationId: '', at: e.at, durationMs: 0, text: e.text, callsigns: [e.callsign], ids: [e.icao24], speaker: null, eventKind: e.kind }
}

/** Insert or replace entries, keeping time order and the memory bound. */
export function mergeEntries(list: HistoryEntry[], add: HistoryEntry[]): HistoryEntry[] {
  if (!add.length) return list
  const byId = new Map(list.map((e) => [e.id, e]))
  for (const e of add) byId.set(e.id, e)
  return [...byId.values()].sort((a, b) => a.at - b.at).slice(-MEMORY_LIMIT)
}

let pending: HistoryEntry[] = []

function record(entries: HistoryEntry[]) {
  const st = useHistory.getState()
  const mine = entries.filter((e) => e.airport === st.airport)
  if (mine.length) useHistory.setState({ entries: mergeEntries(st.entries, mine) })
  pending.push(...entries)
}

async function load(airport: string) {
  useHistory.setState({ airport, entries: [] })
  const saved = await getByIndex<HistoryEntry>(STORE.entries, 'airport', airport)
  const since = Date.now() - HISTORY_MS
  const st = useHistory.getState()
  if (st.airport !== airport) return
  // Calls not yet written out are as much history as those that were.
  const unsaved = pending.filter((e) => e.airport === airport)
  useHistory.setState({ entries: mergeEntries(st.entries, [...saved.filter((e) => e.at >= since), ...unsaved]) })
}

/** Start keeping history. Returns a stop function. */
export function startHistory(): () => void {
  const ph = usePlayhead.getState()
  void load(ph.airportIcao)
  void prune(STORE.entries, Date.now() - HISTORY_MS, DB_LIMIT)

  // Each call as last recorded (words, speaker, processed or not), so a call that is updated is recorded again.
  const known = new Map<string, string>()
  const stamp = (t: Transmission) => `${t.unprocessed ? 'u' : 'p'}|${t.speaker ?? ''}|${t.icao24 ?? ''}|${t.text}`
  const takeRadio = (log: Record<string, Transmission[]>) => {
    const out: HistoryEntry[] = []
    for (const list of Object.values(log))
      for (const t of list) {
        if (t.status !== 'done' || !t.text || known.get(t.id) === stamp(t)) continue
        known.set(t.id, stamp(t))
        out.push(fromTransmission(t))
      }
    record(out)
  }
  const seenEvents = new Set<string>()
  const takeEvents = (events: LiveEvent[], airport: string) => {
    const out: HistoryEntry[] = []
    for (const e of events) {
      if (seenEvents.has(e.id)) continue
      seenEvents.add(e.id)
      out.push(fromEvent(e, airport))
    }
    record(out)
  }
  takeRadio(useRadio.getState().log)
  takeEvents(ph.events, ph.airportIcao)

  const offRadio = useRadio.subscribe((s, prev) => {
    if (s.log !== prev.log) takeRadio(s.log)
  })
  const offPlayhead = usePlayhead.subscribe((s, prev) => {
    if (s.airportIcao !== prev.airportIcao) void load(s.airportIcao)
    if (s.events !== prev.events && s.mode === 'live') takeEvents(s.events, s.airportIcao)
    if (s.selectedIcao && s.selectedIcao !== prev.selectedIcao && s.mode === 'live') useHistory.setState({ lastFlight: s.selectedIcao })
    if (s.airportIcao !== prev.airportIcao) useHistory.setState({ lastFlight: null })
  })
  const flush = window.setInterval(() => {
    if (!pending.length) return
    const batch = pending
    pending = []
    void putAll(STORE.entries, batch)
  }, FLUSH_MS)
  const pruner = window.setInterval(() => void prune(STORE.entries, Date.now() - HISTORY_MS, DB_LIMIT), PRUNE_MS)
  return () => {
    offRadio()
    offPlayhead()
    window.clearInterval(flush)
    window.clearInterval(pruner)
    if (pending.length) void putAll(STORE.entries, pending)
    pending = []
  }
}
