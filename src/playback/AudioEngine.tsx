/**
 * Playback clock.
 *
 * Clips with audio: the hidden `<audio>` element is the source of truth; its
 * `timeupdate` events drive `tMs`, and scrubbing seeks the element.
 * Replays without audio (recorded live traffic): a timer advances `tMs` at
 * the chosen rate.
 *
 * Either way the active cue is published so the map, subtitles and station
 * bar stay in step. The audio is also routed through an analyser so the
 * station bar can draw the real waveform.
 */
import { useEffect, useRef } from 'react'
import { getActiveCue, trackId } from './interpolate'
import { playbackInstant, usePlayhead } from './playheadStore'

/** Seek tolerance: avoids fighting the element's own progress. */
const SEEK_EPSILON_S = 0.35

/** Live spectrum of whatever is playing, for the waveform. Null until audio first plays. */
export const audioAnalyser: { node: AnalyserNode | null } = { node: null }

let audioContext: AudioContext | null = null

/** Route the element through an analyser. Must first run from a user gesture. */
function connectAnalyser(el: HTMLAudioElement) {
  if (audioAnalyser.node) {
    void audioContext?.resume()
    return
  }
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    audioContext = new Ctx()
    const source = audioContext.createMediaElementSource(el)
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.72
    source.connect(analyser)
    analyser.connect(audioContext.destination)
    audioAnalyser.node = analyser
  } catch {
    // No Web Audio: playback still works, the waveform just stays flat.
  }
}

function speakerRole(speaker: string | undefined): 'controller' | 'pilot' | null {
  if (!speaker) return null
  if (/pilot|aircraft/i.test(speaker)) return 'pilot'
  if (/tower|ground|approach|departure|clearance|controller/i.test(speaker) && !/log/i.test(speaker)) return 'controller'
  return null
}

export function AudioEngine() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const mode = usePlayhead((s) => s.mode)
  const clip = usePlayhead((s) => s.clip)
  const playing = usePlayhead((s) => s.playing)
  const tMs = usePlayhead((s) => s.tMs)
  const setTMs = usePlayhead((s) => s.setTMs)
  const setPlaying = usePlayhead((s) => s.setPlaying)
  const setActive = usePlayhead((s) => s.setActive)

  const hasAudio = mode === 'playback' && !!clip?.audioUrl

  // Publish who is talking at a given clip time.
  const publish = (ms: number) => {
    const c = usePlayhead.getState().clip
    const cue = c ? getActiveCue(c.cues, ms) : null
    setActive(cue?.callsign ? trackId(cue.callsign) : null, speakerRole(cue?.speaker))
  }

  // Load the clip's audio when entering playback.
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    if (!hasAudio || !clip) {
      el.pause()
      return
    }
    const abs = new URL(clip.audioUrl, window.location.origin).href
    if (el.src !== abs) {
      el.src = clip.audioUrl
      el.load()
    }
  }, [clip, hasAudio])

  // Play/pause follows the store; autoplay rejection flips the store back.
  useEffect(() => {
    const el = audioRef.current
    if (!el || !hasAudio) return
    if (playing) {
      connectAnalyser(el)
      // Restart from the top when play is pressed at the very end.
      if (el.ended || (clip && usePlayhead.getState().tMs >= clip.durationMs - 50)) {
        el.currentTime = 0
        setTMs(0)
      }
      void el.play().catch(() => setPlaying(false))
    } else el.pause()
  }, [playing, hasAudio, clip, setPlaying, setTMs])

  // External scrub → seek element.
  useEffect(() => {
    const el = audioRef.current
    if (!el || !hasAudio) return
    const target = tMs / 1000
    if (Math.abs(el.currentTime - target) > SEEK_EPSILON_S) {
      el.currentTime = target
      publish(tMs)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tMs, hasAudio])

  // Element progress → store.
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const onTime = () => {
      const s = usePlayhead.getState()
      if (s.mode !== 'playback' || !s.clip?.audioUrl) return
      const ms = el.currentTime * 1000
      setTMs(ms)
      publish(ms)
    }
    const onEnded = () => {
      setPlaying(false)
      setActive(null)
    }
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('ended', onEnded)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('ended', onEnded)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setTMs, setActive, setPlaying])

  // Replays without audio run on a timer instead.
  useEffect(() => {
    if (mode !== 'playback' || !clip || clip.audioUrl) return
    publish(usePlayhead.getState().tMs)
    if (!playing) return
    const id = window.setInterval(() => {
      const s = usePlayhead.getState()
      const t = playbackInstant(s)
      if (s.clip && t >= s.clip.durationMs) {
        setTMs(s.clip.durationMs)
        setPlaying(false)
        setActive(null)
        return
      }
      setTMs(t)
      publish(t)
    }, 200)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, clip, playing, setTMs, setPlaying, setActive])

  // Leaving playback silences everything.
  useEffect(() => {
    if (mode !== 'playback') audioRef.current?.pause()
  }, [mode])

  return <audio ref={audioRef} preload="auto" className="hidden" />
}
