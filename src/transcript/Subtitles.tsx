/**
 * The running subtitle over the bottom of the map.
 *
 * Playback: the radio call being spoken, lit word by word, with the previous
 * call dimmed above it. Live: the latest tower-log event (there is no radio in
 * the live feeds). Tapping it opens the full transcript or log.
 */
import { useMemo } from 'react'
import type { TranscriptCue } from '../api/types'
import { cueProgress, getActiveCue } from '../playback/interpolate'
import { usePlayhead } from '../playback/playheadStore'

/**
 * How many words of a cue have been spoken. Words are weighted by length, so
 * "cleared" takes longer to light than "to", which tracks speech far better
 * than counting words evenly.
 */
export function spokenWordCount(words: string[], progress: number): number {
  const total = words.reduce((n, w) => n + w.length + 1, 0)
  let acc = 0
  for (let i = 0; i < words.length; i++) {
    acc += words[i].length + 1
    if (acc / total > progress + 1e-9) return i + (progress > 0 ? 1 : 0)
  }
  return words.length
}

/**
 * The captions sit on a dark wash that rises from the bar below, so they stay
 * readable over bright grass and pale runway paint alike.
 */
const SCRIM =
  'pointer-events-auto w-full bg-gradient-to-b from-transparent via-[rgba(16,20,30,0.55)] to-[rgba(16,20,30,0.82)] px-4 pb-3 pt-14 text-left md:w-[min(92vw,40rem)] md:rounded-b-none md:rounded-t-3xl md:px-5'

export function Subtitles() {
  const mode = usePlayhead((s) => s.mode)
  const tMs = usePlayhead((s) => s.tMs)
  const clip = usePlayhead((s) => s.clip)
  const caption = usePlayhead((s) => s.caption)
  const previousEvent = usePlayhead((s) => (s.caption ? s.events.find((e) => e.id !== s.caption?.id) : undefined))
  const setPanel = usePlayhead((s) => s.setPanel)

  const cues = mode === 'playback' && clip ? clip.cues : null
  const active = useMemo(() => (cues ? getActiveCue(cues, tMs) : null), [cues, tMs])
  const earlier = useMemo<TranscriptCue[]>(() => {
    if (!cues) return []
    return cues.filter((c) => c.endMs <= tMs && c.id !== active?.id).slice(-2)
  }, [cues, tMs, active])

  if (mode === 'live') {
    if (!caption) return null
    return (
      <button type="button" className={SCRIM} onClick={() => setPanel('transcripts')} aria-label="Open the tower log">
        {previousEvent && <p className="line-clamp-1 text-[19px] font-semibold leading-snug text-white/35 [text-shadow:0_1px_8px_rgba(0,0,0,0.8)]">{previousEvent.text}</p>}
        <p key={caption.id} className="animate-caption text-[21px] font-semibold leading-snug text-white [text-shadow:0_1px_10px_rgba(0,0,0,0.9)]">
          {caption.text}
        </p>
      </button>
    )
  }

  if (!cues || (!active && earlier.length === 0)) return null
  const words = active ? active.text.split(/\s+/) : []
  const spoken = active ? spokenWordCount(words, cueProgress(active, tMs)) : 0

  return (
    <button type="button" className={SCRIM} onClick={() => setPanel('transcripts')} aria-label="Open the transcript">
      {earlier.map((c, i) => (
        <p
          key={c.id}
          className={`text-[19px] font-semibold leading-snug [text-shadow:0_1px_8px_rgba(0,0,0,0.6)] ${
            i < earlier.length - 1 ? 'line-clamp-1 text-white/25' : `line-clamp-2 ${active ? 'text-white/50' : 'text-white/60'}`
          }`}
        >
          {c.text}
        </p>
      ))}
      {active && (
        <p key={active.id} className="animate-caption text-[21px] font-semibold leading-snug [text-shadow:0_1px_10px_rgba(0,0,0,0.9)]" aria-live="off">
          {words.map((w, i) => (
            <span key={i} className={`transition-colors duration-200 ${i < spoken ? 'text-white' : 'text-white/40'}`}>
              {w}{' '}
            </span>
          ))}
        </p>
      )}
    </button>
  )
}
