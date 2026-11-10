/**
 * Plays a LiveATC stream and taps it for the waveform and the transcriber.
 *
 * One hidden `<audio crossorigin="anonymous">` element plays the MP3 stream
 * (LiveATC sends `Access-Control-Allow-Origin: *`, so Web Audio may read the
 * samples). It is routed element → analyser → speakers, and in parallel into
 * a small AudioWorklet that hands raw samples to the segmenter.
 *
 * Browsers only start sound from a tap, so `startRadio` must be called
 * straight from a click handler the first time; afterwards the same element
 * and context stay unlocked and channel changes can start it from anywhere.
 *
 * Streams drop (feeders reboot, phones change network). The player notices
 * errors, endings and stalls, and reconnects with growing pauses; a feed
 * LiveATC reports as missing is retried slowly instead.
 */
import { streamUrl, type RadioFeed } from '../../api/radioFeeds'
import { analysers, getAudioContext, makeAnalyser, resumeAudio } from './audioGraph'
import { useRadio, type RadioStatus } from './radioStore'
import { bufferedAhead, canStreamMp3, streamInto, type MseStream } from './mseStream'
import { Segmenter, type Segment } from './segmenter'

/** Reconnect pauses grow 1 s, 2 s, 4 s… up to this. */
const MAX_BACKOFF_S = 30
/** A feed LiveATC says doesn't exist right now is tried again this often. */
const OFFLINE_RETRY_S = 60
/** No new audio for this long while "playing" means the stream has silently died. */
const STALL_MS = 15_000
/** How long a connection may go without a byte before it counts as failed. */
const CONNECT_TIMEOUT_MS = 20_000
/** More audio than this buffered ahead means playback has drifted behind live: skip forward. */
const MAX_LAG_S = 8

/** Audio worklet that batches the stream's samples and posts them to the page. */
const TAP_WORKLET = `
class RadioTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(4096); this.n = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) {
      let i = 0
      while (i < ch.length) {
        const take = Math.min(ch.length - i, this.buf.length - this.n)
        this.buf.set(ch.subarray(i, i + take), this.n)
        this.n += take
        i += take
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf, [this.buf.buffer])
          this.buf = new Float32Array(4096)
          this.n = 0
        }
      }
    }
    return true
  }
}
registerProcessor('radio-tap', RadioTap)
`

type SegmentListener = (seg: Segment, feed: RadioFeed, endedAt: number) => void

let el: HTMLAudioElement | null = null
let source: MediaElementAudioSourceNode | null = null
/** The live channel's volume on its way to the speakers (turned down while a saved call is replayed). */
let volume: GainNode | null = null
let tapReady: Promise<void> | null = null
let segmenter: Segmenter | null = null
let feed: RadioFeed | null = null
/** Which of the feed's mounts (main, then alternates) is in use. */
let mountIndex = 0
let want = false
let attempt = 0
let retryTimer = 0
let countdown = 0
let watchdog = 0
let lastProgress = 0
let lastTime = -1
let connectStarted = 0
/** Bumped by every connect and stop, so a failure check that outlives its connection does nothing. */
let generation = 0
/** The MSE feed into the element, when that is how this browser plays the stream. */
let stream: MseStream | null = null
/** MSE failed once in this browser: use plain `src` from then on. */
let mseBroken = false
const listeners = new Set<SegmentListener>()

const set = (status: RadioStatus, extra: Parameters<ReturnType<typeof useRadio.getState>['patch']>[0] = {}) => useRadio.getState().patch({ status, ...extra })

