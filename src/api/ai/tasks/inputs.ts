/**
 * Small helpers the insight tasks use to turn the browser's input into a
 * prompt safely: everything is trimmed, length-capped and type-checked here,
 * so a malformed or oversized request becomes a clear 400 instead of a
 * confusing prompt.
 */

/** A string, single-spaced and cut to `max` characters; `''` for anything else. */
export function str(v: unknown, max: number): string {
  if (typeof v !== 'string' && typeof v !== 'number') return ''
  const s = String(v).replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** A required string; throws (→ 400) when missing. */
export function need(v: unknown, max: number, name: string): string {
  const s = str(v, max)
  if (!s) throw new Error(`Missing ${name}`)
  return s
}

/** A finite number or null. */
export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** An array (or nothing), capped to its last `max` items. */
export function arr(v: unknown, max: number): unknown[] {
  return Array.isArray(v) ? v.slice(-max) : []
}

/** The plain object or an empty one. */
export function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** `key: value` lines for whatever is present, so the prompt never shows "null". */
export function facts(pairs: [string, unknown][]): string {
  return pairs
    .filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
    .join('\n')
}

/** A JSON-schema object with every property required and nothing else allowed. */
export function objectSchema(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }
}
