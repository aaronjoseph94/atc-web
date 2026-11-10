/**
 * Conversations by aircraft: every call to or from one flight, in order, and
 * a one-line story of what it was told ("Pushback → taxi via A, B → hold
 * short 4L → cleared for takeoff 4L"), built from the extracted instructions
 * with no further AI.
 */
import type { Transmission } from '../radioStore'
import { stepText, type Instruction } from './instructions'
import type { StoredUnderstanding } from './store'

/** A step equal to one of this many before it is a repeat (a read-back), not news. */
const REPEAT_WINDOW = 3

export type ThreadCall = Pick<Transmission, 'id' | 'at' | 'icao24' | 'callsigns'>

export type Thread<C extends ThreadCall = ThreadCall> = { icao24: string; callsign: string; calls: C[]; lastAt: number }

/** Aircraft a call concerns. */
export function callAircraftIds(c: ThreadCall): string[] {
  return [...new Set([c.icao24, ...c.callsigns.map((x) => x.icao24)].filter((x): x is string => !!x))]
}

/** Calls grouped by aircraft, most recently active first; a call naming two aircraft is in both threads. */
export function groupThreads<C extends ThreadCall>(calls: C[]): Thread<C>[] {
  const by = new Map<string, Thread<C>>()
  for (const c of [...calls].sort((a, b) => a.at - b.at)) {
    for (const id of callAircraftIds(c)) {
      let t = by.get(id)
      if (!t) {
        t = { icao24: id, callsign: c.callsigns.find((x) => x.icao24 === id)?.callsign ?? id.toUpperCase(), calls: [], lastAt: 0 }
        by.set(id, t)
      }
      t.calls.push(c)
      t.lastAt = c.at
    }
  }
  return [...by.values()].sort((a, b) => b.lastAt - a.lastAt)
}

/** The instructions in one understood call that were for this aircraft. */
export function instructionsFor(u: Pick<StoredUnderstanding, 'instructions' | 'targets'>, icao24: string): Instruction[] {
  return u.instructions.filter((_, i) => u.targets[i] === icao24)
}

/**
 * The flight's story so far, or null when no instruction was understood.
 * Read-backs repeat the instructions, so a step the story has just told is
 * dropped. Long stories keep their latest steps.
 */
export function threadStory(calls: ThreadCall[], results: Record<string, Pick<StoredUnderstanding, 'instructions' | 'targets'> | undefined>, icao24: string, maxSteps = 7): string | null {
  const steps: string[] = []
  for (const c of [...calls].sort((a, b) => a.at - b.at)) {
    const u = results[c.id]
    if (!u) continue
    for (const i of instructionsFor(u, icao24)) {
      const s = stepText(i)
      if (s && !steps.slice(-REPEAT_WINDOW).includes(s)) steps.push(s)
    }
  }
  if (!steps.length) return null
  const shown = steps.length > maxSteps ? ['…', ...steps.slice(-maxSteps)] : steps
  const text = shown.join(' → ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
