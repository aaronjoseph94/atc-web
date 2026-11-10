/**
 * Finds glossary terms in a line of text (a radio call, an ATIS broadcast, a
 * caption) for Learn mode to underline. Pure and cached, because the
 * transcript list may ask about hundreds of lines on each render.
 */
import { GLOSSARY, type GlossaryEntry } from './glossary'

export type TermHit = { start: number; end: number; id: string; text: string }

type Compiled = { entry: GlossaryEntry; re: RegExp }

/**
 * Each pattern as a global regex. A pattern's own `i` flag wins; otherwise
 * it is case-insensitive unless its entry is marked case-sensitive.
 */
const COMPILED: Compiled[] = GLOSSARY.flatMap((entry) =>
  entry.patterns.map((p) => ({ entry, re: new RegExp(p.source, `g${p.flags.includes('i') || !entry.caseSensitive ? 'i' : ''}`) })),
)

const cache = new Map<string, TermHit[]>()
const CACHE_LIMIT = 800

/**
 * Every glossary term in `text`, in reading order, without overlaps. Where
 * two matches overlap, the one that starts first wins, then the longer one
 * ("hold short of runway 4" is the hold-short phrase, not the runway).
 */
export function findTerms(text: string, only?: ReadonlySet<string>): TermHit[] {
  if (!text) return []
  const key = only ? `${[...only].join(',')}|${text}` : text
  const hit = cache.get(key)
  if (hit) return hit
  const all: TermHit[] = []
  for (const { entry, re } of COMPILED) {
    if (only && !only.has(entry.id)) continue
    re.lastIndex = 0
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (!m[0].trim()) {
        re.lastIndex++
        continue
      }
      // Leading spaces in a match (optional prefixes) shouldn't be underlined.
      const lead = m[0].length - m[0].trimStart().length
      const trail = m[0].length - m[0].trimEnd().length
      all.push({ start: m.index + lead, end: m.index + m[0].length - trail, id: entry.id, text: m[0].trim() })
    }
  }
  all.sort((a, b) => a.start - b.start || b.end - a.end)
  const out: TermHit[] = []
  let until = -1
  for (const h of all) {
    if (h.start < until) continue
    out.push(h)
    until = h.end
  }
  cache.set(key, out)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  return out
}

export type Segment = { text: string; hit?: TermHit }

/** `text` cut into plain runs and term runs, for rendering. */
export function segmentTerms(text: string, hits: TermHit[] = findTerms(text)): Segment[] {
  if (!hits.length) return [{ text }]
  const out: Segment[] = []
  let at = 0
  for (const h of hits) {
    if (h.start > at) out.push({ text: text.slice(at, h.start) })
    out.push({ text: text.slice(h.start, h.end), hit: h })
    at = h.end
  }
  if (at < text.length) out.push({ text: text.slice(at) })
  return out
}

/** Glossary entries whose term, keywords or explanation match a search, best first. */
export function searchGlossary(query: string): GlossaryEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return GLOSSARY
  const scored: [GlossaryEntry, number][] = []
  for (const e of GLOSSARY) {
    const term = e.term.toLowerCase()
    let score = 0
    if (term === q) score = 100
    else if (term.startsWith(q)) score = 80
    else if (term.includes(q) || e.keywords?.some((k) => k.toLowerCase().includes(q))) score = 60
    // A search for the words themselves ("line up and wait", "FL350") finds the entry they belong to.
    else if (findTerms(query, new Set([e.id])).length) score = 50
    else if (e.text.toLowerCase().includes(q)) score = 20
    if (score) scored.push([e, score])
  }
  return scored.sort((a, b) => b[1] - a[1]).map(([e]) => e)
}
