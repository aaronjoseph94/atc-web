import { useMemo } from 'react'
import { cueProgress, getActiveCue } from '../playback/interpolate'
import { usePlayhead } from '../playback/playheadStore'

export function KaraokeOverlay() {
  const mode = usePlayhead((s) => s.mode)
  const tMs = usePlayhead((s) => s.tMs)
  const clip = usePlayhead((s) => s.clip)
  const playing = usePlayhead((s) => s.playing)

  const cue = useMemo(() => (clip ? getActiveCue(clip.cues, tMs) : null), [clip, tMs])

  if (mode === 'live') {
    return (
      <div className="karaoke idle fade">
        <p>Waiting for the next transmission…</p>
      </div>
    )
  }

  if (!cue) {
    return (
      <div className="karaoke idle fade">
        <p>{playing ? 'Waiting for the next transmission…' : 'Paused'}</p>
      </div>
    )
  }

  const progress = cueProgress(cue, tMs)
  const words = cue.text.split(/\s+/)
  const spokenCount = Math.floor(progress * words.length)

  return (
    <div className="karaoke active fade" key={cue.id}>
      {(cue.speaker || cue.callsign) && (
        <span className="karaoke-cs">{[cue.speaker, cue.callsign].filter(Boolean).join(' · ')}</span>
      )}
      <p>
        {words.map((w, i) => (
          <span key={`${cue.id}-${i}`} className={i < spokenCount ? 'spoken' : 'rest'}>
            {w}
            {i < words.length - 1 ? ' ' : ''}
          </span>
        ))}
      </p>
    </div>
  )
}
