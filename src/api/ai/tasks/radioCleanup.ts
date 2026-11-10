/**
 * One live radio call in, a better version of it out: the transcript tidied
 * into ATC phraseology (callsigns matched to the traffic actually around,
 * runway and taxiway names, numbers written the way controllers write them),
 * a plain-English line for people who don't speak radio, who was talking,
 * and the instructions in it as data.
 *
 * One request per transmission. The browser sends the call with a little
 * context (the last few calls on the channel, callsigns nearby, the airport's
 * runways and taxiways, which position this is), capped at about 2 KB.
 */
import type { AiTask } from '../tasks'

export type RadioCleanupInput = {
  /** The call as the speech recogniser heard it. */
  text: string
  /** Airport code, its name, and the position: `{ airport: 'JFK', name: 'New York JFK', role: 'TWR', label: 'Tower', mhz: 119.1 }`. */
  station: { airport: string; name: string; role: string; label: string; mhz: number | null }
  /** The calls just before on this channel, oldest first (already cleaned where possible). */
  recent: { speaker: 'atc' | 'pilot' | 'unknown'; text: string }[]
  /** Callsigns of aircraft near the airport: `DAL288 (Delta 288)`. */
  traffic: string[]
  /** Runway idents: `4L`, `22R`. */
  runways: string[]
  /** Taxiway names: `A`, `B`, `K4`. */
  taxiways: string[]
  /** What the app's own rules guessed: speaker and callsigns. */
  guess: { speaker: 'atc' | 'pilot' | 'unknown'; callsigns: string[] }
}

export const INSTRUCTION_TYPES = ['altitude', 'heading', 'speed', 'squawk', 'handoff', 'runway', 'taxi', 'pushback', 'other'] as const

/** One instruction as the model reports it; the browser normalises and checks it (src/live/radio/understand/instructions.ts). */
export type RawInstruction = {
  type: (typeof INSTRUCTION_TYPES)[number]
  /** Callsign it is addressed to, ICAO style (`DAL288`), or ''. */
  callsign: string
  /** climb | descend | maintain; left | right | fly; reduce | increase | maintain; land | takeoff | luaw | hold_short | cross | go_around | exit; contact | monitor; taxi; pushback; squawk. */
  action: string
  /** Altitude (`5000`, `FL240`), heading (`270`), speed (`210`), squawk (`4721`), frequency (`124.75`); else ''. */
  value: string
  /** Handoff: the facility (`Departure`, `New York Approach`, `Ground`); else ''. */
  facility: string
  /** Runway it concerns (`31L`), or ''. */
  runway: string
  /** Taxi: taxiways in order (`["A", "B"]`). */
  route: string[]
}

export type RadioCleanupResult = {
  cleaned: string
  plain: string
  speaker: 'atc' | 'pilot' | 'unknown'
  speakerConfidence: number
  callsigns: string[]
  instructions: RawInstruction[]
}

const str = { type: 'string' }

export const RADIO_CLEANUP_SCHEMA = {
  type: 'object',
  properties: {
    cleaned: str,
    plain: str,
    speaker: { type: 'string', enum: ['atc', 'pilot', 'unknown'] },
    speakerConfidence: { type: 'number' },
    callsigns: { type: 'array', items: str },
    instructions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...INSTRUCTION_TYPES] },
          callsign: str,
          action: str,
          value: str,
          facility: str,
          runway: str,
          route: { type: 'array', items: str },
        },
        required: ['type', 'callsign', 'action', 'value', 'facility', 'runway', 'route'],
        additionalProperties: false,
      },
    },
  },
  required: ['cleaned', 'plain', 'speaker', 'speakerConfidence', 'callsigns', 'instructions'],
  additionalProperties: false,
} as const

/** Largest input accepted, in characters of JSON (the browser keeps it under ~2 KB). */
export const RADIO_CLEANUP_MAX_INPUT = 2600

