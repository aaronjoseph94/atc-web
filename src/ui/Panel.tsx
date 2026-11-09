/**
 * Shared overlay primitives so every panel/sheet looks and behaves the same:
 * Escape closes, backdrop click closes, content animates in and out, focus
 * moves into the dialog and returns to where it was, a downward drag on the
 * header dismisses, and desktop layouts get a centred card while mobile gets
 * a bottom sheet.
 */
import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { usePresence } from './usePresence'
import { useSheetDrag } from './useSheetDrag'

type BaseProps = {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** Extra element rendered in the header, left of the close button. */
  headerExtra?: ReactNode
  /** `dark` (default) or the yellow signage surface used by the channel switcher. */
  tone?: 'dark' | 'black'
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Escape to close, Tab kept inside, focus restored on unmount. */
export function useDialog(active: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  useEffect(() => {
    if (!active) return
    const previous = document.activeElement as HTMLElement | null
    const node = ref.current
    // Focus the dialog itself rather than its first control, so screen readers
    // announce the title and touch users don't get a keyboard popping up.
    node?.focus({ preventScroll: true })

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close.current()
        return
      }
      if (e.key !== 'Tab' || !node) return
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      previous?.focus?.({ preventScroll: true })
    }
  }, [active])

  return ref
}

function Header({ title, onClose, headerExtra }: Pick<BaseProps, 'title' | 'onClose' | 'headerExtra'>) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-1">
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      <div className="flex items-center gap-2" data-no-drag>
        {headerExtra}
        <button
          type="button"
          aria-label="Close"
          className="grid size-9 place-items-center rounded-full bg-white/10 transition hover:bg-white/20 active:scale-90"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}

export function Grabber({ dark = false }: { dark?: boolean }) {
  return <div className={`mx-auto mt-2 h-1 w-10 shrink-0 rounded-full ${dark ? 'bg-black/25' : 'bg-white/25'}`} aria-hidden />
}

/** Bottom sheet on mobile, centred modal on ≥ md. Scrolls internally. */
export function Sheet({ open, title, onClose, children, headerExtra, tone = 'dark' }: BaseProps) {
  const { mounted, closing } = usePresence(open, 240)
  const ref = useDialog(open, onClose)
  const drag = useSheetDrag({ onDown: onClose })
  if (!mounted) return null
  return (
    <div className="absolute inset-0 z-50 flex items-end justify-center md:items-center">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        className={`absolute inset-0 bg-black/55 backdrop-blur-[2px] ${closing ? 'animate-fade-out' : 'animate-fade'}`}
        onClick={onClose}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={drag.dragging || drag.style.transform ? drag.style : undefined}
        className={`relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-[1.75rem] shadow-2xl ring-1 ring-white/10 outline-none md:max-h-[82dvh] md:w-[min(92vw,34rem)] md:rounded-[1.75rem] ${
          tone === 'black' ? 'bg-black' : 'bg-atc-panel'
        } ${closing ? 'animate-sheet-out md:animate-pop-out' : 'animate-sheet-in md:animate-pop'}`}
      >
        <div {...drag.handlers} className="shrink-0 cursor-grab touch-none active:cursor-grabbing md:cursor-default">
          <div className="md:hidden">
            <Grabber />
          </div>
          <div className="pt-2">
            <Header title={title} onClose={onClose} headerExtra={headerExtra} />
          </div>
        </div>
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1.25rem,var(--safe-bottom))]">{children}</div>
      </div>
    </div>
  )
}

/** Full-height panel (mobile) / wide centred card (desktop) for list-heavy views. */
export function FullPanel({ open, title, onClose, children, headerExtra, tone = 'dark' }: BaseProps) {
  const { mounted, closing } = usePresence(open, 240)
  const ref = useDialog(open, onClose)
  const drag = useSheetDrag({ onDown: onClose, threshold: 90 })
  if (!mounted) return null
  return (
    <div className="absolute inset-0 z-50 flex items-stretch justify-center md:items-center md:p-6">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm ${closing ? 'animate-fade-out' : 'animate-fade'}`}
        onClick={onClose}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={drag.dragging || drag.style.transform ? drag.style : undefined}
        className={`relative mt-[max(2.5rem,var(--safe-top))] flex w-full flex-col overflow-hidden rounded-t-[1.75rem] shadow-2xl ring-1 ring-white/10 outline-none md:mt-0 md:max-h-[86dvh] md:w-[min(94vw,44rem)] md:rounded-[1.75rem] ${
          tone === 'black' ? 'bg-black' : 'bg-atc-panel'
        } ${closing ? 'animate-sheet-out md:animate-pop-out' : 'animate-sheet-in md:animate-pop'}`}
      >
        <div {...drag.handlers} className="shrink-0 cursor-grab touch-none active:cursor-grabbing md:cursor-default">
          <div className="md:hidden">
            <Grabber />
          </div>
          <div className="pt-2">
            <Header title={title} onClose={onClose} headerExtra={headerExtra} />
          </div>
        </div>
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,var(--safe-bottom))]">{children}</div>
      </div>
    </div>
  )
}

/** Small section label used inside panels. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 mt-6 text-[13px] font-semibold text-atc-muted first:mt-1">{children}</h3>
}

/** Round glass button used for the controls floating over the map. */
export function GlassButton({
  label,
  onClick,
  active = false,
  children,
  className = '',
}: {
  label: string
  onClick: () => void
  active?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      onClick={onClick}
      className={`pointer-events-auto grid size-11 place-items-center rounded-full shadow-lg ring-1 backdrop-blur-xl transition duration-150 active:scale-90 ${
        active ? 'bg-atc-yellow text-black ring-black/10' : 'bg-[#1b2333]/75 text-white ring-white/15 hover:bg-[#263043]/85'
      } ${className}`}
    >
      {children}
    </button>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${checked ? 'bg-atc-yellow' : 'bg-white/15'}`}
      onClick={() => onChange(!checked)}
    >
      <span
        className={`absolute left-1 top-1 size-5 rounded-full bg-white shadow transition-transform duration-200 ease-[var(--ease-spring)] ${checked ? 'translate-x-5' : ''}`}
      />
    </button>
  )
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-xl bg-white/10 p-0.5 text-xs font-medium">
      {options.map(([v, text]) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={v === value}
          className={`rounded-[0.6rem] px-2.5 py-1.5 transition ${v === value ? 'bg-atc-yellow font-semibold text-black shadow' : 'text-white/75 hover:text-white'}`}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

/** A labelled setting row. */
export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/5 py-3 last:border-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs leading-snug text-atc-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
