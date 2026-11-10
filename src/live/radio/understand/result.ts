/**
 * Checking what the model sent back before anything is shown: the right
 * shape, sane lengths, a cleaned call that is still the same call (not a
 * different or invented one), and instructions that normalise.
 */
import type { RadioCleanupResult } from '../../../api/ai/tasks/radioCleanup'
import type { Speaker } from '../callsigns'
import { normaliseInstruction, normCallsign, type Instruction } from './instructions'

/** What the app keeps per call. */
export type Understanding = {
  /** Transmission id. */
  id: string
  /** The cleaned call, or null when the model's version was rejected (keep showing the raw text). */
  cleaned: string | null
  /** Plain-English explanation; '' when there is nothing to explain. */
  plain: string
  /** The model's speaker when it was sure enough, else null (the rules' guess stands). */
  speaker: Speaker | null
  speakerConfidence: number
  callsigns: string[]
  instructions: Instruction[]
}

/** Below this the model's speaker is ignored. */
export const SPEAKER_MIN_CONFIDENCE = 0.7

const words = (s: string) => s.toLowerCase().match(/[a-z]+|\d/g) ?? []

/**
 * How much of the raw call's wording survives in the cleaned one (0–1).
 * Numbers turned into digits change the words, so digits and number words
 * are left out of the comparison.
 */
export function overlap(raw: string, cleaned: string): number {
  const NUM = /^(\d|zero|oh|one|two|three|tree|four|fower|five|fife|six|seven|eight|nine|niner|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|point|decimal)$/
  const a = words(raw).filter((w) => !NUM.test(w) && w.length > 2)
  if (a.length < 3) return 1
  const b = new Set(words(cleaned))
  return a.filter((w) => b.has(w)).length / a.length
}

/** The model's answer for a call, checked; null when it isn't usable at all. */
export function parseCleanup(id: string, raw: string, result: unknown, runways: string[] = []): Understanding | null {
  if (!result || typeof result !== 'object') return null
  const r = result as Partial<RadioCleanupResult>
  if (typeof r.cleaned !== 'string' || typeof r.plain !== 'string') return null
  let cleaned: string | null = r.cleaned.replace(/\s+/g, ' ').trim()
  // A cleaned call far longer than what was said, or sharing little of its wording, is not a cleanup.
  if (!cleaned || cleaned.length > raw.length * 2 + 40 || overlap(raw, cleaned) < 0.4) cleaned = null
  else if (cleaned === raw.trim()) cleaned = null
  const plain = r.plain.replace(/\s+/g, ' ').trim().slice(0, 240)
  const conf = typeof r.speakerConfidence === 'number' && Number.isFinite(r.speakerConfidence) ? Math.max(0, Math.min(1, r.speakerConfidence > 1 ? r.speakerConfidence / 100 : r.speakerConfidence)) : 0
  const speaker: Speaker | null = conf >= SPEAKER_MIN_CONFIDENCE ? (r.speaker === 'atc' ? 'controller' : r.speaker === 'pilot' ? 'pilot' : null) : null
  const callsigns = [...new Set((Array.isArray(r.callsigns) ? r.callsigns : []).map(normCallsign).filter((c): c is string => !!c))].slice(0, 6)
  const instructions = (Array.isArray(r.instructions) ? r.instructions : [])
    .slice(0, 8)
    .map((x) => normaliseInstruction(x, runways))
    .filter((x): x is Instruction => !!x)
  return { id, cleaned, plain, speaker, speakerConfidence: conf, callsigns, instructions }
}
