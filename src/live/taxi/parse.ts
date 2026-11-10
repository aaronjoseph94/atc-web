/**
 * Reads taxi instructions out of a radio transcript.
 *
 * "JetBlue 1407, runway 31 left, taxi via Alpha, Bravo, hold short of 4 left"
 * becomes { runway: '31L', via: ['A', 'B'], holdShort: [runway 4L] }. Ground
 * controllers say the same thing many ways (phonetic words or bare letters,
 * "taxi to runway X via ..." or "runway X, taxi via ...", "continue on Alpha",
 * "right on Kilo", "follow the Delta"), and the recogniser adds its own
 * variety (digits or number words, "4L" or "four left"), so everything is
 * read from word tokens rather than with one big pattern.
 *
 * Pure and synchronous: which of these taxiways exist, and how they join, is
 * the router's business (`route.ts`).
 */
import { findCallsigns } from '../radio/callsigns'

export type HoldShort = { kind: 'runway' | 'taxiway'; ref: string }

export type TaxiClearance = {
  /** Runway to taxi to, normalised (`31L`, `4R`, `29`). */
  runway: string | null
  /** Taxiways in the order given (`A`, `B`, `K4`). */
  via: string[]
  /**
   * Indices `i` where `via[i]` and `via[i + 1]` were single letters said back
   * to back with no pause ("Kilo Alpha"): either two taxiways or one with a
   * double-letter name (`KA`). The router decides from what the airport has.
   */
  pairs: number[]
  /** Where to stop, in the order given. */
  holdShort: HoldShort[]
  /** Runways the aircraft may cross. */
  cross: string[]
  /** A destination other than a runway: `ramp`, `gate`, `spot 5`. */
  destination: string | null
  /** "follow the Delta": the traffic (or taxiway) word, as said. */
  follow: string | null
  /** `continue`: "continue on Alpha" with no new taxi clearance. */
  kind: 'taxi' | 'continue'
}

type Token = { w: string; punct: boolean; from: number; to: number }

const PHONETIC: Record<string, string> = {
  alpha: 'A', alfa: 'A', bravo: 'B', charlie: 'C', delta: 'D', echo: 'E', foxtrot: 'F', golf: 'G', hotel: 'H',
  india: 'I', juliet: 'J', juliett: 'J', kilo: 'K', lima: 'L', mike: 'M', november: 'N', oscar: 'O', papa: 'P', quebec: 'Q',
  romeo: 'R', sierra: 'S', tango: 'T', uniform: 'U', victor: 'V', whiskey: 'W', whisky: 'W', xray: 'X', yankee: 'Y', zulu: 'Z',
}
const DIGIT: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, tree: 3, four: 4, fower: 4, five: 5, fife: 5,
  six: 6, seven: 7, eight: 8, nine: 9, niner: 9,
}
const TEEN: Record<string, number> = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 }
const TENS: Record<string, number> = { twenty: 20, thirty: 30 }
const SIDE: Record<string, string> = { left: 'L', l: 'L', right: 'R', r: 'R', center: 'C', centre: 'C', c: 'C' }

/** Words that end a list of taxiways. */
const STOP = new Set([
  'hold', 'holding', 'cross', 'crossing', 'runway', 'rwy', 'contact', 'monitor', 'expect', 'give', 'follow', 'taxi', 'continue', 'cleared',
  'line', 'traffic', 'caution', 'behind', 'number', 'for', 'departure', 'ground', 'tower', 'when', 'until', 'report', 'advise', 'at',
])
/** Words that may sit between taxiways in a list. */
const JOINERS = new Set(['and', 'then', 'onto', 'on', 'to', 'via', 'taxiway', 'taxiways', 'twy', 'right', 'left', 'join', 'the', 'straight', 'ahead', 'along'])
/** Destinations that are not runways. */
const PLACES = new Set(['ramp', 'gate', 'gates', 'apron', 'terminal', 'spot', 'stand', 'pad', 'hangar', 'fbo', 'cargo', 'parking', 'deice', 'deicing', 'pads', 'base'])
/** Words after "follow the" that mean traffic, not a taxiway. */
const TRAFFIC = new Set(['company', 'airbus', 'boeing', 'embraer', 'regional', 'jet', 'heavy', 'traffic', 'aircraft', 'seven', 'triple', 'a', 'cessna', 'king', 'citation', 'dash', 'crj', 'md'])

