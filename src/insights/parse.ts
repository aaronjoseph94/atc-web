/**
 * Checks on what the AI sent back. Answers are untrusted: anything not of the
 * expected shape, empty, or absurdly long is dropped (null), and the feature
 * keeps its built-in text instead.
 */
import type { ExplainAlertResult } from '../api/ai/tasks/explainAlert'
import type { ExplainTermResult } from '../api/ai/tasks/explainTerm'

const field = (raw: unknown, key: string): unknown => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>)[key] : undefined)

/** A non-empty string of at most `max` characters, tidied; otherwise null. */
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  // Models sometimes wrap a sentence in quotes or markdown emphasis; neither belongs on a card.
  const s = v.replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim().replace(/^"(.*)"$/, '$1')
  if (!s || s.length > max) return null
  return s
}

/** `{ summary }` answers (briefing, weather). */
export const parseSummary = (max: number) => (raw: unknown): string | null => cleanText(field(raw, 'summary'), max)

export function parseStory(raw: unknown): string | null {
  return cleanText(field(raw, 'story'), 700)
}

export function parseTerm(raw: unknown): ExplainTermResult | null {
  const explanation = cleanText(field(raw, 'explanation'), 500)
  const known = field(raw, 'known')
  if (!explanation || typeof known !== 'boolean') return null
  return { explanation, known }
}

export function parseAlertWhy(raw: unknown): ExplainAlertResult | null {
  const why = cleanText(field(raw, 'why'), 220)
  const basis = field(raw, 'basis')
  if (!why || (basis !== 'radio' && basis !== 'weather' && basis !== 'none')) return null
  return { why, basis }
}

export function parseCatchUp(raw: unknown): { summary: string; highlights: string[] } | null {
  const summary = cleanText(field(raw, 'summary'), 400)
  const list = field(raw, 'highlights')
  if (!summary || !Array.isArray(list)) return null
  return { summary, highlights: list.map((h) => cleanText(h, 200)).filter((h): h is string => !!h).slice(0, 5) }
}

/**
 * Facts must come back under ids we sent; anything else (an invented fact)
 * is thrown away, and so is a repeat of an id.
 */
export function parseFacts(allowed: ReadonlySet<string>) {
  return (raw: unknown): { id: string; text: string }[] | null => {
    const list = field(raw, 'facts')
    if (!Array.isArray(list)) return null
    const seen = new Set<string>()
    const out: { id: string; text: string }[] = []
    for (const f of list) {
      const id = field(f, 'id')
      const text = cleanText(field(f, 'text'), 220)
      if (typeof id !== 'string' || !allowed.has(id) || seen.has(id) || !text) continue
      seen.add(id)
      out.push({ id, text })
    }
    return out.length ? out.slice(0, 3) : null
  }
}
