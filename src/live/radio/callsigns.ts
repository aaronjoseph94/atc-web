/**
 * Finds who is being talked to in a radio transcript.
 *
 * "Delta two eighty-eight, Tower, runway 4 left, cleared to land" names
 * DAL288; "November one eight one eight Charlie" is N1818C; "Golf Echo
 * November Whiskey" is the Canadian C-GENW. Speech recognition writes the
 * same call in many ways (digits, number words, hyphens, "oh" for zero), so
 * everything is folded into tokens first and numbers are read the way
 * pilots say them: in pairs, digit by digit, or with "hundred".
 *
 * Pure and synchronous: no knowledge of which aircraft are actually around.
 * `match.ts` pairs these mentions with live traffic.
 */
import { MAX_TELEPHONY_WORDS, SPOKEN_TO_PREFIX, TELEPHONY, telephonyKey } from './telephony'

export type MentionKind = 'airline' | 'tail' | 'partial-tail'

export type CallsignMention = {
  kind: MentionKind
  /** Normalised callsign: `DAL288`, `BAW14K`, `N1818C`, `CGENW`; for partial tails just what was said (`18C`). */
  callsign: string
  /** ICAO airline prefix for airline calls. */
  prefix?: string
  /** Flight number digits for airline calls. */
  digits?: string
  /** Trailing letters spoken after the number ("one four kilo" → `K`). */
  suffix?: string
  /** First and last token of the mention, so speaker rules can tell where in the call it sat. */
  start: number
  end: number
  /** Character range in the original text. */
  from: number
  to: number
  /** Said as "heavy" or "super". */
  heavy: boolean
  /**
   * How much to distrust this mention (0 = not at all). The airline word
   * doubles as a taxiway letter ("Delta") and sat where a taxi instruction
   * would ("hold short of Delta 3"), so it may not be a callsign at all.
   */
  doubt: number
}

type Token = { w: string; from: number; to: number; punct: boolean }

/** Split into lowercase word tokens and punctuation, keeping character offsets. */
export function tokenize(text: string): Token[] {
  const out: Token[] = []
  for (const m of text.matchAll(/[A-Za-z0-9]+|[,.;:!?]/g)) {
    const w = m[0].toLowerCase()
    out.push({ w, from: m.index, to: m.index + m[0].length, punct: /^[,.;:!?]$/.test(w) })
  }
  return out
}

const DIGIT: Record<string, number> = {
  zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, tree: 3, four: 4, fower: 4, five: 5, fife: 5,
  six: 6, seven: 7, eight: 8, nine: 9, niner: 9,
}
const TEEN: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Record<string, number> = { twenty: 2, thirty: 3, forty: 4, fourty: 4, fifty: 5, sixty: 6, seventy: 7, eighty: 8, ninety: 9 }

/** ICAO spelling alphabet, plus the common misspellings recognisers produce. */
const PHONETIC: Record<string, string> = {
  alpha: 'A', alfa: 'A', bravo: 'B', charlie: 'C', delta: 'D', echo: 'E', foxtrot: 'F', fox: 'F', golf: 'G', hotel: 'H',
  india: 'I', juliet: 'J', juliett: 'J', kilo: 'K', lima: 'L', mike: 'M', november: 'N', oscar: 'O', papa: 'P', quebec: 'Q',
  romeo: 'R', sierra: 'S', tango: 'T', uniform: 'U', victor: 'V', whiskey: 'W', whisky: 'W', xray: 'X', yankee: 'Y', zulu: 'Z',
}

/** Words that come right before a light aircraft's abbreviated callsign ("Cessna eight Charlie"). */
const GA_TYPES = new Set([
  'cessna', 'skyhawk', 'skylane', 'piper', 'cherokee', 'warrior', 'archer', 'arrow', 'seneca', 'cirrus', 'bonanza', 'baron', 'beech',
  'citation', 'gulfstream', 'learjet', 'lear', 'challenger', 'falcon', 'kingair', 'phenom', 'pilatus', 'diamond', 'mooney', 'hawker',
  'global', 'embraer', 'helicopter', 'lifeguard', 'medevac', 'experimental',
])

/** Words that put a taxiway letter in front of a number: "via Delta 3", "short of Delta". */
const TAXI_CONTEXT = new Set(['via', 'on', 'onto', 'taxiway', 'of', 'cross', 'crossing', 'at', 'exit', 'exiting', 'join', 'left', 'right', 'then', 'past'])

/** Words that end a callsign without being part of it. */
const WEIGHT = new Set(['heavy', 'super'])

