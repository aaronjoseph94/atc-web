/**
 * Karaoke-style transcript bubble shown above the station bar during
 * playback. Words are lit progressively as the playhead moves through the
 * cue's time span. Hidden in live mode (there is no live audio source).
 */
import { useMemo } from 'react'
import { cueProgress, getActiveCue } from '../playback/interpolate'
import { usePlayhead } from '../playback/playheadStore'

export function KaraokeOverlay() {
  const mode = usePlayhead((s) => s.mode)
  const tMs = usePlayhead((s) => s.tMs)
  const clip = usePlayhead((s) => s.clip)
  const playing = usePlayhead((s) => s.playing)

  const cue = useMemo(() => (clip ? getActiveCue(clip.cues, tMs) : null), [clip, tMs])

  if (mode !== 'playback') return null

  const shell = 'pointer-events-auto mx-3 max-w-[min(92vw,34rem)] rounded-2xl bg-black/65 px-4 py-3 text-center shadow-lg ring-1 ring-white/10 backdrop-blur-md'

  if (!cue) {
    return (
      <div className={`${shell} animate-fade text-sm text-atc-muted`}>
        {playing ? 'Waiting for the next transmission…' : 'Paused'}
      </div>
    )
  }

  const words = cue.text.split(/\s+/)
  const spokenCount = Math.floor(cueProgress(cue, tMs) * words.length)
  const who = [cue.speaker, cue.callsign].filter(Boolean).join(' · ')

  return (
    <div className={`${shell} animate-rise`} key={cue.id}>
      {who && <div className="mb-1 text-[11px] font-bold tracking-wider text-atc-yellow">{who}</div>}
      <p className="text-lg font-medium leading-snug sm:text-xl">
        {words.map((w, i) => (
          <span
            key={`${cue.id}-${i}`}
            className={`transition-colors duration-150 ${i < spokenCount ? 'font-semibold text-white' : 'text-white/45'}`}
          >
            {w}
            {i < words.length - 1 ? ' ' : ''}
          </span>
        ))}
      </p>
    </div>
  )
}