/** Subscribe to finished transmissions. Returns an unsubscribe function. */
export function onSegment(fn: SegmentListener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** The feed currently playing (or trying to). */
export function currentFeed(): RadioFeed | null {
  return want ? feed : null
}

function element(): HTMLAudioElement {
  if (el) return el
  el = document.createElement('audio')
  el.crossOrigin = 'anonymous'
  el.preload = 'none'
  // iOS: play inline, never take over the screen.
  el.setAttribute('playsinline', '')
  el.setAttribute('webkit-playsinline', '')
  el.style.display = 'none'
  document.body.appendChild(el)
  el.addEventListener('playing', () => {
    if (!want) return
    set('live', { retryInS: null })
  })
  el.addEventListener('waiting', () => want && useRadio.getState().status === 'live' && set('buffering'))
  el.addEventListener('stalled', () => want && useRadio.getState().status === 'live' && set('buffering'))
  el.addEventListener('timeupdate', () => {
    if (!el || el.currentTime === lastTime) return
    lastTime = el.currentTime
    lastProgress = performance.now()
    // Ten seconds of clean audio forgives earlier failures.
    if (el.currentTime > 10) attempt = 0
    if (want && useRadio.getState().status === 'buffering') set('live')
  })
  el.addEventListener('error', () => want && void fail())
  el.addEventListener('ended', () => want && void fail())
  return el
}

/** Route the element through Web Audio once: analyser to the speakers, plus the transcription tap. */
function graph(media: HTMLAudioElement) {
  const ctx = getAudioContext()
  if (!ctx || source) return
  try {
    source = ctx.createMediaElementSource(media)
  } catch {
    return
  }
  const analyser = makeAnalyser(ctx)
  // The volume sits after the analyser, so the waveform keeps showing the channel while it is turned down.
  volume = ctx.createGain()
  source.connect(analyser)
  analyser.connect(volume)
  volume.connect(ctx.destination)
  analysers.live = analyser
  segmenter = new Segmenter({ sampleRate: ctx.sampleRate })
  tapReady = attachTap(ctx, source)
}

/** Start feeding samples to the segmenter: AudioWorklet where available, ScriptProcessor otherwise. */
async function attachTap(ctx: AudioContext, from: AudioNode) {
  const sink = ctx.createGain()
  sink.gain.value = 0
  sink.connect(ctx.destination)
  const feedSamples = (samples: Float32Array) => {
    const seg = segmenter
    if (!seg || !want) return
    const wasSpeaking = seg.speaking
    const done = seg.push(samples)
    if (seg.speaking !== wasSpeaking) useRadio.getState().patch({ speaking: seg.speaking })
    for (const s of done) emit(s)
  }
  if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
    try {
      const url = URL.createObjectURL(new Blob([TAP_WORKLET], { type: 'application/javascript' }))
      await ctx.audioWorklet.addModule(url)
      URL.revokeObjectURL(url)
      const node = new AudioWorkletNode(ctx, 'radio-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' })
      node.port.onmessage = (e: MessageEvent<Float32Array>) => feedSamples(e.data)
      from.connect(node)
      node.connect(sink)
      return
    } catch {
      // Fall through to the older API.
    }
  }
  const proc = ctx.createScriptProcessor(4096, 1, 1)
  proc.onaudioprocess = (e) => feedSamples(new Float32Array(e.inputBuffer.getChannelData(0)))
  from.connect(proc)
  proc.connect(sink)
}

function emit(seg: Segment) {
  if (!feed) return
  const f = feed
  const now = Date.now()
  for (const fn of listeners) fn(seg, f, now)
}

/** The mount in use: the feed's own, or an alternate after the first was found offline. */
function mountNow(): string | null {
  if (!feed) return null
  return [feed.mount, ...(feed.alt ?? [])][mountIndex] ?? feed.mount
}

function clearTimers() {
  window.clearTimeout(retryTimer)
  window.clearInterval(countdown)
  retryTimer = 0
  countdown = 0
}

/** Point the element at the stream and play. */
function connect() {
  const media = element()
  if (!feed) return
  clearTimers()
  generation++
  stream?.stop()
  stream = null
  segmenter?.reset()
  useRadio.getState().patch({ speaking: false })
  connectStarted = performance.now()
  lastProgress = performance.now()
  lastTime = -1
  // A fresh URL each time so nothing serves a stale buffer.
  const url = `${streamUrl(mountNow() ?? feed.mount)}?nocache=${Date.now()}`
  if (canStreamMp3() && !mseBroken) {
    const owner = feed.mount
    stream = streamInto(media, url, {
      // Bytes flowing count as progress while the first second of audio builds up.
      onData: () => {
        if (useRadio.getState().status === 'connecting') connectStarted = performance.now()
      },
      onHttpError: (status) => want && feed?.mount === owner && void fail(status === 404 ? false : null),
      onEnd: () => want && feed?.mount === owner && void fail(),
      onUnsupported: () => {
        mseBroken = true
        if (want && feed?.mount === owner) connect()
      },
    })
  } else {
    media.src = url
    media.load()
  }
  resumeAudio()
  media.play().catch((err: unknown) => {
    if (!want) return
    if (err instanceof DOMException && err.name === 'NotAllowedError') set('blocked')
    else if (!(err instanceof DOMException && err.name === 'AbortError')) void fail()
  })
  startWatchdog()
}

function startWatchdog() {
  window.clearInterval(watchdog)
  watchdog = window.setInterval(() => {
    if (!want || !el) return
    const st = useRadio.getState().status
    const now = performance.now()
    if (st === 'connecting' && now - connectStarted > CONNECT_TIMEOUT_MS) void fail()
    else if ((st === 'live' || st === 'buffering') && now - lastProgress > STALL_MS) void fail()
    // Fell behind live (a stall, a slow tab): jump to the newest audio.
    if (stream && st === 'live' && bufferedAhead(el) > MAX_LAG_S) el.currentTime += bufferedAhead(el) - 1.5
    // Phones suspend audio in the background; nudge it back when we can.
    if (st === 'live' && getAudioContext()?.state === 'suspended') resumeAudio()
  }, 2500)
}

/** Does LiveATC have this mount right now? (The audio element can't tell a 404 from a network error.) */
async function mountExists(mount: string): Promise<boolean | null> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(`${streamUrl(mount)}?nocache=${Date.now()}`, { signal: ctrl.signal, cache: 'no-store' })
    // Only the status was wanted; drop the audio.
    ctrl.abort()
    return res.ok ? true : res.status === 404 ? false : null
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