type NumberRead = { digits: string; letters: string; next: number }

/**
 * Read a spoken number starting at token `i`: "two eighty eight" → 288,
 * "twenty two ninety two" → 2292, "fourteen oh seven" → 1407, "1-8-1-8" → 1818.
 * Phonetic letters directly after it become a suffix ("one four kilo" → 14 + K)
 * when `letters` allows. Returns null when no number starts here.
 */
export function readNumber(tokens: Token[], i: number, maxDigits = 5, letters = 2): NumberRead | null {
  let digits = ''
  let j = i
  // Digits a "hundred"/"thousand" left as zeros, which a following "five" can fill in.
  let pad = 0
  const put = (s: string) => {
    if (pad && s.length <= pad) {
      digits = digits.slice(0, digits.length - s.length) + s
      pad = 0
    } else {
      digits += s
      pad = 0
    }
  }
  let suffix = ''
  while (j < tokens.length) {
    const t = tokens[j]
    if (t.punct) break
    const w = t.w
    if (/^\d+$/.test(w)) {
      put(w)
      j++
    } else if (/^\d+[a-z]{1,2}$/.test(w) && letters > 0) {
      // "14k", "1818c": recognisers sometimes glue the suffix letters on.
      const m = /^(\d+)([a-z]+)$/.exec(w)!
      put(m[1])
      suffix = m[2].toUpperCase()
      j++
      break
    } else if (w in DIGIT) {
      put(String(DIGIT[w]))
      j++
    } else if (w in TEEN) {
      put(String(TEEN[w]))
      j++
    } else if (w in TENS) {
      const unit = tokens[j + 1] && !tokens[j + 1].punct ? DIGIT[tokens[j + 1].w] : undefined
      if (unit != null && unit > 0 && tokens[j + 1].w !== 'oh') {
        put(String(TENS[w] * 10 + unit))
        j += 2
      } else {
        put(`${TENS[w]}0`)
        j++
      }
    } else if ((w === 'hundred' || w === 'thousand') && digits) {
      const zeros = w === 'hundred' ? 2 : 3
      digits += '0'.repeat(zeros)
      pad = zeros
      j++
    } else break
    if (digits.length > maxDigits) return null
  }
  if (!digits) return null
  // Spelled-out suffix letters: "one four kilo".
  if (!suffix && letters > 0) {
    const run = readLetters(tokens, j, letters)
    if (run.letters) {
      suffix = run.letters
      j = run.next
    }
  }
  return { digits, letters: suffix, next: j }
}

/** Read consecutive spelling-alphabet words from `i`. */
function readLetters(tokens: Token[], i: number, max: number): { letters: string; next: number } {
  let s = ''
  let j = i
  while (j < tokens.length && s.length < max && !tokens[j].punct && PHONETIC[tokens[j].w]) {
    s += PHONETIC[tokens[j].w]
    j++
  }
  return { letters: s, next: j }
}

function skipWeight(tokens: Token[], j: number): { next: number; heavy: boolean } {
  if (tokens[j] && WEIGHT.has(tokens[j].w)) return { next: j + 1, heavy: true }
  return { next: j, heavy: false }
}