const SYSTEM = `You clean up machine transcripts of live air traffic control radio calls and explain them.

You get one call as a speech recogniser heard it, plus context: the airport and controller position (TWR tower, GND ground, CLD clearance delivery, APP approach, DEP departure), the last few calls on the channel, callsigns of aircraft near the airport, and the airport's runways and taxiways.

Return:
- cleaned: the call corrected into standard ATC phraseology as it would be written in a transcript. Fix misheard words using the context: match callsigns to the listed traffic (write the airline telephony and number, e.g. "Delta 288", "JetBlue 1407", "November 1818 Charlie" as "N1818C"), runways to the listed runways ("31 left" -> "31L"), taxiways to the listed taxiway names (phonetic letters stay words when said as words, e.g. "taxi via Alpha, Bravo"). Write numbers as digits where controllers write digits: flight numbers, runways, headings ("heading 270"), altitudes ("5,000", "flight level 240"), speeds, squawk codes, frequencies ("124.75"), altimeter ("altimeter 29.92"). Keep everything that was said; do not add instructions that were not said; do not invent words for parts that are unintelligible (leave them as heard). If the text is not a radio call (noise, music, an automated broadcast), return it unchanged.
- plain: one short sentence in everyday English saying what the call means for a non-pilot, naming the aircraft by callsign ("Delta 288 may enter runway 31L and wait there for takeoff clearance."). No jargon. Under 25 words. Empty string if the call has no meaning to explain.
- speaker: who transmitted. "atc" when the controller speaks (usually starts with the aircraft callsign and gives instructions), "pilot" when an aircraft speaks (readbacks, requests, check-ins, usually ending with its callsign or starting with the facility name), "unknown" if you cannot tell. speakerConfidence from 0 to 1.
- callsigns: every aircraft callsign in the call, ICAO style (DAL288, JBU1407, N1818C).
- instructions: every ATC instruction or clearance in the call (also those read back by a pilot), in order. Fields:
  type: altitude | heading | speed | squawk | handoff | runway | taxi | pushback | other
  callsign: who it is for, ICAO style, or ""
  action: altitude climb|descend|maintain; heading left|right|fly; speed reduce|increase|maintain; runway land|takeoff|luaw|hold_short|cross|go_around|exit; handoff contact|monitor; taxi taxi; pushback pushback; squawk squawk; other: a few words
  value: altitude in feet ("5000") or flight level ("FL240"); heading in degrees ("270"); speed in knots ("210"); squawk code ("4721"); handoff frequency in MHz ("124.75"); else ""
  facility: for handoffs the facility named ("Departure", "Ground", "New York Approach"), else ""
  runway: the runway it concerns ("31L"), else ""
  route: for taxi, the taxiways in order as names ("A", "B", "K4"); else []
Reply with JSON only.`

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '')
const list = (a: unknown, n: number, len = 40) => (Array.isArray(a) ? a.map((x) => clip(x, len)).filter(Boolean).slice(0, n) : [])

/** The changing part of the request, as compact text. Throws on input without a call. */
export function radioCleanupPrompt(input: RadioCleanupInput): string {
  const text = clip(input?.text, 600)
  if (!text) throw new Error('No call text')
  const st = input.station ?? ({} as RadioCleanupInput['station'])
  const lines = [
    `Airport: ${clip(st.airport, 8)}${st.name ? ` (${clip(st.name, 60)})` : ''}`,
    `Position: ${clip(st.role, 6) || 'TWR'}${st.label ? `, ${clip(st.label, 60)}` : ''}${typeof st.mhz === 'number' ? `, ${st.mhz}` : ''}`,
  ]
  const runways = list(input.runways, 16, 4)
  if (runways.length) lines.push(`Runways: ${runways.join(', ')}`)
  const taxiways = list(input.taxiways, 80, 5)
  if (taxiways.length) lines.push(`Taxiways: ${taxiways.join(', ')}`)
  const traffic = list(input.traffic, 30, 40)
  if (traffic.length) lines.push(`Traffic nearby: ${traffic.join('; ')}`)
  const recent = Array.isArray(input.recent) ? input.recent.slice(-5) : []
  if (recent.length) {
    lines.push('Previous calls on this channel (oldest first):')
    for (const r of recent) lines.push(`- [${r?.speaker === 'atc' || r?.speaker === 'pilot' ? r.speaker : '?'}] ${clip(r?.text, 240)}`)
  }
  const g = input.guess
  if (g) lines.push(`Rule-based guess: speaker ${g.speaker === 'atc' || g.speaker === 'pilot' ? g.speaker : 'unknown'}${list(g.callsigns, 6, 10).length ? `, callsigns ${list(g.callsigns, 6, 10).join(', ')}` : ''}`)
  lines.push('', `Call as heard: "${text}"`)
  return lines.join('\n')
}

export const radioCleanup: AiTask<RadioCleanupInput> = {
  name: 'radioCleanup',
  system: SYSTEM,
  prompt: radioCleanupPrompt,
  schema: RADIO_CLEANUP_SCHEMA as unknown as Record<string, unknown>,
  effort: 'low',
  maxTokens: 2500,
  timeoutMs: 25_000,
  // Every call is different: nothing to gain from the edge cache.
  cacheS: 0,
  maxInputChars: RADIO_CLEANUP_MAX_INPUT,
}