/**
 * The stream failed: work out why, then schedule another try. `known` is
 * whether the mount exists, when the failure already told us (an HTTP 404).
 */
async function fail(known?: boolean | null) {
  if (!want || !feed || retryTimer) return
  const owner = feed.mount
  const gen = generation
  const mount = mountNow() ?? owner
  stream?.stop()
  stream = null
  el?.pause()
  segmenter?.flush()
  useRadio.getState().patch({ speaking: false })
  set('reconnecting', { retryInS: null })
  // Placeholder so a burst of error events schedules only one retry.
  retryTimer = -1
  const exists = known === false ? false : await mountExists(mount)
  // Stopped, retuned or restarted while checking: that newer connection is in charge now.
  if (!want || feed?.mount !== owner || gen !== generation) return
  // This mount is gone but the same channel has another: switch straight away.
  if (exists === false && mountIndex < (feed.alt?.length ?? 0)) {
    mountIndex++
    retryTimer = 0
    set('connecting', { retryInS: null })
    connect()
    return
  }
  if (exists === false) mountIndex = 0
  const wait = exists === false ? OFFLINE_RETRY_S : Math.min(MAX_BACKOFF_S, 2 ** attempt)
  attempt++
  let left = wait
  set(exists === false ? 'offline' : 'reconnecting', { retryInS: left })
  countdown = window.setInterval(() => {
    left = Math.max(0, left - 1)
    useRadio.getState().patch({ retryInS: left })
  }, 1000)
  retryTimer = window.setTimeout(() => {
    clearTimers()
    if (want && feed?.mount === owner) {
      set('connecting', { retryInS: null })
      connect()
    }
  }, wait * 1000)
}

/**
 * Start (or switch to) a feed. Call from a click or key handler the first
 * time so the browser lets the audio start.
 */
export function startRadio(next: RadioFeed) {
  const media = element()
  graph(media)
  resumeAudio()
  const same = want && feed?.mount === next.mount && !media.paused
  want = true
  if (!same) mountIndex = 0
  feed = next
  attempt = 0
  useRadio.getState().patch({ on: true, feed: next })
  if (same) return
  set('connecting', { retryInS: null })
  connect()
  mediaSession(next)
}

/** Stop the stream. `keepIntent` leaves `on` set (the listener didn't ask to stop: e.g. a replay started). */
export function stopRadio(keepIntent = false, status: RadioStatus = 'off') {
  want = false
  generation++
  clearTimers()
  window.clearInterval(watchdog)
  const tail = segmenter?.flush()
  if (tail && feed) for (const fn of listeners) fn(tail, feed, Date.now())
  stream?.stop()
  stream = null
  if (el) {
    el.pause()
    // Drop the connection rather than buffering a live stream nobody hears.
    el.removeAttribute('src')
    el.load()
  }
  useRadio.getState().patch({ on: keepIntent, status, speaking: false, retryInS: null, ...(status === 'nofeed' ? { feed: null } : {}) })
  if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused'
}

/** Ask the browser's media controls (lock screen, headphones) to drive the radio. */
function mediaSession(f: RadioFeed) {
  const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined
  if (!ms) return
  try {
    ms.metadata = new MediaMetadata({ title: f.name, artist: 'LiveATC.net', album: 'Live air traffic control' })
    ms.playbackState = 'playing'
    ms.setActionHandler('play', () => feed && startRadio(feed))
    ms.setActionHandler('pause', () => stopRadio())
    ms.setActionHandler('stop', () => stopRadio())
  } catch {
    // Older browsers lack some actions; the in-page controls still work.
  }
  // Safari 17+: keep playing with the ringer switch off and the screen locked.
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession
  if (session) {
    try {
      session.type = 'playback'
    } catch {
      // Not allowed here; harmless.
    }
  }
}

// Coming back to the tab: phones may have suspended the context or paused the element.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !want || !el) return
    resumeAudio()
    if (el.paused && !retryTimer) connect()
  })
}

/** How loud the live channel stays while a saved call plays over it: still there, but out of the way. */
const DUCK_GAIN = 0.12

/**
 * Turn the live channel down (or back up) so a call replayed from the
 * transcript can be heard over it. Short ramps, so it doesn't click.
 */
export function duckRadio(on: boolean) {
  const ctx = getAudioContext()
  if (!volume || !ctx) return
  const g = volume.gain
  g.cancelScheduledValues(ctx.currentTime)
  g.setValueAtTime(g.value, ctx.currentTime)
  g.linearRampToValueAtTime(on ? DUCK_GAIN : 1, ctx.currentTime + (on ? 0.12 : 0.35))
}

/** The live channel's current loudness, 0..1 (for diagnostics). Null before the radio first plays. */
export function radioVolume(): number | null {
  return volume?.gain.value ?? null
}

/** Current analyser readings are flat while nothing plays; tests and diagnostics read the element directly. */
export function radioElement(): HTMLAudioElement | null {
  return el
}

/** Wait until the transcription tap is attached (for diagnostics). */
export function tapAttached(): Promise<void> | null {
  return tapReady
}