/** Every callsign named in a transcript, in the order they were said. */
export function findCallsigns(text: string): CallsignMention[] {
  const tokens = tokenize(text)
  const out: CallsignMention[] = []
  const span = (start: number, endExclusive: number) => ({ start, end: endExclusive - 1, from: tokens[start].from, to: tokens[endExclusive - 1].to })

  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (t.punct) {
      i++
      continue
    }

    // Written out already: "DAL288", "N1818C", "C-GENW" / "CGENW".
    const direct = /^([a-z]{3})(\d{1,4})([a-z]{0,2})$/.exec(t.w)
    if (direct && TELEPHONY[direct[1].toUpperCase()]) {
      const w = skipWeight(tokens, i + 1)
      const prefix = direct[1].toUpperCase()
      out.push({ kind: 'airline', callsign: `${prefix}${direct[2]}${direct[3].toUpperCase()}`, prefix, digits: direct[2], suffix: direct[3].toUpperCase() || undefined, ...span(i, i + 1), heavy: w.heavy, doubt: 0 })
      i = w.next
      continue
    }
    if (/^n[1-9]\d{0,4}[a-z]{0,2}$/.test(t.w) && t.w.length <= 6) {
      out.push({ kind: 'tail', callsign: t.w.toUpperCase(), ...span(i, i + 1), heavy: false, doubt: 0 })
      i++
      continue
    }
    if (/^c[fgi][a-z]{3}$/.test(t.w) || (t.w === 'c' && /^[fgi][a-z]{3}$/.test(tokens[i + 1]?.w ?? ''))) {
      const reg = t.w === 'c' ? `c${tokens[i + 1].w}` : t.w
      const end = t.w === 'c' ? i + 2 : i + 1
      out.push({ kind: 'tail', callsign: reg.toUpperCase(), ...span(i, end), heavy: false, doubt: 0 })
      i = end
      continue
    }

    // Airline telephony followed by a flight number: "Delta two eighty eight".
    let found = false
    for (let n = Math.min(MAX_TELEPHONY_WORDS, tokens.length - i); n >= 1 && !found; n--) {
      const words = tokens.slice(i, i + n)
      if (words.some((x) => x.punct)) continue
      const prefix = SPOKEN_TO_PREFIX.get(telephonyKey(words.map((x) => x.w).join('')))
      if (!prefix) continue
      const num = readNumber(tokens, i + n, 4, 2)
      if (!num) continue
      const w = skipWeight(tokens, num.next)
      const prev = tokens[i - 1]
      // "hold short of Delta 3" is a taxiway, not Delta Air Lines flight 3.
      const letterWord = !!PHONETIC[words[0].w] && n === 1
      const doubt = letterWord ? (prev && !prev.punct && TAXI_CONTEXT.has(prev.w) ? 0.3 : 0) + (num.digits.length === 1 ? 0.2 : 0) : 0
      out.push({
        kind: 'airline',
        callsign: `${prefix}${num.digits.replace(/^0+(?=\d)/, '')}${num.letters}`,
        prefix,
        digits: num.digits.replace(/^0+(?=\d)/, ''),
        suffix: num.letters || undefined,
        ...span(i, num.next),
        heavy: w.heavy,
        doubt,
      })
      i = w.next
      found = true
    }
    if (found) continue

    // US registration: "November one eight one eight Charlie".
    if (t.w === 'november') {
      const num = readNumber(tokens, i + 1, 5, 2)
      if (num && num.digits[0] !== '0' && num.digits.length + num.letters.length <= 5) {
        const body = `${num.digits}${num.letters}`
        out.push({ kind: body.length >= 3 ? 'tail' : 'partial-tail', callsign: body.length >= 3 ? `N${body}` : body, ...span(i, num.next), heavy: false, doubt: 0 })
        i = num.next
        continue
      }
    }

    // Canadian registration in the spelling alphabet: "(Charlie) Golf Echo November Whiskey".
    if (PHONETIC[t.w]) {
      const run = readLetters(tokens, i, 5)
      const letters = run.letters
      const reg = letters.length === 5 && letters[0] === 'C' && /^[FGI]/.test(letters.slice(1)) ? letters : letters.length === 4 && /^[FGI]/.test(letters) ? `C${letters}` : null
      if (reg) {
        out.push({ kind: 'tail', callsign: reg, ...span(i, run.next), heavy: false, doubt: 0 })
        i = run.next
        continue
      }
    }

    // Light aircraft by type and the last few characters: "Cessna eight Charlie", "Citation 123AB".
    const typeWords = t.w === 'king' && tokens[i + 1]?.w === 'air' ? 2 : GA_TYPES.has(t.w) ? 1 : 0
    if (typeWords) {
      const num = readNumber(tokens, i + typeWords, 5, 2)
      if (num && num.digits.length + num.letters.length >= 2) {
        const body = `${num.digits}${num.letters}`
        out.push({ kind: 'partial-tail', callsign: body, ...span(i, num.next), heavy: false, doubt: 0 })
        i = num.next
        continue
      }
      const run = readLetters(tokens, i + typeWords, 5)
      if (run.letters.length >= 3) {
        out.push({ kind: 'partial-tail', callsign: run.letters, ...span(i, run.next), heavy: false, doubt: 0 })
        i = run.next
        continue
      }
    }
    i++
  }
  return out
}

// ---------------------------------------------------------------------------
// Who is speaking
// ---------------------------------------------------------------------------

export type Speaker = 'controller' | 'pilot'

/** Facility words: how a pilot opens a call ("Ground, …") and how a controller signs ("…, Tower"). */
const FACILITY = new Set(['tower', 'ground', 'clearance', 'delivery', 'approach', 'departure', 'center', 'centre', 'ramp', 'apron', 'metering', 'director', 'arrival', 'radio', 'traffic', 'unicom', 'control'])
const FILLER = new Set(['uh', 'um', 'er', 'ah', 'and', 'okay', 'ok', 'alright', 'roger', 'yeah', 'hi', 'hello', 'morning', 'afternoon', 'evening', 'good'])

