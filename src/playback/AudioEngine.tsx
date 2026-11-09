import { Pause, Play } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { getActiveCue } from './interpolate'
import { usePlayhead } from './playheadStore'

/** Single clock: audio currentTime drives Zustand tMs + active callsign. */
export function AudioEngine() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const mode = usePlayhead((s) => s.mode)
  const clip = usePlayhead((s) => s.clip)
  const playing = usePlayhead((s) => s.playing)
  const tMs = usePlayhead((s) => s.tMs)
  const setTMs = usePlayhead((s) => s.setTMs)
  const setPlaying = usePlayhead((s) => s.setPlaying)
  const setActiveCallsign = usePlayhead((s) => s.setActiveCallsign)

  useEffect(() => {
    const el = audioRef.current
    if (!el || !clip || mode !== 'playback') return
    const abs = new URL(clip.audioUrl, window.location.origin).href
    if (el.src !== abs) {
      el.src = clip.audioUrl
      el.load()
    }
  }, [clip, mode])

  useEffect(() => {
    const el = audioRef.current
    if (!el || mode !== 'playback') return
    if (playing) void el.play().catch(() => setPlaying(false))
    else el.pause()
  }, [playing, mode, setPlaying])

  useEffect(() => {
    const el = audioRef.current
    if (!el || mode !== 'playback') return
    const target = tMs / 1000
    if (Math.abs(el.currentTime - target) > 0.35) el.currentTime = target
  }, [tMs, mode])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const onTime = () => {
      if (usePlayhead.getState().mode !== 'playback') return
      const ms = el.currentTime * 1000
      setTMs(ms)
      const c = clip ? getActiveCue(clip.cues, ms) : null
      setActiveCallsign(c?.callsign ?? null)
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
    <div className="absolute inset-x-0 top-[max(0.5rem,var(--safe-top))] z-20 mx-auto flex w-full max-w-lg flex-col gap-2 px-3 pt-14">
      <div className="flex items-center justify-between rounded-full bg-black/55 px-3 py-2 backdrop-blur-md">
        <span className="text-sm font-semibold">Playback</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={playing ? 'Pause' : 'Play'}
            className="rounded-full bg-white/15 p-2"
            onClick={() => setPlaying(!playing)}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
          <button
            type="button"
            className="rounded-full bg-atc-yellow px-3 py-1.5 text-xs font-bold text-black"
            onClick={() => exitPlayback()}
          >
            Exit Playback
          </button>
        </div>
      </div>
      <div className="rounded-xl bg-black/50 px-3 py-2 backdrop-blur-md">
        <input
          type="range"
          min={0}
          max={dur}
          value={tMs}
          aria-label="Scrub playback"
          className="w-full accent-atc-yellow"
          onChange={(e) => setTMs(Number(e.target.value))}
        />
        <div className="mt-1 flex justify-between text-[11px] text-white/60">
          <span>{fmt(tMs)}</span>
          <span>{fmt(dur)}</span>
        </div>
      </div>
    </div>
  )
}

function fmt(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}
