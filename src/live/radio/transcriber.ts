/**
 * From a cut transmission to a captioned, attributed call.
 *
 * Each segment from the player is encoded and sent to `/api/transcribe`
 * (Whisper on Workers AI), with a hint listing the callsigns actually
 * around the airport. The text that comes back is searched for callsigns,
 * matched to live aircraft, given a speaker, logged per station, and
 * published: caption line, highlight ring and camera focus.
 */
import { getAirport, resolveStation } from '../../api/airports'
import type { RadioFeed } from '../../api/radioFeeds'
import type { StationKind } from '../../api/types'
import { usePlayhead } from '../../playback/playheadStore'
import { liveBuffer } from '../session'
import { findCallsigns, guessSpeaker, splitCalls, writtenCallsign } from './callsigns'
import { matchMentions } from './match'
import { onSegment } from './player'
import { useRadio, type Transmission } from './radioStore'
import type { Segment } from './segmenter'
import { transmissionWav } from './wav'

/** Uploads in flight at once, and calls allowed to wait behind them. */
const CONCURRENCY = 2
const MAX_WAITING = 3
/** After a 429, wait this long before sending more. */
const BACKOFF_MS = 20_000
/** How long the camera and highlight stay on an aircraft after its call is captioned. */
export const HOLD_MS = 9_000
/** Most callsigns listed in the recognition hint. */
const HINT_LIMIT = 24

type Job = { seg: Segment; feed: RadioFeed; endedAt: number; stationId: string; airport: string; kind: StationKind | undefined; facility: string }

let queue: Job[] = []
let inFlight = 0
let pausedUntil = 0
let seq = 0
let focusTimer = 0

/** Callsigns worth naming to the recogniser: the ones this station is likely to be talking to. */
export function hintCallsigns(kind: StationKind | undefined, elevationFt: number): string {
  const all = liveBuffer.sample()
  const relevant = all.filter((a) => {
    const agl = a.onGround || a.altitudeFt == null ? 0 : a.altitudeFt - elevationFt
    if (kind === 'GND' || kind === 'CLD') return a.onGround
    if (kind === 'APP' || kind === 'DEP') return !a.onGround
    if (kind === 'TWR') return a.onGround || agl < 5000
    return true
  })
  // Moving aircraft are the likeliest to be on frequency; parked ones last.
  relevant.sort((x, y) => (y.speedKt ?? 0) - (x.speedKt ?? 0))
  const names: string[] = []
  for (const a of relevant) {
    const w = writtenCallsign(a.callsign)
    if (w && !names.includes(w)) names.push(w)
    if (names.length >= HINT_LIMIT) break
  }
  return names.join(', ')
}

function pump() {
  const st = useRadio.getState()
  while (inFlight < CONCURRENCY && queue.length && Date.now() >= pausedUntil && st.transcripts !== 'unavailable') {
    const job = queue.shift()!
    inFlight++
    useRadio.getState().patch({ pending: inFlight + queue.length })
    void send(job).finally(() => {
      inFlight--
      useRadio.getState().patch({ pending: inFlight + queue.length })
      pump()
    })
  }
}

async function send(job: Job) {
  const airport = getAirport(job.airport)
  const params = new URLSearchParams({ facility: job.facility, callsigns: hintCallsigns(job.kind, airport.elevationFt) })
  let res: Response
  try {
    const wav = transmissionWav(job.seg.samples, job.seg.sampleRate)
    res = await fetch(`/api/transcribe?${params.toString()}`, { method: 'POST', body: new Blob([wav as BlobPart], { type: 'audio/wav' }) })
  } catch {
    useRadio.getState().patch({ transcripts: 'error' })
    return
  }
  if (res.status === 501) {
    useRadio.getState().patch({ transcripts: 'unavailable' })
    queue = []
    return
  }
  if (res.status === 429) {
    pausedUntil = Date.now() + BACKOFF_MS
    useRadio.getState().patch({ transcripts: 'limited' })
    window.setTimeout(pump, BACKOFF_MS + 50)
    return
  }
  if (!res.ok) {
    useRadio.getState().patch({ transcripts: 'error' })
    return
  }
  const body = (await res.json().catch(() => null)) as TranscribeBody | null
  useRadio.getState().patch({ transcripts: 'ok' })
  const text = body?.text?.trim() ?? ''
  if (!text) return
  // Calls for a channel the listener has since left still go in that channel's log.
  const started = job.endedAt - job.seg.durationMs
  const meta = { stationId: job.stationId, airport: job.airport, kind: job.kind }
  const segments = body?.segments?.filter((s) => s.text?.trim()) ?? []
  // A reply can follow before the squelch closes; give each call its own line.
  const calls = segments.length > 1 ? splitCalls(segments.map((s) => ({ start: s.start, end: s.end, text: s.text }))) : []
  if (calls.length > 1) {
    const words = segments.flatMap((s) => s.words ?? [])
    for (const c of calls) {
      const own = words.filter((w) => w.start >= c.start - 0.01 && w.end <= c.end + 0.01).map((w) => ({ word: w.word, start: w.start - c.start, end: w.end - c.start }))
      ingest(c.text, { ...meta, endedAt: started + c.end * 1000, durationMs: Math.max(300, (c.end - c.start) * 1000), words: own.length ? own : undefined })
    }
    return
  }
  const words = segments.flatMap((s) => s.words ?? [])
  ingest(text, { ...meta, endedAt: job.endedAt, durationMs: job.seg.durationMs, words: words.length ? words : undefined })
}

