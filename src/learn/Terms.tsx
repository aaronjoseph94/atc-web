/**
 * Text with its ATC terms underlined, in Learn mode. Tapping a term opens its
 * explanation (TermPopover). With Learn mode off this is just the text, so it
 * can wrap any line of transcript, caption or ATIS at no cost.
 *
 * The lines it wraps are often inside a button (a transcript row plays its
 * call, the caption opens the transcript), so a term is a focusable span that
 * stops the tap from reaching the button underneath.
 */
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import { useInsightSettings } from '../insights/insightSettings'
import { segmentTerms } from './detect'
import { useLearn } from './learnStore'

export function Terms({ text, force = false }: { text: string; force?: boolean }) {
  const learn = useInsightSettings((s) => s.learn) || force
  if (!learn || !text) return <>{text}</>
  const segs = segmentTerms(text)
  if (segs.length === 1 && !segs[0].hit) return <>{text}</>
  return (
    <>
      {segs.map((s, i) => (s.hit ? <Term key={i} id={s.hit.id} text={s.text} /> : <span key={i}>{s.text}</span>))}
    </>
  )
}

function Term({ id, text }: { id: string; text: string }) {
  const open = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    useLearn.getState().show({ id, text, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } })
  }
  const onClick = (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation()
    e.preventDefault()
    open(e.currentTarget)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.stopPropagation()
    e.preventDefault()
    open(e.currentTarget)
  }
  // Sheets and cards start a drag on pointer down; a term tap is not a drag.
  const stop = (e: PointerEvent) => e.stopPropagation()
  return (
    <span
      role="button"
      tabIndex={0}
      data-term={id}
      data-no-drag
      aria-label={`${text}: what does this mean?`}
      className="cursor-help rounded-[3px] underline decoration-[#A78BFA] decoration-dotted decoration-2 underline-offset-[5px] transition-colors hover:bg-atc-purple/20 focus-visible:bg-atc-purple/25 focus-visible:outline-none"
      onClick={onClick}
      onKeyDown={onKeyDown}
      onPointerDown={stop}
    >
      {text}
    </span>
  )
}
