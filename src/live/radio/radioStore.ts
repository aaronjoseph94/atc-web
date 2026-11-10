/**
 * Live radio state: what the listener asked for, how the stream is doing,
 * whether transcripts work, and the transmissions heard so far.
 *
 * Separate from the playhead store because it changes several times a
 * second while someone talks (speaking flag, transcripts arriving) and only
 * the radio UI needs to hear about that.
 */
import { create } from 'zustand'
import type { RadioFeed } from '../../api/radioFeeds'
import type { Speaker } from './callsigns'

/**
 * `off`: not listening. `connecting`: first bytes on their way. `live`:
 * playing. `buffering`: playing but starved. `reconnecting`: the stream
 * dropped; trying again after a pause. `offline`: LiveATC says the feed is
 * down. `nofeed`: no LiveATC feed carries this channel. `blocked`: the
 * browser wants a tap before it will play sound.
 */
export type RadioStatus = 'off' | 'connecting' | 'live' | 'buffering' | 'reconnecting' | 'offline' | 'nofeed' | 'blocked'

/** `unavailable`: the server has no speech-to-text (local dev). `limited`: too many requests, pausing. */
export type TranscriptStatus = 'idle' | 'ok' | 'unavailable' | 'limited' | 'error'

export type HeardCallsign = { callsign: string; icao24: string | null; confidence: number }

export type Transmission = {
  id: string
  stationId: string
  airport: string
  /** Epoch ms when the call started (as heard in the stream). */
  at: number
  durationMs: number
  /** Empty while the transcript is on its way. */
  text: string
  status: 'transcribing' | 'done'
  speaker: Speaker | null
  /** Callsigns named in the call, matched to live aircraft where possible. */
  callsigns: HeardCallsign[]
  /** The aircraft this call is to or from, when one matched well enough. */
  icao24: string | null
  /** Word timings from the transcriber, seconds from the start of the call. */
  words?: { word: string; start: number; end: number }[]
}

/** Calls kept per channel. */
export const LOG_LIMIT = 120

type RadioState = {
  /** The listener wants to hear the radio (survives channel changes). */
  on: boolean
  status: RadioStatus
  feed: RadioFeed | null
  /** Seconds until the next reconnect attempt, while `reconnecting` or `offline`. */
  retryInS: number | null
  /** Somebody is transmitting right now (the segmenter's view of the stream). */
  speaking: boolean
  transcripts: TranscriptStatus
  /** Calls waiting for their transcript. */
  pending: number
  /** Heard calls per station id, oldest first. */
  log: Record<string, Transmission[]>
  /** The call on the caption line. */
  caption: Transmission | null
  /** Aircraft the radio is about right now, for the highlight and the camera; primary first. */
  focus: { ids: string[]; speaker: Speaker | null; until: number } | null

  patch: (p: Partial<Omit<RadioState, 'patch' | 'upsert' | 'remove'>>) => void
  /** Add a call or update one already logged. */
  upsert: (t: Transmission) => void
  remove: (id: string, stationId: string) => void
}

export const useRadio = create<RadioState>((set) => ({
  on: false,
  status: 'off',
  feed: null,
  retryInS: null,
  speaking: false,
  transcripts: 'idle',
  pending: 0,
  log: {},
  caption: null,
  focus: null,

  patch: (p) => set(p),
  upsert: (t) =>
    set((s) => {
      const list = s.log[t.stationId] ?? []
      const i = list.findIndex((x) => x.id === t.id)
      const next = i >= 0 ? list.map((x, k) => (k === i ? t : x)) : [...list, t].slice(-LOG_LIMIT)
      return { log: { ...s.log, [t.stationId]: next }, caption: s.caption?.id === t.id ? t : s.caption }
    }),
  remove: (id, stationId) =>
    set((s) => ({ log: { ...s.log, [stationId]: (s.log[stationId] ?? []).filter((x) => x.id !== id) }, caption: s.caption?.id === id ? null : s.caption })),
}))

/** Every logged call about one aircraft at the given stations, oldest first. */
export function callsFor(log: Record<string, Transmission[]>, icao24: string, stationIds?: string[]): Transmission[] {
  const keys = stationIds ?? Object.keys(log)
  return keys
    .flatMap((k) => log[k] ?? [])
    .filter((t) => t.status === 'done' && (t.icao24 === icao24 || t.callsigns.some((c) => c.icao24 === icao24)))
    .sort((a, b) => a.at - b.at)
}

/** Status line for the station bar. */
export function statusText(status: RadioStatus, retryInS: number | null): string {
  switch (status) {
    case 'connecting':
      return 'Connecting…'
    case 'live':
      return 'Live'
    case 'buffering':
      return 'Buffering…'
    case 'reconnecting':
      return retryInS ? `Signal lost. Retrying in ${retryInS}s` : 'Reconnecting…'
    case 'offline':
      return retryInS ? `Feed is offline. Retrying in ${retryInS}s` : 'Feed is offline'
    case 'nofeed':
      return 'No live audio for this channel'
    case 'blocked':
      return 'Tap play to listen'
    default:
      return ''
  }
}
