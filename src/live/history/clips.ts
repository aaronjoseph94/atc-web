/**
 * Keeps the audio of the last few dozen live radio calls so a transcript line
 * can be heard again.
 *
 * Every transmission the segmenter cuts from the stream is kept as 8 kHz
 * 16-bit PCM (the streams carry nothing above 4 kHz anyway): a few seconds of
 * speech is 50–100 KB, so fifty calls are a few megabytes, held in memory and
 * mirrored to IndexedDB so they survive a reload. A transcript line finds its
 * audio by time: the call it came from covers the same stretch of the same
 * channel.
 */
import { create } from 'zustand'
import { usePlayhead } from '../../playback/playheadStore'
import { getAudioContext, resumeAudio } from '../radio/audioGraph'
import { onSegment } from '../radio/player'
import { resample } from '../radio/wav'
import { getByIndex, getOne, prune, putAll, STORE } from './db'

/** Calls whose audio is kept. */
export const CLIP_LIMIT = 50
const RATE = 8000
const DAY_MS = 24 * 3_600_000
/** A little audio either side of the transcript's own times. */
const PAD_MS = 150

export type ClipMeta = { id: string; airport: string; stationId: string; start: number; end: number }
type Clip = ClipMeta & { rate: number; pcm: Int16Array }

type ClipState = {
  /** Retained clips, oldest first (metadata only). */
  index: ClipMeta[]
  /** The history entry whose audio is playing. */
  playing: string | null
}

export const useClips = create<ClipState>(() => ({ index: [], playing: null }))

const memory = new Map<string, Clip>()

function toPcm(samples: Float32Array, rate: number): Int16Array {
  const s = resample(samples, rate, RATE)
  const out = new Int16Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(s[i] * 32767)))
  return out
}

/** Keep a clip (and forget the oldest past the limit). */
export function keepClip(clip: Clip) {
  memory.set(clip.id, clip)
  const index = [...useClips.getState().index.filter((c) => c.id !== clip.id), { id: clip.id, airport: clip.airport, stationId: clip.stationId, start: clip.start, end: clip.end }].slice(-CLIP_LIMIT)
  const keep = new Set(index.map((c) => c.id))
  for (const id of memory.keys()) if (!keep.has(id)) memory.delete(id)
  useClips.setState({ index })
  void putAll(STORE.clips, [clip]).then(() => prune(STORE.clips, Date.now() - DAY_MS, CLIP_LIMIT))
}

/** Start keeping the audio of each call heard. Returns a stop function. */
export function startClipCapture(): () => void {
  return onSegment((seg, _feed, endedAt) => {
    const ph = usePlayhead.getState()
    keepClip({ id: `clip-${endedAt}`, airport: ph.airportIcao, stationId: ph.stationId, start: endedAt - seg.durationMs, end: endedAt, rate: RATE, pcm: toPcm(seg.samples, seg.sampleRate) })
  })
}

/** Load the clip index saved by earlier visits (at most fifty small records). */
export async function loadClipIndex(): Promise<void> {
  if (typeof IDBKeyRange === 'undefined') return
  const rows = await getByIndex<Clip>(STORE.clips, 'at', IDBKeyRange.lowerBound(Date.now() - DAY_MS))
  if (!rows.length) return
  const saved: ClipMeta[] = rows.map((r) => ({ id: r.id, airport: r.airport, stationId: r.stationId, start: r.start, end: r.end }))
  const cur = useClips.getState().index
  const merged = [...new Map([...saved, ...cur].map((c) => [c.id, c])).values()].sort((a, b) => a.start - b.start).slice(-CLIP_LIMIT)
  useClips.setState({ index: merged })
}

/** The retained clip that holds a call heard on `stationId` over [at, at + durationMs]. */
export function findClip(index: ClipMeta[], stationId: string, at: number, durationMs: number): ClipMeta | null {
  const end = at + Math.max(durationMs, 300)
  let best: ClipMeta | null = null
  let bestOverlap = 0
  for (const c of index) {
    if (c.stationId !== stationId) continue
    const overlap = Math.min(end, c.end) - Math.max(at, c.start)
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      best = c
    }
  }
  // Most of the call must be in the clip.
  return best && bestOverlap >= 0.5 * (end - at) ? best : null
}

let current: AudioBufferSourceNode | null = null

/** Stop whatever call is being replayed. */
export function stopClip() {
  try {
    current?.stop()
  } catch {
    // Already stopped.
  }
  current = null
  useClips.setState({ playing: null })
}

/**
 * Play the part of a clip that covers one call. Must be started from a tap
 * the first time (browsers only start sound from a gesture). Resolves with
 * how long it will play, or null when the audio is gone.
 */
export async function playClip(meta: ClipMeta, entryId: string, at: number, durationMs: number): Promise<number | null> {
  const ctx = getAudioContext()
  if (!ctx) return null
  resumeAudio()
  const clip = memory.get(meta.id) ?? (await getOne<Clip>(STORE.clips, meta.id))
  if (!clip) return null
  const from = Math.max(0, Math.floor(((at - clip.start - PAD_MS) / 1000) * clip.rate))
  const to = Math.min(clip.pcm.length, Math.ceil(((at + durationMs - clip.start + PAD_MS) / 1000) * clip.rate))
  if (to - from < clip.rate * 0.2) return null
  const buf = ctx.createBuffer(1, to - from, clip.rate)
  const ch = buf.getChannelData(0)
  for (let i = from; i < to; i++) ch[i - from] = clip.pcm[i] / 32768
  stopClip()
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(ctx.destination)
  src.onended = () => {
    if (current === src) {
      current = null
      useClips.setState({ playing: null })
    }
  }
  current = src
  useClips.setState({ playing: entryId })
  src.start()
  return buf.duration * 1000
}
