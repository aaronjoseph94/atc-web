/**
 * Aircraft types and airline codes the app met but couldn't name: a type
 * with no entry in the facts table, an airline-style callsign prefix in
 * neither the airline nor the radio-name table. Kept (bounded) in this
 * browser so the owner can copy them out for `scripts/ai-cleanup.mjs --seen`.
 *
 * Only airline-style callsigns (three letters and a number) are recorded;
 * registrations of private aircraft are never kept.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { typeFacts } from '../aircraft/types'
import { airlineInfo, parseCallsign } from '../airline/airlines'
import type { Aircraft } from '../api/types'
import { TELEPHONY } from '../live/radio/telephony'
import { militaryInfo } from './military'
import { normType } from './rarity'

type Count = { n: number; last: number; example?: string }

export type UnknownsState = {
  types: Record<string, Count>
  prefixes: Record<string, Count>
}

/** Most entries kept per list (the least recently seen go first). */
const KEEP = 200

function bump(map: Record<string, Count>, key: string, now: number, example?: string): Record<string, Count> {
  const prev = map[key]
  const next = { ...map, [key]: { n: (prev?.n ?? 0) + 1, last: now, example: example ?? prev?.example } }
  const keys = Object.keys(next)
  if (keys.length <= KEEP) return next
  keys.sort((a, b) => next[a].last - next[b].last)
  for (const k of keys.slice(0, keys.length - KEEP)) delete next[k]
  return next
}

/** Fold one batch of newly met aircraft into the tallies (pure). */
export function noteUnknowns(state: UnknownsState, list: readonly Pick<Aircraft, 'icao24' | 'callsign' | 'type' | 'registration'>[], now: number): UnknownsState {
  let { types, prefixes } = state
  for (const a of list) {
    const t = normType(a.type)
    if (t && !typeFacts(t)) types = bump(types, t, now)
    const p = parseCallsign(a.callsign)?.prefix
    if (p && !airlineInfo(p) && !TELEPHONY[p] && !militaryInfo(a)) prefixes = bump(prefixes, p, now, a.callsign.trim().toUpperCase())
  }
  return types === state.types && prefixes === state.prefixes ? state : { types, prefixes }
}

/** The JSON `scripts/ai-cleanup.mjs --seen` reads. */
export function exportUnknowns(s: UnknownsState) {
  const rows = (m: Record<string, Count>) => Object.entries(m).sort((a, b) => b[1].n - a[1].n)
  return {
    kind: 'atc-web-seen',
    version: 1,
    exportedAt: new Date().toISOString(),
    types: rows(s.types).map(([code, c]) => ({ code, count: c.n })),
    prefixes: rows(s.prefixes).map(([prefix, c]) => ({ prefix, count: c.n, example: c.example ?? null })),
  }
}

export const useUnknowns = create<UnknownsState & { clear: () => void }>()(
  persist((set) => ({ types: {}, prefixes: {}, clear: () => set({ types: {}, prefixes: {} }) }), {
    name: 'atc-web.unknowns.v1',
    partialize: (s) => ({ types: s.types, prefixes: s.prefixes }),
  }),
)