type TranscribeBody = { text?: string; segments?: { start: number; end: number; text: string; words?: { word: string; start: number; end: number }[] }[] }

export type CallMeta = { stationId: string; airport: string; kind: StationKind | undefined; endedAt: number; durationMs: number; words?: Transmission['words'] }

/** A transcript in, a logged and published call out: who it names, who said it. */
export function ingest(text: string, meta: CallMeta): Transmission {
  const call = attribute(text, meta)
  publish(call, meta.words)
  return call
}

/** Work out who a call is to or from. */
function attribute(text: string, job: CallMeta): Transmission {
  const airport = getAirport(job.airport)
  const mentions = findCallsigns(text)
  const traffic = liveBuffer.sample()
  const matches = matchMentions(mentions, traffic, { stationKind: job.kind, elevationFt: airport.elevationFt })
  const byMention = new Map(matches.map((m) => [m.mention, m]))
  return {
    id: `rx-${job.endedAt}-${seq++}`,
    stationId: job.stationId,
    airport: job.airport,
    at: job.endedAt - job.durationMs,
    durationMs: Math.round(job.durationMs),
    text,
    status: 'done',
    speaker: guessSpeaker(text, mentions),
    callsigns: mentions.map((m) => {
      const hit = byMention.get(m)
      return { callsign: hit?.callsign ?? m.callsign, icao24: hit?.icao24 ?? null, confidence: hit?.confidence ?? 0 }
    }),
    icao24: matches[0]?.icao24 ?? null,
  }
}

/**
 * Log a finished call and, if it is on the channel being listened to, put it
 * on the caption line and point the highlight (and the automatic camera) at
 * whoever it concerns. A call naming nobody keeps the current focus a little
 * longer: it is usually the other half of the same exchange ("roger").
 */
export function publish(t: Transmission, words?: Transmission['words']) {
  const radio = useRadio.getState()
  const call = words ? { ...t, words } : t
  radio.upsert(call)
  const ph = usePlayhead.getState()
  if (ph.mode !== 'live' || ph.stationId !== t.stationId) return
  radio.patch({ caption: call })

  const ids = [...new Set(call.callsigns.map((c) => c.icao24).filter((x): x is string => !!x))]
  const now = Date.now()
  const current = useRadio.getState().focus
  if (ids.length) {
    useRadio.getState().patch({ focus: { ids, speaker: call.speaker, until: now + HOLD_MS } })
    ph.setActive(ids[0], call.speaker)
  } else if (current) {
    useRadio.getState().patch({ focus: { ...current, until: Math.max(current.until, now + HOLD_MS / 2) } })
  } else return
  window.clearTimeout(focusTimer)
  const until = useRadio.getState().focus!.until
  focusTimer = window.setTimeout(releaseFocus, until - now)
}

/** The exchange is over: drop the highlight (the camera eases back out on its own). */
export function releaseFocus() {
  window.clearTimeout(focusTimer)
  const focus = useRadio.getState().focus
  if (!focus) return
  useRadio.getState().patch({ focus: null })
  const ph = usePlayhead.getState()
  if (ph.mode === 'live' && focus.ids.includes(ph.activeCallsign ?? '')) ph.setActive(null)
}

/** Start turning segments into transcripts. Returns a stop function. */
export function startTranscriber(): () => void {
  return onSegment((seg, feed, endedAt) => {
    if (useRadio.getState().transcripts === 'unavailable') return
    const ph = usePlayhead.getState()
    // The radio only plays live. A segment arriving in a replay is the tail cut off as the replay
    // started, and the playhead already names the replay's airport and channel, not the one it was heard on.
    if (ph.mode !== 'live') return
    const airport = getAirport(ph.airportIcao)
    const station = resolveStation(airport, ph.stationId)
    const facility = `${airport.stations[0]?.name ?? airport.name} ${station?.label ?? 'Tower'}`
    queue.push({ seg, feed, endedAt, stationId: ph.stationId, airport: airport.icao, kind: station?.kind, facility })
    // Behind by more than a few calls: the oldest are stale, skip them.
    while (queue.length > MAX_WAITING) queue.shift()
    useRadio.getState().patch({ pending: inFlight + queue.length })
    pump()
  })
}

/** Forget queued work (channel or airport changed). */
export function clearQueue() {
  queue = []
  useRadio.getState().patch({ pending: inFlight })
}
