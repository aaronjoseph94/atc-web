/**
 * Shared overlay primitives so every panel/sheet looks and behaves the same:
 * Escape closes, backdrop click closes, content animates in and out (and can
 * be reversed mid-way without a jump), focus moves into the dialog and
 * returns to where it was, dragging the header down (or pulling down from
 * the top of the content) dismisses, and desktop layouts get a centred card
 * while mobile gets a bottom sheet.
 */
import { X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { DURATION } from './motion'
import { usePresence } from './usePresence'
import { useSheetDrag } from './useSheetDrag'

type BaseProps = {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** Extra element rendered in the header, left of the close button. */
  headerExtra?: ReactNode
  /** Pinned above the scrolling content (a search box, say): it never scrolls, so nothing peeks out around it. */
  pinned?: ReactNode
  /** `dark` (default) panel colour, or pure black for reading views. */
  tone?: 'dark' | 'black'
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Wide layouts show panels as centred cards, which don't drag. */
const isDesktop = () => typeof matchMedia !== 'undefined' && matchMedia('(min-width: 768px)').matches
const notDesktop = () => !isDesktop()

/**
 * Escape to close, Tab kept inside, focus restored on unmount. Returns a
 * callback ref for the dialog element.
 */
export function useDialog(active: boolean, onClose: () => void) {
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const ref = useCallback((el: HTMLDivElement | null) => setNode(el), [])
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  useEffect(() => {
    if (!active || !node) return
    const previous = document.activeElement as HTMLElement | null
    // Focus the dialog itself rather than its first control, so screen readers
    // announce the title and touch users don't get a keyboard popping up.
    node.focus({ preventScroll: true })

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close.current()
        return
      }
      if (e.key !== 'Tab') return
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
  }, [active, node])

  return ref
}

/** Round close button used in sheet and card headers. */
export function CloseButton({ onClick, label = 'Close', className = '' }: { onClick: () => void; label?: string; className?: string }) {
  return (
    <button type="button" aria-label={label} className={`pressable grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-white/80 hover:bg-white/[0.18] hover:text-white ${className}`} onClick={onClick}>
      <X className="size-4" strokeWidth={2.5} />
    </button>
  )
}

function Header({ title, onClose, headerExtra }: Pick<BaseProps, 'title' | 'onClose' | 'headerExtra'>) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 px-4 pb-2.5 pt-1 md:px-5">
      <h2 className="min-w-0 truncate text-title3 font-bold">{title}</h2>
      <div className="flex shrink-0 items-center gap-2" data-no-drag>
        {headerExtra}
        <CloseButton onClick={onClose} />
      </div>
    </div>
  )
}

export function Grabber({ dark = false }: { dark?: boolean }) {
  return <div className={`sheet-grabber mx-auto mt-2 h-[5px] w-9 shrink-0 rounded-full ${dark ? 'bg-black/25' : 'bg-white/25'}`} aria-hidden />
}

/**
 * The shared body of `Sheet` and `FullPanel`. Mobile: a sheet from the bottom
 * edge that follows the finger. Desktop: a centred card that fades in.
 */
