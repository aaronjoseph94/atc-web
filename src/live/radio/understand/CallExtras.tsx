/**
 * The AI's part of a heard call, wherever calls are listed: a plain-English
 * line under the call, a "Switch to Departure 124.75" chip for a handoff,
 * the "Explain calls" switch, a flight's story so far, and the small
 * "unprocessed" mark on a call shown without the AI pass.
 *
 * A call normally arrives already processed (cleaned words, speaker); see
 * ../gate.ts. Everything here quietly shows nothing when there is no answer.
 */
import { ArrowRightLeft, Sparkles } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getAirport } from '../../../api/airports'
import { usePlayhead } from '../../../playback/playheadStore'
import { useReducedMotion } from '../../../ui/motion'
import type { Transmission } from '../radioStore'
import { tuneRadio } from '../useLiveRadio'
import { handoffLabel, resolveHandoff } from './handoff'
import type { Instruction } from './instructions'
import { setExplain, useUnderstanding, useUnderstood } from './store'
import { threadStory } from './threads'
import { checkAi } from './understand'

/**
 * Its children, faded in when `swapKey` changes after first render: a call
 * shown unprocessed whose answer then arrives settles into its processed
 * words rather than jumping. Nothing animates for a call that was already
 * processed when it came into view.
 */
export function FadeSwap({ swapKey, children, className }: { swapKey: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const first = useRef(swapKey)
  const reduce = useReducedMotion()
  useLayoutEffect(() => {
    if (swapKey === first.current || reduce) return
    ref.current?.animate?.([{ opacity: 0.25 }, { opacity: 1 }], { duration: 520, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })
  }, [swapKey, reduce])
  return (
    <span ref={ref} className={className} data-cleaned={swapKey === 'cleaned' || undefined}>
      {children}
    </span>
  )
}

/**
 * The quiet mark on a call shown as recognised, without the AI pass (AI off
 * or over its limit, or the answer was too slow). One component, used by the
 * caption, the transcript and the flight conversation.
 */
export function UnprocessedMark({ className = '' }: { className?: string }) {
  return (
    <span data-unprocessed title="Shown as heard; the AI clean-up was not available" className={`ml-1.5 inline-block select-none whitespace-nowrap align-middle text-[10px] font-semibold uppercase leading-none tracking-[0.06em] opacity-45 ${className}`}>
      unprocessed
    </span>
  )
}

/** A call's words, with the mark when they have not been through the AI pass. */
export function CallText({ call }: { call: Pick<Transmission, 'id' | 'text' | 'unprocessed'> }) {
  return (
    <>
      <FadeSwap swapKey={call.unprocessed ? 'raw' : 'ready'}>{call.text}</FadeSwap>
      {call.unprocessed && <UnprocessedMark />}
    </>
  )
}

/** The small sparkle that marks AI-written text. */
export function AiMark({ className = 'size-3' }: { className?: string }) {
  return <Sparkles className={`${className} shrink-0 text-[#C9BCFF]`} strokeWidth={2.25} aria-label="Written by AI" />
}

/** "Switch to Departure 124.75": tunes that channel when it has live audio; just says it otherwise. */
export function HandoffChip({ handoff, tone = 'dark' }: { handoff: Extract<Instruction, { kind: 'handoff' }>; tone?: 'dark' | 'bubble' }) {
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const stationId = usePlayhead((s) => s.stationId)
  const mode = usePlayhead((s) => s.mode)
  const target = useMemo(() => resolveHandoff(handoff, getAirport(airportIcao).stations), [handoff, airportIcao])
  const label = handoffLabel(handoff, target)
  if (!label) return null
  const here = target?.station.id === stationId
  const cls = `inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-caption font-semibold ${tone === 'bubble' ? 'bg-black/20' : 'bg-white/[0.08]'}`
  if (!target?.audible || here || mode !== 'live')
    return (
      <span className={`${cls} text-white/60`}>
        <ArrowRightLeft className="size-3 shrink-0" strokeWidth={2.5} aria-hidden />
        <span className="truncate">{here ? `On ${label}` : label}</span>
      </span>
    )
  return (
    <button
      type="button"
      data-no-drag
      className={`${cls} pressable-soft bg-atc-card/35 text-white ring-1 ring-inset ring-atc-card/70 hover:bg-atc-card/55`}
      onClick={(e) => {
        e.stopPropagation()
        usePlayhead.getState().setStationId(target.station.id)
        // Straight from the tap, so the browser lets the audio start.
        tuneRadio(target.station)
      }}
    >
      <ArrowRightLeft className="size-3 shrink-0" strokeWidth={2.5} aria-hidden />
      <span className="truncate">Switch to {label}</span>
    </button>
  )
}

/**
 * Under a call in the transcript: its plain-English meaning (always shown
 * with "Explain calls" on, else behind a small "Explain" toggle) and a
 * handoff chip.
 */
export function CallExtras({ id, tone = 'dark', align = 'start' }: { id: string; tone?: 'dark' | 'bubble'; align?: 'start' | 'end' }) {
  const u = useUnderstood(id)
  const explainAll = useUnderstanding((s) => s.explain)
  const [open, setOpen] = useState(false)
  if (!u) return null
  const handoff = u.instructions.find((i): i is Extract<Instruction, { kind: 'handoff' }> => i.kind === 'handoff')
  const plain = u.plain
  if (!plain && !handoff) return null
  const shown = explainAll || open
  return (
    <div className={`animate-fade mt-1 flex flex-col gap-1 ${align === 'end' ? 'items-end' : 'items-start'}`}>
      {plain && shown && (
        <p className="flex max-w-full items-start gap-1.5 text-footnote leading-snug text-white/70">
          <AiMark className="mt-[3px] size-3" />
          <span>{plain}</span>
        </p>
      )}
      <div className="flex max-w-full flex-wrap items-center gap-1.5">
        {plain && !explainAll && (
          <button
            type="button"
            data-no-drag
            aria-expanded={open}
            className="pressable-soft inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-caption font-semibold text-[#C9BCFF]/85 hover:bg-white/[0.06] hover:text-[#C9BCFF]"
            onClick={(e) => {
              e.stopPropagation()
              setOpen((v) => !v)
            }}
          >
            {!open && <Sparkles className="size-3" strokeWidth={2.25} aria-hidden />}
            {open ? 'Hide' : 'Explain'}
          </button>
        )}
        {handoff && <HandoffChip handoff={handoff} tone={tone} />}
      </div>
    </div>
  )
}

/** One quiet line for the transcript header when calls are shown without the AI pass (no nagging beyond that). */
export function AiHint() {
  const ai = useUnderstanding((s) => s.ai)
  if (ai !== 'off' && ai !== 'limited') return null
  return (
    <p className="-mt-1.5 mb-2.5 truncate text-caption text-white/40">
      {ai === 'limited' ? 'AI daily limit reached: calls are shown as heard until tomorrow' : 'AI clean-up is off: calls are shown as heard'}
    </p>
  )
}

/** The transcript header's switch for plain-English lines under every call (shown once AI is known to be available). */
export function ExplainToggle() {
  const ai = useUnderstanding((s) => s.ai)
  const explain = useUnderstanding((s) => s.explain)
  useEffect(() => void checkAi(), [])
  if (ai !== 'on') return null
  return (
    <button
      type="button"
      role="switch"
      aria-checked={explain}
      className={`pressable-soft flex h-7 shrink-0 items-center gap-1.5 rounded-full pl-2 pr-2.5 text-caption font-semibold transition-colors duration-[var(--duration-fast)] ${explain ? 'bg-atc-card text-white' : 'bg-white/[0.09] text-white/75 hover:bg-white/[0.15] hover:text-white'}`}
      onClick={() => setExplain(!explain)}
    >
      <Sparkles className="size-3.5" strokeWidth={2.25} aria-hidden />
      Explain calls
    </button>
  )
}

/** A flight's story so far, from the instructions understood in its calls. */
export function ThreadStory({ calls, icao24 }: { calls: Transmission[]; icao24: string }) {
  const results = useUnderstanding((s) => s.results)
  const story = useMemo(() => threadStory(calls, results, icao24), [calls, results, icao24])
  if (!story) return null
  return (
    <p className="animate-fade mb-3 flex items-start gap-2 rounded-2xl bg-atc-card/20 px-3.5 py-2.5 text-[14px] font-semibold leading-snug text-white/90 ring-1 ring-inset ring-atc-card/45">
      <AiMark className="mt-[3px] size-3.5" />
      <span>{story}</span>
    </p>
  )
}
