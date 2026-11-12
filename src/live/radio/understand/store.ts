/**
 * What the AI made of each heard call (cleaned text, plain English, speaker,
 * instructions), by transmission id, plus whether AI is available at all and
 * the "Explain calls" switch.
 *
 * A call is published with its cleaned words already in place (see ../gate.ts
 * and ../transcriber.ts); what is kept here is the rest of the answer, by
 * call, for a day (like the transcript history), so a reload still has the
 * explanations, instructions and badges.
 */
import { create } from 'zustand'
import type { Understanding } from './result'

/**
 * `unknown`: not checked yet. `on`: the server has a key and room under its
 * daily cap. `off`: not set up, or switched off on this device. `limited`:
 * set up, but the daily cap is reached (calls are shown unprocessed until it resets).
 */
export type AiState = 'unknown' | 'on' | 'off' | 'limited'

export type StoredUnderstanding = Understanding & {
  /** When the call was heard (epoch ms), for expiry and the badge clock. */
  at: number
  airport: string
  stationId: string
  /** Aircraft each instruction is for (same order as `instructions`); null when nobody matched. */
  targets: (string | null)[]
  /** Aircraft the cleaned call named that the raw text's callsigns had missed. */
  added: { callsign: string; icao24: string }[]
}

type UnderstandState = {
  results: Record<string, StoredUnderstanding>
  /** Calls with a request on its way. */
  pending: Record<string, true>
  ai: AiState
  /** Show the plain-English line under every call. */
  explain: boolean
}

const RESULTS_KEY = 'atc-web.radio-ai.v1'
const PREFS_KEY = 'atc-web.radio-ai-prefs.v1'
const KEEP_MS = 24 * 3_600_000
const KEEP_MAX = 400

function read<T>(key: string, fallback: T): T {
  try {
    const s = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
    return s ? (JSON.parse(s) as T) : fallback
  } catch {
    return fallback
  }
}

function loadResults(): Record<string, StoredUnderstanding> {
  const saved = read<StoredUnderstanding[]>(RESULTS_KEY, [])
  const since = Date.now() - KEEP_MS
  const out: Record<string, StoredUnderstanding> = {}
  if (Array.isArray(saved)) for (const r of saved) if (r && typeof r.id === 'string' && r.at >= since && Array.isArray(r.instructions)) out[r.id] = r
  return out
}

export const useUnderstanding = create<UnderstandState>(() => ({
  results: loadResults(),
  pending: {},
  ai: 'unknown',
  explain: read<{ explain?: boolean }>(PREFS_KEY, {}).explain === true,
}))

let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      const list = Object.values(useUnderstanding.getState().results)
        .sort((a, b) => a.at - b.at)
        .slice(-KEEP_MAX)
      localStorage.setItem(RESULTS_KEY, JSON.stringify(list))
    } catch {
      // Storage full or blocked: results just won't survive a reload.
    }
  }, 2000)
}

export function putResult(r: StoredUnderstanding) {
  useUnderstanding.setState((s) => {
    const pending = { ...s.pending }
    delete pending[r.id]
    return { results: { ...s.results, [r.id]: r }, pending }
  })
  scheduleSave()
}

export function setPending(id: string, on: boolean) {
  useUnderstanding.setState((s) => {
    if (!!s.pending[id] === on) return s
    const pending = { ...s.pending }
    if (on) pending[id] = true
    else delete pending[id]
    return { pending }
  })
}

export function setExplain(explain: boolean) {
  useUnderstanding.setState({ explain })
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ explain }))
  } catch {
    // Not remembered; still applies now.
  }
}

/** The understanding of one call, if any. */
export const useUnderstood = (id: string | null | undefined) => useUnderstanding((s) => (id ? s.results[id] : undefined))