function Overlay({ open, title, onClose, children, headerExtra, pinned, tone = 'dark', full }: BaseProps & { full: boolean }) {
  // Kept mounted a little past the longest exit so it is never cut short.
  const { mounted, closing } = usePresence(open, DURATION.exit + 60)
  const dialog = useDialog(open, onClose)
  const { attach, attachBackdrop, attachScroll, handlers } = useSheetDrag({ onDown: onClose, threshold: full ? 90 : 64, enabled: notDesktop })
  // The dialog element is both the focus trap and the thing that moves.
  const bind = useCallback(
    (node: HTMLDivElement | null) => {
      dialog(node)
      attach(node)
    },
    [dialog, attach],
  )
  if (!mounted) return null
  const state = closing ? '' : undefined
  return (
    <div className={`absolute inset-0 z-50 flex justify-center md:items-center md:p-6 ${full ? 'items-stretch' : 'items-end'}`}>
      <button
        ref={attachBackdrop}
        type="button"
        tabIndex={-1}
        aria-label="Close"
        data-closing={state}
        className="motion-fade absolute inset-0 cursor-default bg-black/55"
        onClick={onClose}
      />
      <div
        ref={bind}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-closing={state}
        className={`motion-modal grain relative flex w-full flex-col overflow-hidden rounded-t-sheet shadow-pop ring-1 ring-white/[0.08] outline-none will-change-transform md:rounded-sheet ${
          full ? 'mt-[max(2.5rem,var(--safe-top))] md:mt-0 md:max-h-[86dvh] md:w-[min(94vw,44rem)]' : 'max-h-[88dvh] md:max-h-[82dvh] md:w-[min(92vw,34rem)]'
        } ${tone === 'black' ? 'bg-black' : 'glass-sheet'}`}
      >
        <div {...handlers} className="shrink-0 cursor-grab touch-none select-none active:cursor-grabbing md:cursor-default">
          <div className="md:hidden">
            <Grabber />
          </div>
          <div className="pt-2 md:pt-4">
            <Header title={title} onClose={onClose} headerExtra={headerExtra} />
          </div>
        </div>
        {pinned && <div className="shrink-0 px-4 pb-2 md:px-5">{pinned}</div>}
        <div ref={attachScroll} className="scroll-quiet scroll-fade @container min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,var(--safe-bottom))] md:px-5">
          {children}
        </div>
      </div>
    </div>
  )
}

/** Bottom sheet on mobile, centred modal on ≥ md. Scrolls internally. */
export function Sheet(props: BaseProps) {
  return <Overlay {...props} full={false} />
}

/** Full-height panel (mobile) / wide centred card (desktop) for list-heavy views. */
export function FullPanel(props: BaseProps) {
  return <Overlay {...props} full />
}

/**
 * A `FullPanel`, or, with `docked`, just its scrolling body for the desktop
 * side panel (which supplies the frame, tabs and close). Lets one component
 * serve both layouts with a one-line change.
 */
export function PanelFrame({ docked = false, ...props }: BaseProps & { docked?: boolean }) {
  if (!docked) return <FullPanel {...props} />
  return (
    <div className="flex h-full flex-col">
      <h2 className="sr-only">{props.title}</h2>
      {props.pinned && <div className="shrink-0 px-3 pb-2 pt-1">{props.pinned}</div>}
      <div className="scroll-quiet scroll-fade @container min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-6 pt-1">{props.children}</div>
    </div>
  )
}

/**
 * The one section heading used in every panel and sheet: a quiet label, an
 * optional count after it, and an optional note or action at the far end
 * (kept out of the heading itself, so its name stays clean for screen readers).
 */
export function SectionLabel({ children, count, aside }: { children: ReactNode; count?: number | string | null; aside?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-baseline gap-2 px-1 first:mt-1">
      <h3 className="flex min-w-0 items-center gap-1.5 text-footnote font-semibold text-white/60">
        <span className="truncate">{children}</span>
        {count != null && <span className="font-normal tabular-nums text-white/45">{count}</span>}
      </h3>
      {aside != null && <div className="ml-auto shrink-0 text-caption text-white/50">{aside}</div>}
    </div>
  )
}

/** An inset, rounded group of rows, as in iOS settings. */
export function Group({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`ui-card px-3.5 ${className}`}>{children}</div>
}

/** A key cap, for keyboard shortcuts. */
export function Kbd({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={`inline-grid h-5 min-w-5 place-items-center rounded-md bg-white/10 px-1.5 text-caption2 font-semibold text-white/80 ring-1 ring-inset ring-white/15 ${className}`}>{children}</kbd>
  )
}

