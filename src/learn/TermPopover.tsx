/**
 * The explanation of a tapped term: what it means in plain English, a line
 * about the exact words heard ("FL350 is about 35,000 ft"), and a small
 * diagram where one helps. A card beside the words on wide screens, a sheet
 * from the bottom on phones. Works offline: it is all from the glossary.
 */
import { BookOpen, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePresence } from '../ui/usePresence'
import { Diagram } from './diagrams'
import { GLOSSARY_BY_ID } from './glossary'
import { useLearn, type OpenTerm } from './learnStore'

const W = 330

function usePhone() {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640)
  useEffect(() => {
    const on = () => setPhone(window.innerWidth < 640)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return phone
}

export function TermPopover() {
  const open = useLearn((s) => s.open)
  const close = useLearn((s) => s.close)
  const { mounted, closing } = usePresence(!!open, 180)
  const [last, setLast] = useState<OpenTerm | null>(open)
  if (open && open !== last) setLast(open)
  const shown = open ?? last

  // Listening from the start (this is mounted with the app) puts this ahead of any sheet's own
  // Escape handler, so Escape closes the explanation and leaves the sheet under it open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !useLearn.getState().open) return
      e.stopImmediatePropagation()
      useLearn.getState().close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  if (!mounted || !shown) return null
  // Keyed by the term, so a tap on another term starts afresh (position, focus).
  return <Card key={`${shown.id}|${shown.text}|${shown.rect?.left ?? ''}`} term={shown} closing={closing} onClose={close} />
}

function Card({ term, closing, onClose }: { term: OpenTerm; closing: boolean; onClose: () => void }) {
  const entry = GLOSSARY_BY_ID[term.id]
  const phone = usePhone()
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Beside the words: below them when there is room, else above; kept on screen.
  useLayoutEffect(() => {
    if (phone || !term.rect || !box.current) return
    const h = box.current.offsetHeight
    const r = term.rect
    const left = Math.min(Math.max(12, (r.left + r.right) / 2 - W / 2), window.innerWidth - W - 12)
    const below = r.bottom + 8
    const top = below + h < window.innerHeight - 12 ? below : Math.max(12, r.top - 8 - h)
    setPos({ left, top })
  }, [phone, term])

  useEffect(() => {
    box.current?.focus({ preventScroll: true })
  }, [])

  if (!entry) return null
  const detail = entry.detail?.(term.text) ?? null
  const heard = term.text.toLowerCase() !== entry.term.toLowerCase() ? term.text : null

  return (
    <div className="fixed inset-0 z-[80]" data-closing={closing ? '' : undefined}>
      <button type="button" tabIndex={-1} aria-label="Close explanation" className={`absolute inset-0 cursor-default ${phone ? `bg-black/45 ${closing ? 'animate-fade-out' : 'animate-fade'}` : ''}`} onClick={onClose} />
      <div
        ref={box}
        role="dialog"
        aria-modal="false"
        aria-label={`What “${entry.term}” means`}
        tabIndex={-1}
        data-closing={closing ? '' : undefined}
        style={phone ? undefined : { width: W, left: pos?.left ?? -9999, top: pos?.top ?? 0 }}
        className={`glass-pop absolute overflow-hidden text-white shadow-pop ring-1 ring-white/[0.12] outline-none ${
          phone ? `inset-x-0 bottom-0 rounded-t-[1.6rem] pb-[max(1rem,var(--safe-bottom))] ${closing ? 'animate-sheet-out' : 'animate-sheet-in'}` : 'motion-pop rounded-2xl'
        }`}
      >
        <div className="flex items-start gap-3 px-4 pb-1 pt-3.5">
          <div className="min-w-0 flex-1">
            <div className="text-caption2 font-semibold uppercase tracking-[0.08em] text-[#C9BCFF]">{entry.category}</div>
            <h2 className="mt-0.5 text-title3 font-semibold">{entry.term}</h2>
            {heard && <p className="mt-0.5 truncate text-caption text-white/50">Heard: “{heard}”</p>}
          </div>
          <button type="button" aria-label="Close" className="pressable grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-white/80 hover:bg-white/20" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[60dvh] overflow-y-auto px-4 pb-3">
          <p className="text-subhead leading-snug text-white/90">{entry.text}</p>
          {detail && <p className="mt-2 rounded-xl bg-atc-purple/15 px-3 py-2 text-footnote font-medium text-[#DCD3FF] ring-1 ring-inset ring-atc-purple/30">{detail}</p>}
          {entry.diagram && <Diagram id={entry.diagram} label={`Diagram: ${entry.term}`} className="mt-3 ring-1 ring-white/[0.08]" />}
          <button
            type="button"
            className="pressable-soft mt-3 flex items-center gap-1.5 rounded-full px-1 text-footnote font-semibold text-[#C9BCFF] hover:text-white"
            onClick={() => useLearn.getState().openGlossary()}
          >
            <BookOpen className="size-4" />
            All ATC terms
          </button>
        </div>
      </div>
    </div>
  )
}
