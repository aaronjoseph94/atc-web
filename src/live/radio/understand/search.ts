/**
 * The transcript list and the AI pass: a call's entry already holds its
 * processed words with the raw ones beside them, so a search still finds
 * what the recogniser originally wrote (and then shows those words, lit).
 * Entries saved by earlier versions hold the raw words only; for those the
 * stored answer supplies the cleaned text, speaker and aircraft.
 */
import { matchItem, type Filters, type Hit, type SearchItem } from '../../history/search'
import type { Speaker } from '../callsigns'
import type { StoredUnderstanding } from './store'

type Entry = SearchItem & { speaker: Speaker | null; raw?: string }

/** An entry as shown: cleaned text (the raw kept beside it), the model's speaker, aircraft the cleanup found. */
export function withUnderstanding<E extends Entry>(entries: E[], results: Record<string, Pick<StoredUnderstanding, 'cleaned' | 'speaker' | 'added'> | undefined>): (E & { raw?: string })[] {
  return entries.map((e) => {
    const u = e.source === 'radio' ? results[e.id] : undefined
    // Already published with its answer (or without one): the entry is as it should be shown.
    if (!u || e.raw != null) return e
    const added = u.added ?? []
    return {
      ...e,
      text: u.cleaned ?? e.text,
      raw: e.text,
      speaker: u.speaker ?? e.speaker,
      ids: added.length ? [...new Set([...added.map((a) => a.icao24), ...e.ids])] : e.ids,
      callsigns: added.length ? [...new Set([...added.map((a) => a.callsign), ...e.callsigns])] : e.callsigns,
    }
  })
}

/** Search the shown text, falling back to the raw text (shown instead, so the match can be lit). */
export function searchWithRaw<T extends SearchItem & { raw?: string }>(items: T[], f: Filters): Hit<T>[] {
  const out: Hit<T>[] = []
  for (const it of items) {
    const h = matchItem(it, f)
    if (h) {
      out.push(h)
      continue
    }
    if (it.raw && it.raw !== it.text) {
      const r = matchItem({ ...it, text: it.raw }, f)
      if (r) out.push(r)
    }
  }
  return out
}
