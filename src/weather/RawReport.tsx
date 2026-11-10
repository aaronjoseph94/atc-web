/**
 * A raw report (METAR or TAF) folded into one line: the start of the text as
 * a preview, tap to unfold it in full, and a copy button that works either way.
 */
import { Check, ChevronRight, Copy } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

export function RawReport({ label, text, lines, defaultOpen = false }: { label: string; text: string; lines?: string[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const [copied, setCopied] = useState(false)
  const body = useId()
  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(id)
  }, [copied])
  const copy = () => {
    navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }
  return (
    <div className="rounded-2xl bg-white/[0.05] ring-1 ring-inset ring-white/[0.06]">
      <div className="flex items-center gap-1 pr-1.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={body}
          className="pressable-soft flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-2xl py-2 pl-3.5 pr-1 text-left"
          onClick={() => setOpen(!open)}
        >
          <ChevronRight aria-hidden className={`size-4 shrink-0 text-white/50 transition-transform duration-[var(--duration-base)] ease-[var(--ease-out)] ${open ? 'rotate-90' : ''}`} strokeWidth={2.5} />
          <span className="shrink-0 text-footnote font-semibold">{label}</span>
          <span aria-hidden className={`min-w-0 truncate font-mono text-caption text-white/40 transition-opacity duration-[var(--duration-fast)] ${open ? 'opacity-0' : ''}`}>{text}</span>
        </button>
        <button
          type="button"
          aria-label={copied ? 'Copied' : `Copy the ${label.replace(/^Raw /, '')}`}
          title="Copy"
          className={`pressable grid size-9 shrink-0 place-items-center rounded-full transition-colors ${copied ? 'bg-[#30D158]/15 text-[#5BE07F]' : 'bg-white/[0.07] text-white/70 hover:bg-white/[0.13] hover:text-white'}`}
          onClick={copy}
        >
          {copied ? <Check className="size-4" strokeWidth={2.75} /> : <Copy className="size-4" strokeWidth={2.25} />}
        </button>
        <span className="sr-only" aria-live="polite">
          {copied ? 'Copied' : ''}
        </span>
      </div>
      {/* Unfolds by animating the row height from 0fr to 1fr, so no measuring is needed. */}
      <div id={body} className={`grid transition-[grid-template-rows] duration-[var(--duration-base)] ease-[var(--ease-out)] ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="min-h-0 overflow-hidden" inert={!open}>
          <pre className="whitespace-pre-wrap break-words px-3.5 pb-3.5 font-mono text-caption leading-[18px] text-white/80">{(lines ?? [text]).map((l, i) => (i ? `\n  ${l}` : l)).join('')}</pre>
        </div>
      </div>
    </div>
  )
}
