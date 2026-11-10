/**
 * The last few errors the page logged (console.error, uncaught errors and
 * rejected promises), kept in a small ring so a feedback report can say what
 * went wrong just before. Nothing leaves the browser unless the person sends
 * feedback; anything that looks like an API key is masked first.
 */

export const RING_SIZE = 15
const MAX_CHARS = 400

const ring: { at: number; message: string }[] = []
let installed = false

/** Mask Claude / OpenRouter keys and bearer tokens that may appear in an error message. */
export function redact(s: string): string {
  return s
    .replace(/sk-(ant|or)-[A-Za-z0-9_-]{8,}/g, 'sk-$1-•••')
    .replace(/(bearer\s+)[A-Za-z0-9._-]{12,}/gi, '$1•••')
    .replace(/(x-atc-[a-z]+-key["':\s]+)[^\s"',}]+/gi, '$1•••')
}

function text(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}`
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export function pushError(parts: unknown[], at = Date.now()) {
  const message = redact(parts.map(text).join(' ')).replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS)
  if (!message) return
  // A repeating error fills the ring with copies; keep one.
  if (ring.length && ring[ring.length - 1].message === message) return
  ring.push({ at, message })
  if (ring.length > RING_SIZE) ring.shift()
}

/** Oldest first, as `12:04:31 TypeError: …`. */
export function recentErrors(): string[] {
  return ring.map((e) => `${new Date(e.at).toISOString().slice(11, 19)} ${e.message}`)
}

export function clearErrors() {
  ring.length = 0
}

/** Start listening (once). Safe to call more than once. */
export function installErrorLog() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const original = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    pushError(args)
    original(...args)
  }
  window.addEventListener('error', (e) => pushError([e.error ?? e.message]))
  window.addEventListener('unhandledrejection', (e) => pushError(['Unhandled rejection:', e.reason]))
}