const PILOT_CUES: [RegExp, number][] = [
  [/\bwith you\b/, 2],
  [/\b(request|requesting)\b/, 1.5],
  [/\b(we'?re|we are|we'?ll|we have|we got|we need|looking for|unable)\b/, 1.5],
  [/\bwith (information )?(alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|juliet|kilo|lima|mike|november|oscar|papa|quebec|romeo|sierra|tango|uniform|victor|whiskey|x-?ray|yankee|zulu)\b/, 2],
  [/\b(gate \w+|at the gate|stand \w+)\b/, 1.5],
  [/\b(ready|holding short|push ?back|for (the )?departure|on the go)\b/, 1],
  [/\b(wilco|will do|thanks|thank you)\b/, 0.5],
]
const CONTROLLER_CUES: [RegExp, number][] = [
  [/\bwind \d|\bwinds? (calm|\d)/, 2],
  [/\b(cleared|clear) (to land|for take ?off|for departure|to cross|as filed)\b/, 1.5],
  [/\b(line up and wait|position and hold)\b/, 1.5],
  [/\b(contact|monitor) (ground|tower|departure|approach|center|ramp|clearance)\b/, 1.5],
  [/\b(taxi|hold short|give way|follow|expect|caution|traffic|go ahead|say again|squawk|advise|number \d|turn (left|right))\b/, 1],
  [/\b(climb|descend|maintain|reduce|increase|fly heading)\b/, 0.75],
]

/**
 * Controller or pilot, from the words alone. Controllers lead with the
 * callsign ("KLM 678 heavy, Tower, line up and wait"), pilots open with the
 * facility ("Ground, hello, WestJet 1501 …") or end a readback with their
 * own callsign ("… cleared to land 4 left, Delta 288"). Phraseology breaks
 * ties. Null when nothing points either way.
 */
export function guessSpeaker(text: string, mentions: CallsignMention[] = findCallsigns(text)): Speaker | null {
  const tokens = tokenize(text)
  const words = tokens.filter((t) => !t.punct)
  if (!words.length) return null
  const lower = text.toLowerCase()
  let pilot = 0
  let controller = 0

  // Index of the first word that isn't a filler.
  let lead = 0
  while (lead < tokens.length && (tokens[lead].punct || FILLER.has(tokens[lead].w))) lead++
  // Last token that isn't punctuation or a weight word.
  let tail = tokens.length - 1
  while (tail >= 0 && (tokens[tail].punct || WEIGHT.has(tokens[tail].w))) tail--

  const first = mentions[0]
  const last = mentions[mentions.length - 1]
  // "Kennedy Tower, …" / "Ground, …": the pilot is calling the facility.
  const opener = tokens.slice(lead, lead + 3).findIndex((t) => !t.punct && FACILITY.has(t.w))
  if (opener >= 0 && (!first || first.start > lead + opener)) pilot += 3
  if (first && first.start <= lead) {
    controller += 2
    // "Flair 809, Clearance": a controller answering, naming their position.
    const after = tokens.slice(first.end + 1, first.end + 5).find((t) => !t.punct && !WEIGHT.has(t.w))
    if (after && FACILITY.has(after.w)) controller += 1.5
  }
  if (last && last.end >= tail && !(first && first.start <= lead && mentions.length === 1)) pilot += 3

  // Hesitation before the first word is far more often a pilot than a controller.
  if (/^(uh|um|er|ah)\b/.test(tokens[0]?.w ?? '')) pilot += 1
  for (const [re, w] of PILOT_CUES) if (re.test(lower)) pilot += w
  for (const [re, w] of CONTROLLER_CUES) if (re.test(lower)) controller += w

  if (pilot === controller) return null
  return pilot > controller ? 'pilot' : 'controller'
}

/** How a callsign is usually written in a transcript, for steering recognition: `DAL288` → "Delta 288". */
export function writtenCallsign(callsign: string): string | null {
  const m = /^([A-Z]{3})(\d{1,4}[A-Z]{0,2})$/.exec(callsign.toUpperCase().trim())
  if (m) {
    const name = TELEPHONY[m[1]]?.[0]
    return name ? `${name} ${m[2]}` : null
  }
  if (/^N[1-9][0-9A-Z]{1,4}$/.test(callsign.toUpperCase())) return callsign.toUpperCase()
  return null
}
