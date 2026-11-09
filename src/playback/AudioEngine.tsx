/**
 * Playback clock. The hidden `<audio>` element is the single source of truth:
 * its `timeupdate` events drive `tMs` and the active callsign in the store,
 * which in turn drive the karaoke overlay, aircraft tracks and halo.
 *
 * Scrubbing works in reverse: when `tMs` is changed externally (slider,
 * transcript tap) we seek the audio element if it has drifted.
 */
import { Pause, Play, Radio } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { getActiveCue } from './interpolate'
import { usePlayhead } from './playheadStore'

/** Seek tolerance — avoids fighting the element's own progress. */
const SEEK_EPSILON_S = 0.35

export function AudioEngine() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const mode = usePlayhead((s) => s.mode)
  const clip = usePlayhead((s) => s.clip)
  const playing = usePlayhead((s) => s.playing)
  const tMs = usePlayhead((s) => s.tMs)
  const setTMs = usePlayhead((s) => s.setTMs)
  const setPlaying = usePlayhead((s) => s.setPlaying)
  const setActiveCallsign = usePlayhead((s) => s.setActiveCallsign)

  // Load the clip's audio when entering playback.
  useEffect(() => {
    const el = audioRef.current
    if (!el || !clip || mode !== 'playback') return
    const abs = new URL(clip.audioUrl, window.location.origin).href
    if (el.src !== abs) {
      el.src = clip.audioUrl
      el.load()
    }
  }, [clip, mode])

  // Play/pause follows the store; autoplay rejection flips the store back.
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    if (mode !== 'playback') {
      el.pause()
      return
    }
    if (playing) void el.play().catch(() => setPlaying(false))
    else el.pause()
  }, [playing, mode, setPlaying])

  // External scrub → seek element.
  useEffect(() => {
    const el = audioRef.current
    if (!el || mode !== 'playback') return
    const target = tMs / 1000
    if (Math.abs(el.currentTime - target) > SEEK_EPSILON_S) el.currentTime = target
  }, [tMs, mode])

  // Element progress → store.
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const onTime = () => {
      if (usePlayhead.getState().mode !== 'playback') return
      const ms = el.currentTime * 1000
      setTMs(ms)
      setActiveCallsign(clip ? (getActiveCue(clip.cues, ms)?.callsign ?? null) : null)
    }
    const onEnded = () => {
      setPlaying(false)
      setActiveCallsign(null)
    }
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('ended', onEnded)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('ended', onEnded)
    }
  }, [clip, setTMs, setActiveCallsign, setPlaying])

  return <audio ref={audioRef} preload="metadata" className="hidden" />
}

/** Transport + timeline shown under the top chrome while in playback. */
export function PlaybackScrubber() {
  const mode = usePlayhead((s) => s.mode)
  const clip = usePlayhead((s) => s.clip)
  const tMs = usePlayhead((s) => s.tMs)
  const playing = usePlayhead((s) => s.playing)
  const setTMs = usePlayhead((s) => s.setTMs)
  const setPlaying = usePlayhead((s) => s.setPlaying)
  const exitPlayback = usePlayhead((s) => s.exitPlayback)

  if (mode !== 'playback' || !clip) return null

  const dur = clip.durationMs || 1

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[calc(max(0.75rem,var(--safe-top))+3.25rem)] z-20 flex justify-center px-3">
      <div className="pointer-events-auto w-full max-w-md animate-rise rounded-2xl bg-black/60 p-3 shadow-lg ring-1 ring-white/10 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label={playing ? 'Pause' : 'Play'}
            className="rounded-full bg-atc-yellow p-2.5 text-black transition hover:brightness-110 active:scale-95"
            onClick={() => setPlaying(!playing)}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{clip.title}</div>
            <div className="text-[11px] tabular-nums text-white/60">
              {fmt(tMs)} / {fmt(dur)}
            </div>
          </div>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold transition hover:bg-white/20"
            onClick={exitPlayback}
          >
            <Radio className="size-3.5" /> Live
          </button>
        </div>
        <input
          type="range"
          min={0}
          max={dur}
          step={50}
          value={Math.min(tMs, dur)}
          aria-label="Scrub playback"
          className="mt-2 w-full accent-atc-yellow"
          onChange={(e) => setTMs(Number(e.target.value))}
        />
      </div>
    </div>
  )
}

function fmt(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}