function tokenize(text: string): Token[] {
  const out: Token[] = []
  for (const m of text.matchAll(/[A-Za-z0-9]+|[,.;:!?]/g)) {
    const w = m[0].toLowerCase()
    out.push({ w, punct: /^[,.;:!?]$/.test(w), from: m.index, to: m.index + m[0].length })
  }
  return out
}

/** `04L` → `4L`, `31 left` → `31L`. */
export function normalizeRunway(s: string): string {
  const m = /^0*(\d{1,2})\s*([LRC]?)$/i.exec(s.trim())
  return m ? `${m[1]}${m[2].toUpperCase()}` : s.toUpperCase()
}

/**
 * A runway number at `i`: "31L", "31 left", "three one left", "four", "thirty one right".
 * Needs a side word or the word "runway" before it unless `bare` is set.
 */
function readRunway(t: Token[], i: number): { ident: string; next: number } | null {
  let j = i
  let num = ''
  const tok = t[j]
  if (!tok || tok.punct) return null
  const glued = /^0?(\d{1,2})([lrc])?$/.exec(tok.w)
  if (glued) {
    num = glued[1]
    j++
    if (glued[2]) return valid(num, glued[2].toUpperCase(), j)
  } else if (TENS[tok.w] != null) {
    const unit = t[j + 1] && DIGIT[t[j + 1].w]
    num = String(TENS[tok.w] + (unit && unit < 10 ? unit : 0))
    j += num.endsWith('0') ? 1 : 2
  } else if (TEEN[tok.w] != null) {
    num = String(TEEN[tok.w])
    j++
  } else if (DIGIT[tok.w] != null) {
    num = String(DIGIT[tok.w])
    j++
    const second = t[j]
    if (second && !second.punct && DIGIT[second.w] != null) {
      num += String(DIGIT[second.w])
      j++
    } else if (second && /^\d$/.test(second.w)) {
      num += second.w
      j++
    }
  } else return null
  const side = t[j] && !t[j].punct ? SIDE[t[j].w] : undefined
  if (side && !(t[j].w.length === 1 && t[j + 1] && !t[j + 1].punct && PHONETIC[t[j + 1].w])) return valid(num, side, j + 1)
  return valid(num, '', j)

  function valid(n: string, s: string, next: number) {
    const v = Number(n)
    if (!(v >= 1 && v <= 36)) return null
    return { ident: `${v}${s}`, next }
  }
}

/** A taxiway name at `i`: "Alpha", "B", "K4", "Kilo 4", "Bravo one". */
function readTaxiway(t: Token[], i: number, bareLetters: boolean): { ref: string; letterOnly: boolean; next: number } | null {
  const tok = t[i]
  if (!tok || tok.punct) return null
  let letter: string | undefined = PHONETIC[tok.w]
  let digits = ''
  let j = i + 1
  if (!letter) {
    // "K4", "B1", "A10": written as one token by the recogniser.
    const m = /^([a-z])(\d{1,2})$/.exec(tok.w)
    if (m) return { ref: `${m[1].toUpperCase()}${m[2]}`, letterOnly: false, next: j }
    const pm = /^([a-z]+?)(\d{1,2})$/.exec(tok.w)
    if (pm && PHONETIC[pm[1]]) return { ref: `${PHONETIC[pm[1]]}${pm[2]}`, letterOnly: false, next: j }
    // Bare capital letters ("via A, B") only where a list is expected.
    if (bareLetters && /^[a-z]$/.test(tok.w) && !(tok.w === 'a' && t[j] && !t[j].punct && !PHONETIC[t[j].w] && !/^[a-z]$/.test(t[j].w) && !/^\d/.test(t[j].w))) letter = tok.w.toUpperCase()
    else return null
  }
  // A number straight after the letter is part of its name, unless it is a runway ("Kilo, 31 left").
  const nxt = t[j]
  if (nxt && !nxt.punct) {
    const after = t[j + 1]
    const isSide = after && !after.punct && SIDE[after.w] && after.w.length > 1
    if (/^\d{1,2}$/.test(nxt.w) && !isSide) {
      digits = String(Number(nxt.w))
      j++
    } else if (DIGIT[nxt.w] != null && nxt.w !== 'oh' && !isSide) {
      digits = String(DIGIT[nxt.w])
      j++
    } else if (TEEN[nxt.w] != null && !isSide) {
      digits = String(TEEN[nxt.w])
      j++
    }
  }
  return { ref: `${letter}${digits}`, letterOnly: !digits, next: j }
}

