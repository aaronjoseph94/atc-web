/**
 * The running subtitle over the bottom of the map.
 *
 * Playback: the radio call being spoken, lit word by word, with the previous
 * call dimmed above it. Live with the radio on: the latest transcribed call
 * from the stream, the same way. Live without radio: the latest tower-log
 * event. Tapping it opens the full transcript or log.
 */
import { useEffect, useMemo, useState } from 'react'
import type { TranscriptCue } from '../api/types'
import { useRadio, type Transmission } from '../live/radio/radioStore'
import { cueProgress, getActiveCue } from '../playback/interpolate'
import { usePlayhead } from '../playback/playheadStore'
import { useReducedMotion } from '../ui/motion'
import { Terms } from '../learn/Terms'

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

/**
 * Caption text sits in a soft, wide, faint glow of the scrim's own navy
 * rather than a tight dark shadow: it lifts the words off bright runway
 * paint without the outlined, embossed look a hard shadow gives. Earlier
 * lines, already dim, get a lighter glow.
 */
const GLOW = '[text-shadow:0_0_22px_rgba(6,10,22,0.5),0_0_44px_rgba(6,10,22,0.3),0_2px_16px_rgba(6,10,22,0.32)]'
const GLOW_SOFT = '[text-shadow:0_0_20px_rgba(6,10,22,0.42),0_0_40px_rgba(6,10,22,0.24)]'

/**
 * How far through a live call the highlight has swept. Live transcripts
 * arrive just after the call ends, so the words light up briskly (at about
 * twice speaking pace) rather than pretending to be in sync.
 */
function useSweep(call: Transmission | null): number {
  const reduceMotion = useReducedMotion()
  const [sweep, setSweep] = useState<{ id: string | null; p: number }>({ id: null, p: 1 })
  const id = call?.id ?? null
  const durationMs = call?.durationMs ?? 0
  useEffect(() => {
    if (!id || reduceMotion) return
    const total = Math.min(3200, Math.max(700, durationMs * 0.5))
    const start = performance.now()
    let raf = 0
    const tick = () => {
      const p = Math.min(1, (performance.now() - start) / total)
      setSweep({ id, p })
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [id, durationMs, reduceMotion])
  if (!id || reduceMotion) return 1
  return sweep.id === id ? sweep.p : 0
}

/** Three dots that breathe while somebody is transmitting and the words are on their way. */
function Receiving({ label }: { label: string }) {
  return (
    <span className="mt-1 flex items-center gap-1.5 text-[13px] font-semibold text-white/55" role="status">
      <span className="size-1.5 animate-pulse-dot rounded-full bg-white/70" />
      <span className="size-1.5 animate-pulse-dot rounded-full bg-white/70 [animation-delay:0.2s]" />
      <span className="size-1.5 animate-pulse-dot rounded-full bg-white/70 [animation-delay:0.4s]" />
      <span className="ml-1">{label}</span>
    </span>
  )
}

/** The live radio caption: the latest transcribed call, with the one before it dimmed above. */
function RadioCaption() {
  const call = useRadio((s) => s.caption)
  const speaking = useRadio((s) => s.speaking)
  const pending = useRadio((s) => s.pending)
  const transcripts = useRadio((s) => s.transcripts)
  const previous = useRadio((s) => {
    if (!s.caption) return null
    const list = s.log[s.caption.stationId] ?? []
    const i = list.findIndex((t) => t.id === s.caption?.id)
    return i > 0 ? list[i - 1] : null
  })
  const setPanel = usePlayhead((s) => s.setPanel)
  const progress = useSweep(call)
  const canTranscribe = transcripts !== 'unavailable'
  // Someone on the air is worth showing even where nothing will be written out.
  const busy = speaking || (canTranscribe && pending > 0)
  if (!call && !busy) return null
  const words = call ? call.text.split(/\s+/) : []
  const spoken = spokenWordCount(words, progress)

  return (
    <button type="button" className={SCRIM} onClick={() => setPanel('transcripts')} aria-label="Open the radio transcript">
      {previous && <p className={`line-clamp-1 text-[19px] font-semibold leading-snug text-white/35 ${GLOW_SOFT}`}>{previous.text}</p>}
      {call && (
        <p key={call.id} className={`animate-caption line-clamp-4 text-[21px] font-semibold leading-snug ${GLOW}`}>
          {/* Once every word is lit, Learn mode can underline its terms. */}
          {spoken >= words.length ? (
            <span className="text-white">
              <Terms text={call.text} />
            </span>
          ) : (
            words.map((w, i) => (
              <span key={i} className={`transition-colors duration-200 ${i < spoken ? 'text-white' : 'text-white/40'}`}>
                {w}{' '}
              </span>
            ))
          )}
        </p>
      )}
      {busy && <Receiving label={speaking ? 'On the air' : 'Transcribing'} />}
    </button>
  )
}

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

  const radioOn = useRadio((s) => (s.on && s.status !== 'off' && s.status !== 'nofeed') || !!s.caption)

  if (mode === 'live') {
    if (radioOn) return <RadioCaption />
    if (!caption) return null
    return (
      <button type="button" className={SCRIM} onClick={() => setPanel('traffic')} aria-label="Open recent activity">
        {previousEvent && <p className={`line-clamp-1 text-[19px] font-semibold leading-snug text-white/35 ${GLOW_SOFT}`}>{previousEvent.text}</p>}
        <p key={caption.id} className={`animate-caption text-[21px] font-semibold leading-snug text-white ${GLOW}`}>
          <Terms text={caption.text} />
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
          className={`text-[19px] font-semibold leading-snug ${GLOW_SOFT} ${
            i < earlier.length - 1 ? 'line-clamp-1 text-white/25' : `line-clamp-2 ${active ? 'text-white/50' : 'text-white/60'}`
          }`}
        >
          {c.text}
        </p>
      ))}
      {active && (
        <p key={active.id} className={`animate-caption text-[21px] font-semibold leading-snug ${GLOW}`} aria-live="off">
          {spoken >= words.length ? (
            <span className="text-white">
              <Terms text={active.text} />
            </span>
          ) : (
            words.map((w, i) => (
              <span key={i} className={`transition-colors duration-200 ${i < spoken ? 'text-white' : 'text-white/40'}`}>
                {w}{' '}
              </span>
            ))
          )}
        </p>
      )}
    </button>
  )
}
