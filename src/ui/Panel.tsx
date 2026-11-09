/**
 * Shared overlay primitives so every panel/sheet looks and behaves the same:
 * Escape closes, backdrop click closes, content animates in, and desktop
 * layouts get a centred card while mobile gets a bottom sheet.
 */
import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'

type BaseProps = {
  title: string
  onClose: () => void
  children: ReactNode
  /** Extra element rendered in the header, left of the close button. */
  headerExtra?: ReactNode
}

/** Close on Escape while mounted. */
function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}

function Header({ title, onClose, headerExtra }: Omit<BaseProps, 'children'>) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <div className="flex items-center gap-2">
        {headerExtra}
        <button
          type="button"
          aria-label="Close"
          className="rounded-full bg-white/10 p-2 transition hover:bg-white/20"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}

/** Bottom sheet on mobile, centred modal on ≥ md. Scrolls internally. */
export function Sheet({ title, onClose, children, headerExtra }: BaseProps) {
  useEscape(onClose)
  return (
    <div className="absolute inset-0 z-50 flex items-end justify-center md:items-center">
      <button type="button" aria-label="Close" className="absolute inset-0 animate-fade bg-black/55" onClick={onClose} />
      <div
        role="dialog"
        aria-label={title}
        className="relative flex max-h-[85dvh] w-full animate-rise flex-col overflow-hidden rounded-t-3xl bg-atc-panel shadow-2xl ring-1 ring-white/10 md:max-h-[80dvh] md:w-[min(92vw,34rem)] md:rounded-3xl"
      >
        <Header title={title} onClose={onClose} headerExtra={headerExtra} />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,var(--safe-bottom))] pt-3">
          {children}
        </div>
      </div>
    </div>
  )
}

/** Full-height panel (mobile) / wide centred card (desktop) for list-heavy views. */
export function FullPanel({ title, onClose, children, headerExtra }: BaseProps) {
  useEscape(onClose)
  return (
    <div className="absolute inset-0 z-40 flex items-stretch justify-center bg-atc-bg/80 backdrop-blur-md md:items-center md:p-6">
      <div
        role="dialog"
        aria-label={title}
        className="flex w-full animate-rise flex-col overflow-hidden bg-atc-panel pt-[var(--safe-top)] md:max-h-[85dvh] md:w-[min(94vw,44rem)] md:rounded-3xl md:pt-0 md:shadow-2xl md:ring-1 md:ring-white/10"
      >
        <Header title={title} onClose={onClose} headerExtra={headerExtra} />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,var(--safe-bottom))] pt-3">
          {children}
        </div>
      </div>
    </div>
  )
}

/** Small uppercase section label used inside panels. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.12em] text-atc-muted first:mt-1">{children}</h3>
}
