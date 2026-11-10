/**
 * Which LiveATC stream carries which of our channels.
 *
 * The feed list (`liveatcFeeds.ts`) was built by probing LiveATC's stream
 * server for each airport and reading the name each stream announces
 * (`icy-name`, e.g. `KJFK Tower 119.1`), then pairing feeds with the
 * published frequencies they carry. A channel is only given audio when a
 * feed really carries it; everything else says so instead of playing
 * something else.
 */
import { LIVEATC_FEEDS } from './liveatcFeeds'
import type { Station, StationKind } from './types'

export type RadioFeed = {
  /** LiveATC mount point: the stream is `https://d.liveatc.net/<mount>`. */
  mount: string
  /** Name the stream announces, e.g. `KJFK Tower 119.1`. */
  name: string
  /** Positions it carries. */
  kinds: StationKind[]
  /** Published frequencies (MHz) it carries. */
  mhz: number[]
  /** Other mounts announcing the same thing, tried when this one is down. */
  alt?: string[]
}

/** Where the browser connects for a mount. LiveATC redirects to whichever of its servers carries it. */
export function streamUrl(mount: string): string {
  return `https://d.liveatc.net/${encodeURIComponent(mount)}`
}

/** Every feed at an airport (our three-letter code). */
export function feedsAt(airport: string): RadioFeed[] {
  return LIVEATC_FEEDS[airport.toUpperCase()] ?? []
}

const sameMhz = (a: number, b: number) => Math.abs(a - b) < 0.003

/**
 * The feed for a channel: one that carries its frequency, preferring the
 * feed that carries the fewest other things (a dedicated Tower feed beats a
 * Ground/Tower/Approach scanner). Null when no feed carries it.
 */
export function feedFor(station: Pick<Station, 'airport' | 'kind' | 'frequencyMhz'> | undefined | null): RadioFeed | null {
  if (!station || station.frequencyMhz == null) return null
  const f = station.frequencyMhz
  const carrying = feedsAt(station.airport).filter((feed) => feed.mhz.some((m) => sameMhz(m, f)))
  carrying.sort((a, b) => a.mhz.length - b.mhz.length || Number(!b.kinds.includes(station.kind)) - Number(!a.kinds.includes(station.kind)))
  return carrying[0] ?? null
}

const KIND_WORDS: [RegExp, StationKind][] = [
  [/\b(twr|tower|local)\b/i, 'TWR'],
  [/\b(gnd|ground|ramp|apron)\b/i, 'GND'],
  [/\b(del|delivery|clearance|clnc|metering)\b/i, 'CLD'],
  [/\b(app|approach|arrival|final|terminal|director)\b/i, 'APP'],
  [/\b(dep|departure)\b/i, 'DEP'],
  [/\batis\b/i, 'ATIS'],
]

/** What a stream name says it carries: `CYVR Del/Gnd/Twr` → CLD, GND, TWR; `KJFK Tower 119.1` → TWR at 119.1. */
export function parseFeedName(name: string): { kinds: StationKind[]; mhz: number[] } {
  const words = name.replace(/\//g, ' / ')
  const kinds = KIND_WORDS.filter(([re]) => re.test(words)).map(([, k]) => k)
  const mhz = [...name.matchAll(/\b(1[1-3]\d)[.,](\d{1,3})\b/g)].map((m) => Number(`${m[1]}.${m[2]}`))
  // "JFK TWR 1191": frequencies written without the point.
  for (const m of name.matchAll(/\b(1[1-3]\d)(\d{1,3})\b/g)) if (!mhz.length) mhz.push(Number(`${m[1]}.${m[2]}`))
  return { kinds, mhz }
}
