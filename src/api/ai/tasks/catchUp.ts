/**
 * "What did I miss?": a short recap of what happened at the airport while
 * the app was in the background, from the tower log and the radio calls
 * recorded in the meantime.
 */
import type { AiTask } from '../tasks'
import { arr, need, num, obj, objectSchema, str } from './inputs'

export type CatchUpInput = {
  airport: string
  awayMin: number
  counts: { takeoffs: number; landings: number; goArounds: number; emergencies: number; radioCalls: number }
  moments: { time: string; kind: string; text: string; radio?: string }[]
  runwayChanges: { time: string; text: string }[]
}

export type CatchUpResult = { summary: string; highlights: string[] }

export const catchUp: AiTask<CatchUpInput> = {
  name: 'catchUp',
  system: [
    'You recap what happened at an airport while someone was away from an air traffic control listening app.',
    'Return a one or two sentence "summary" (at most 45 words) of the overall picture (how busy, the runway situation), and up to four "highlights": the notable moments, most important first, each one short line (at most 18 words) starting with its time, e.g. "14:32 · United 1534 went around on 27L; the pilot reported wind shear."',
    'Emergencies, go-arounds, rejected takeoffs and runway changes are the highlights; ordinary takeoffs and landings are only counted. When a radio quote explains a moment, say so in plain words; otherwise do not guess a reason.',
    'Use only the data given. Never invent callsigns, reasons, numbers or times. If nothing notable happened, say so plainly and return an empty highlights list. Plain English, no markdown.',
  ].join('\n'),
  prompt: (input) => {
    const i = obj(input)
    const c = obj(i.counts)
    const moments = arr(i.moments, 24)
      .map(obj)
      .map((m) => `- ${str(m.time, 8)} [${str(m.kind, 16)}] ${str(m.text, 140)}${m.radio ? ` (radio: "${str(m.radio, 160)}")` : ''}`)
    const changes = arr(i.runwayChanges, 6)
      .map(obj)
      .map((m) => `- ${str(m.time, 8)} ${str(m.text, 120)}`)
    return [
      `Airport: ${need(i.airport, 8, 'airport')}`,
      `Away for: ${Math.round(num(i.awayMin) ?? 0)} minutes`,
      `Counts while away: ${num(c.takeoffs) ?? 0} takeoffs, ${num(c.landings) ?? 0} landings, ${num(c.goArounds) ?? 0} go-arounds, ${num(c.emergencies) ?? 0} emergencies, ${num(c.radioCalls) ?? 0} radio calls transcribed`,
      changes.length ? `Runway changes:\n${changes.join('\n')}` : 'Runway changes: none seen',
      moments.length ? `Moments (oldest first):\n${moments.join('\n')}` : 'Moments: none',
    ].join('\n')
  },
  schema: objectSchema({ summary: { type: 'string' }, highlights: { type: 'array', items: { type: 'string' } } }),
  effort: 'low',
  maxTokens: 3000,
  timeoutMs: 25_000,
  cacheS: 300,
  maxInputChars: 12_000,
}