/** Character ranges of callsigns said in the call, so "Delta 288" isn't read as taxiway D. */
function callsignSpans(text: string): [number, number][] {
  return findCallsigns(text)
    .filter((m) => m.doubt < 0.3 && (m.kind === 'airline' || m.kind === 'tail' || m.kind === 'flight-number'))
    .map((m) => [m.from, m.to])
}

/** The taxi instruction in a transcript, or null when there is none. */
export function parseTaxi(text: string): TaxiClearance | null {
  if (!/\b(taxi|taxiing|via|continue|follow|hold short|holding short|right on|left on|turn (left|right))\b/i.test(text)) return null
  const spans = callsignSpans(text)
  // A callsign becomes a pause: it separates what came before from what follows.
  const tokens = tokenize(text).flatMap((tok) => (spans.some(([a, b]) => tok.from >= a && tok.to <= b) ? (spans.some(([a]) => a === tok.from) ? [{ w: ',', punct: true, from: tok.from, to: tok.to }] : []) : [tok]))
  const out: TaxiClearance = { runway: null, via: [], pairs: [], holdShort: [], cross: [], destination: null, follow: null, kind: 'taxi' }
  let sawTaxi = false
  let sawContinue = false
  // A runway named on its own, before we know whether it is the destination.
  let looseRunway: string | null = null
  let i = 0
  const w = (k: number) => tokens[k]?.w
  const isWord = (k: number, ...ws: string[]) => !!tokens[k] && !tokens[k].punct && ws.includes(tokens[k].w)

  /** Read a list of taxiways starting at `k`. */
  const readList = (k: number): number => {
    let lastLetterOnly = false
    let gap = true
    while (k < tokens.length) {
      const tok = tokens[k]
      if (tok.punct) {
        // A full stop ends the list; commas separate its items.
        if (tok.w !== ',') return k
        gap = true
        k++
        continue
      }
      if (STOP.has(tok.w)) return k
      if (JOINERS.has(tok.w)) {
        // "right on Kilo", "and then Bravo", "to Bravo": keep going, unless "to" names the destination.
        if (tok.w === 'to' && (readRunway(tokens, k + 1) || isWord(k + 1, 'runway', 'the') || PLACES.has(w(k + 1) ?? ''))) return k
        gap = true
        k++
        continue
      }
      const tw = readTaxiway(tokens, k, true)
      if (!tw) return k
      if (!gap && lastLetterOnly && tw.letterOnly) out.pairs.push(out.via.length - 1)
      out.via.push(tw.ref)
      lastLetterOnly = tw.letterOnly
      gap = false
      k = tw.next
    }
    return k
  }

  while (i < tokens.length) {
    const tok = tokens[i]
    if (tok.punct) {
      i++
      continue
    }
    const word = tok.w
    // "hold short (of) (runway) X"
    if ((word === 'hold' || word === 'holding') && isWord(i + 1, 'short')) {
      let k = i + 2
      if (isWord(k, 'of')) k++
      if (isWord(k, 'runway', 'rwy')) {
        const r = readRunway(tokens, k + 1)
        if (r) {
          out.holdShort.push({ kind: 'runway', ref: r.ident })
          i = r.next
          continue
        }
      }
      const tw = readTaxiway(tokens, k, true)
      const rw = readRunway(tokens, k)
      if (rw && (!tw || /^\d/.test(tokens[k].w) || DIGIT[tokens[k].w] != null)) {
        out.holdShort.push({ kind: 'runway', ref: rw.ident })
        i = rw.next
        continue
      }
      if (tw) {
        // "hold short of Kilo Echo": a double-letter name.
        const second = tw.letterOnly ? readTaxiway(tokens, tw.next, false) : null
        const ref = second && second.letterOnly ? tw.ref + second.ref : tw.ref
        out.holdShort.push({ kind: 'taxiway', ref })
        i = second && second.letterOnly ? second.next : tw.next
        continue
      }
      i = k
      continue
    }
    if (word === 'cross' || word === 'crossing') {
      let k = i + 1
      if (isWord(k, 'runway', 'rwy')) k++
      const r = readRunway(tokens, k)
      if (r) {
        out.cross.push(r.ident)
        i = r.next
        continue
      }
      i = k
      continue
    }
    if (word === 'taxi' || word === 'taxiing') {
      sawTaxi = true
      let k = i + 1
      if (isWord(k, 'to', 'into')) {
        k++
        if (isWord(k, 'the')) k++
        if (isWord(k, 'runway', 'rwy')) {
          const r = readRunway(tokens, k + 1)
          if (r) {
            out.runway = r.ident
            k = r.next
          }
        } else if (PLACES.has(w(k) ?? '')) {
          let dest = w(k)!
          k++
          // "spot 5", "gate B12", "terminal 4"
          if (tokens[k] && !tokens[k].punct && /^[a-z]?\d{1,3}[a-z]?$/.test(tokens[k].w)) dest += ` ${tokens[k++].w.toUpperCase()}`
          out.destination = dest
        } else {
          const r = readRunway(tokens, k)
          if (r && /\d|left|right|center/.test(tokens.slice(k, r.next).map((x) => x.w).join(' '))) {
            out.runway = r.ident
            k = r.next
          }
        }
      }
      if (isWord(k, 'via')) k = readList(k + 1)
      i = k
      continue
    }
    if (word === 'via') {
      i = readList(i + 1)
      continue
    }
    if (word === 'continue') {
      sawContinue = true
      let k = i + 1
      if (isWord(k, 'on', 'via', 'along', 'onto', 'taxiing')) k++
      if (isWord(k, 'on')) k++
      i = readList(k)
      continue
    }
    if ((word === 'right' || word === 'left') && isWord(i + 1, 'on', 'onto')) {
      i = readList(i + 2)
      continue
    }
    if (word === 'turn' && isWord(i + 1, 'left', 'right')) {
      let k = i + 2
      if (isWord(k, 'on', 'onto', 'at')) k++
      i = readList(k)
      continue
    }
    if (word === 'join') {
      i = readList(i + 1)
      continue
    }
    if (word === 'follow') {
      let k = i + 1
      const the = isWord(k, 'the')
      if (the) k++
      const tw = readTaxiway(tokens, k, false)
      const after = tokens[tw?.next ?? k]
      if (tw && the && (!after || after.punct || isWord(tw.next, 'to', 'via', 'hold', 'and', 'then', 'taxi') || !TRAFFIC.has(after.w))) {
        // "follow the Delta": traffic to follow; the router may still read it as a taxiway.
        out.follow = tokens[k].w.replace(/^./, (c) => c.toUpperCase())
        i = tw.next
        continue
      }
      if (tw && !the) {
        i = readList(k)
        continue
      }
      if (the && tokens[k] && !tokens[k].punct) out.follow = tokens[k].w
      i = k + 1
      continue
    }
    if (word === 'runway' || word === 'rwy') {
      const r = readRunway(tokens, i + 1)
      if (r) {
        // "cleared to land runway 4R", "line up and wait runway 31L": not a taxi destination.
        const before = tokens.slice(Math.max(0, i - 4), i).map((x) => x.w).join(' ')
        if (!/(land|takeoff|take off|wait|exit|vacate|depart|landing|option|approach)\s*$/.test(before)) looseRunway ??= r.ident
        i = r.next
        // "runway 31L at Kilo Echo": an intersection departure.
        continue
      }
    }
    i++
  }

  if (!out.runway && looseRunway && (sawTaxi || out.via.length)) out.runway = looseRunway
  // Readbacks often drop "of": "hold short 4 left" was read above; keep the last word if both forms appear.
  out.holdShort = out.holdShort.filter((h, k, all) => all.findIndex((x) => x.kind === h.kind && x.ref === h.ref) === k)
  out.kind = !sawTaxi && sawContinue ? 'continue' : 'taxi'
  const meaningful = out.via.length > 0 || (sawTaxi && (out.runway || out.destination)) || out.follow != null
  if (!meaningful) return null
  // "Cleared to land" or "cleared for takeoff" with a stray "via" are not taxi clearances.
  if (!sawTaxi && !sawContinue && out.via.length === 0 && !out.follow) return null
  return out
}

/** One line describing a clearance: "Taxi to 31L via A, B · hold short of 4L". */
export function describeTaxi(c: TaxiClearance): string {
  const parts: string[] = []
  const to = c.runway ? `runway ${c.runway}` : c.destination
  parts.push(`${c.kind === 'continue' ? 'Continue' : 'Taxi'}${to ? ` to ${to}` : ''}${c.via.length ? ` via ${c.via.join(', ')}` : ''}`)
  if (c.cross.length) parts.push(`cross ${c.cross.join(', ')}`)
  for (const h of c.holdShort) parts.push(`hold short of ${h.kind === 'runway' ? 'runway ' : ''}${h.ref}`)
  if (c.follow) parts.push(`follow the ${c.follow}`)
  return parts.join(' · ')
}
