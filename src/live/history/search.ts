/**
 * Searching the transcript history: what matches a query and a set of
 * filters, where in the text to highlight, and how to group results by time.
 *
 * Pure functions over plain entries, so the list can re-filter on every
 * keystroke without touching the stores.
 */

export type EntrySource = 'radio' | 'event' | 'cue'

/** One searchable line: a heard call, a tower-log event, or a replay cue. */
export type SearchItem = {
  id: string
  source: EntrySource
  /** Epoch ms (radio, events) or ms into the replay (cues). */
  at: number
  text: string
  stationId: string
  /** Callsigns named in it, as written (`DAL288`). */
  callsigns: string[]
  /** Aircraft it concerns (transponder addresses). */
  ids: string[]
  /** For events: what happened. */
  eventKind?: string
}

export type Range = [number, number]

export type Phrase = { id: string; label: string; re: RegExp }

/** Quick chips for what people look for most. */
export const PHRASES: Phrase[] = [
  { id: 'goaround', label: 'Go around', re: /\bgo(?:ing)?[\s-]*around\b|\bgo-?around\b/gi },
  { id: 'holdshort', label: 'Hold short', re: /\bhold(?:ing)?\s+short\b/gi },
  { id: 'land', label: 'Cleared to land', re: /\bclear(?:ed)?\s+(?:to\s+)?land\b/gi },
  { id: 'luaw', label: 'Line up and wait', re: /\b(?:line|lined|lining)\s*up\s+(?:and|&|n)\s+wait\b|\bposition\s+and\s+hold\b/gi },
  { id: 'takeoff', label: 'Cleared for takeoff', re: /\bclear(?:ed)?\s+for\s+take\s*-?\s*off\b/gi },
  { id: 'taxi', label: 'Taxi', re: /\btaxi(?:ing)?\b/gi },
  { id: 'contact', label: 'Contact', re: /\b(?:contact|monitor)\b/gi },
]

export type Filters = {
  query: string
  phrase: string | null
  source: 'all' | 'radio' | 'event'
  /** Only this channel (radio calls); events are airport-wide and always pass. */
  stationId: string | null
  /** Only calls naming this callsign. */
  callsign: string | null
  /** Only calls about this aircraft ("my flight"). */
  icao24: string | null
}

export const NO_FILTERS: Filters = { query: '', phrase: null, source: 'all', stationId: null, callsign: null, icao24: null }

export type Hit<T extends SearchItem = SearchItem> = { item: T; ranges: Range[] }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const SIDE_WORD: Record<string, string> = { l: 'left', r: 'right', c: 'cent(?:er|re)' }
const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']

/**
 * The pattern a typed word searches for. Mostly the word itself, but a
 * runway ("31L", "4R") also finds how it is said ("31 left", "three one left").
 */
export function termPattern(term: string): RegExp {
  const t = term.toLowerCase()
  const rw = /^0?(\d{1,2})([lrc])?$/.exec(t)
  if (rw && rw[2]) {
    const n = rw[1]
    const spoken = n
      .split('')
      .map((d) => DIGIT_WORDS[+d])
      .join('[\\s-]+')
    const side = `(?:${rw[2]}|${SIDE_WORD[rw[2]]})`
    return new RegExp(`\\b(?:0?${n}\\s*${side}|${spoken}\\s+${side})\\b`, 'gi')
  }
  return new RegExp(escape(term), 'gi')
}

/** Split a query into words, keeping "quoted phrases" whole. */
export function parseQuery(q: string): string[] {
  const out: string[] = []
  for (const m of q.matchAll(/"([^"]+)"|(\S+)/g)) {
    const t = (m[1] ?? m[2]).trim()
    if (t) out.push(t)
  }
  return out
}

function allRanges(text: string, re: RegExp): Range[] {
  const out: Range[] = []
  re.lastIndex = 0
  for (const m of text.matchAll(re)) if (m[0].length) out.push([m.index, m.index + m[0].length])
  return out
}

/** Sort and merge overlapping ranges. */
export function mergeRanges(ranges: Range[]): Range[] {
  const s = ranges.slice().sort((a, b) => a[0] - b[0])
  const out: Range[] = []
  for (const r of s) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out
}

/** Does the item pass the filters? If so, the ranges to highlight in its text. */
export function matchItem<T extends SearchItem>(item: T, f: Filters): Hit<T> | null {
  if (f.source !== 'all' && item.source !== 'cue' && item.source !== f.source) return null
  if (f.stationId && item.source === 'radio' && item.stationId !== f.stationId) return null
  if (f.callsign && !item.callsigns.some((c) => c.toUpperCase() === f.callsign!.toUpperCase())) return null
  if (f.icao24 && !item.ids.includes(f.icao24)) return null
  const ranges: Range[] = []
  if (f.phrase) {
    const p = PHRASES.find((x) => x.id === f.phrase)
    if (p) {
      const r = allRanges(item.text, p.re)
      // Phrases match what was said: a detected go-around isn't a call that says "go around".
      if (!r.length) return null
      ranges.push(...r)
    }
  }
  for (const term of parseQuery(f.query)) {
    const r = allRanges(item.text, termPattern(term))
    // A callsign search ("DAL288") finds calls where it was said as "Delta 288".
    const t = term.toUpperCase().replace(/[^A-Z0-9]/g, '')
    const named = t.length >= 2 && item.callsigns.some((c) => c.toUpperCase().includes(t))
    if (!r.length && !named) return null
    ranges.push(...r)
  }
  return { item, ranges: mergeRanges(ranges) }
}

export function search<T extends SearchItem>(items: T[], f: Filters): Hit<T>[] {
  const out: Hit<T>[] = []
  for (const it of items) {
    const h = matchItem(it, f)
    if (h) out.push(h)
  }
  return out
}

/** Text cut into plain and highlighted runs. */
export function highlight(text: string, ranges: Range[]): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = []
  let at = 0
  for (const [a, b] of ranges) {
    if (a > at) out.push({ text: text.slice(at, a), hit: false })
    out.push({ text: text.slice(a, b), hit: true })
    at = b
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false })
  return out
}

const MIN = 60_000
const HOUR = 60 * MIN

/** Time-ago heading for an entry: "Now", "10 min ago", "2 h ago", "Yesterday". */
export function timeBucket(at: number, now: number): string {
  const age = Math.max(0, now - at)
  if (age < 2 * MIN) return 'Now'
  if (age < 7 * MIN) return '5 min ago'
  if (age < 15 * MIN) return '10 min ago'
  if (age < 25 * MIN) return '20 min ago'
  if (age < 45 * MIN) return '30 min ago'
  if (age < 90 * MIN) return '1 h ago'
  if (age < 23.5 * HOUR) return `${Math.round(age / HOUR)} h ago`
  return 'Yesterday'
}

export type Group<T> = { label: string; key: string; hits: T[] }

/** Consecutive hits (oldest first) under their time headings. */
export function groupByTime<T extends { item: { at: number; id: string } }>(hits: T[], now: number): Group<T>[] {
  const groups: Group<T>[] = []
  for (const h of hits) {
    const label = timeBucket(h.item.at, now)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.hits.push(h)
    else groups.push({ label, key: `${label}-${h.item.id}`, hits: [h] })
  }
  return groups
}

/** Callsigns heard most often, for suggestions as the user types. */
export function callsignSuggestions(items: SearchItem[], query: string, limit = 6): string[] {
  const q = query.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (q.length < 2) return []
  const counts = new Map<string, number>()
  for (const it of items) for (const c of it.callsigns) if (c.toUpperCase().includes(q)) counts.set(c, (counts.get(c) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([c]) => c)
}
