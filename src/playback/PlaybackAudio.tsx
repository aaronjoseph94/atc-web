import { useEffect, useRef } from 'react'
import { getActiveCue } from './interpolate'
import { usePlayhead } from './playheadStore'

/** Single clock: audio element → Zustand tMs → karaoke / tracks. */
export function PlaybackAudio() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const mode = usePlayhead((s) => s.mode)
  const clip = usePlayhead((s) => s.clip)
  const playing = usePlayhead((s) => s.playing)
  const tMs = usePlayhead((s) => s.tMs)
  const setTMs = usePlayhead((s) => s.setTMs)
  const setPlaying = usePlayhead((s) => s.setPlaying)
  const setActiveCallsign = usePlayhead((s) => s.setActiveCallsign)
  const seeking = useRef(false)

  useEffect(() => {
    const el = audioRef.current
    if (!el || !clip) return
    if (el.src !== new URL(clip.audioUrl, window.location.origin).href) {
      el.src = clip.audioUrl
      el.load()
    }
  }, [clip])

  useEffect(() => {
    const el = audioRef.current
    if (!el || mode !== 'playback') return
    if (playing) {
      void el.play().catch(() => setPlaying(false))
    } else {
      el.pause()
    }
  }, [playing, mode, setPlaying])

  // External scrub → audio
  useEffect(() => {
    const el = audioRef.current
    if (!el || mode !== 'playback' || seeking.current) return
    const target = tMs / 1000
    if (Math.abs(el.currentTime - target) > 0.25) {
      el.currentTime = target
    }
  }, [tMs, mode])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return

    const onTime = () => {
      if (mode !== 'playback') return
      const ms = el.currentTime * 1000
      setTMs(ms)
      const cue = clip ? getActiveCue(clip.cues, ms) : null
      setActiveCallsign(cue?.callsign ?? null)
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
  }, [mode, clip, setTMs, setPlaying, setActiveCallsign])

  // Live mode: still drive karaoke from clip cues on a soft loop clock if clip preloaded
  useEffect(() => {
    if (mode !== 'live' || !clip) {
      if (mode === 'live') setActiveCallsign(null)
      return
    }
    // Demo: in live mode, idle — no fake audio loop (plan: AudioSource stub)
  }, [mode, clip, setActiveCallsign])

  return <audio ref={audioRef} preload="metadata" className="hidden" />
}