/** Hover hint for a control, with its keyboard shortcut. Pointer devices only; screen readers use the control's label. */
export function Tooltip({ label, shortcut, side = 'left' }: { label: string; shortcut?: string; side?: 'left' | 'right' | 'bottom' }) {
  const place =
    side === 'left' ? 'right-full top-1/2 mr-2.5 -translate-y-1/2 origin-right' : side === 'right' ? 'left-full top-1/2 ml-2.5 -translate-y-1/2 origin-left' : 'left-1/2 top-full mt-2 -translate-x-1/2 origin-top'
  return (
    <span aria-hidden className={`tooltip absolute z-10 flex items-center gap-2 whitespace-nowrap rounded-xl bg-[#0d121b]/95 py-1.5 pl-3 text-footnote font-medium text-white shadow-pop ring-1 ring-white/10 ${shortcut ? 'pr-1.5' : 'pr-3'} ${place}`}>
      {label}
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </span>
  )
}

/** Round glass button used for the controls floating over the map. */
export function GlassButton({
  label,
  onClick,
  active = false,
  children,
  className = '',
  shortcut,
  tooltip = 'left',
  closing,
}: {
  label: string
  onClick: () => void
  active?: boolean
  children: ReactNode
  className?: string
  /** Key shown in the hover hint. */
  shortcut?: string
  /** Which side the hover hint opens on; `none` for no hint. */
  tooltip?: 'left' | 'right' | 'bottom' | 'none'
  /** On its way out (with `motion-pop` in `className`). */
  closing?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active || undefined}
      aria-keyshortcuts={shortcut}
      data-closing={closing ? '' : undefined}
      onClick={onClick}
      className={`has-tooltip pressable pointer-events-auto relative grid size-11 place-items-center rounded-full shadow-float ring-1 ${
        active ? 'bg-atc-yellow text-black ring-black/10' : 'glass-chip text-white ring-white/[0.13] hover:bg-atc-glass-hover/90'
      } ${className}`}
    >
      {children}
      {tooltip !== 'none' && <Tooltip label={label} shortcut={shortcut} side={tooltip} />}
    </button>
  )
}

/** iOS-style switch: the knob springs across and stretches while pressed. */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`group relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-[var(--duration-base)] ease-[var(--ease-out)] ${checked ? 'bg-atc-yellow' : 'bg-white/[0.16]'}`}
      onClick={() => onChange(!checked)}
    >
      <span
        className={`absolute top-[2px] h-[26px] w-[26px] rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.3)] transition-[left,width] duration-[var(--duration-release)] ease-[var(--ease-spring)] group-active:w-[32px] ${
          checked ? 'left-[22px] group-active:left-[16px]' : 'left-[2px]'
        }`}
      />
    </button>
  )
}

/** Segmented control with a selection pill that slides between options. */
export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null)
  const index = options.findIndex(([v]) => v === value)

  // Measure the chosen option so the pill can glide to it (fonts can change widths after load).
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const btn = el.querySelectorAll<HTMLElement>('[role="radio"]')[index]
      if (btn) setPill((p) => (p && p.x === btn.offsetLeft && p.w === btn.offsetWidth ? p : { x: btn.offsetLeft, w: btn.offsetWidth }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [index])

  return (
    <div ref={box} role="radiogroup" aria-label={label} className="relative flex rounded-[0.7rem] bg-white/10 p-0.5 text-footnote font-medium">
      {pill && (
        <span
          aria-hidden
          className="absolute inset-y-0.5 left-0 rounded-[0.6rem] bg-atc-yellow shadow-[0_1px_4px_rgba(0,0,0,0.25)] transition-[translate,width] duration-[var(--duration-base)] ease-[var(--ease-out)]"
          style={{ translate: `${pill.x}px 0`, width: pill.w }}
        />
      )}
      {options.map(([v, text]) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={v === value}
          className={`relative rounded-[0.6rem] px-2.5 py-1.5 transition-colors duration-[var(--duration-fast)] ${
            v === value ? `font-semibold text-black ${pill ? '' : 'bg-atc-yellow'}` : 'text-white/70 hover:text-white'
          }`}
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
    <div className="flex min-h-12 items-center justify-between gap-4 border-b border-white/[0.07] py-2.5 last:border-0">
      <div className="min-w-0">
        <div className="text-subhead font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-footnote text-atc-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
