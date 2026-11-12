/**
 * The small set of parts every panel and sheet is built from, so a card in
 * the weather sheet is the same card as in the flight view: `Badge` (one
 * pill, a handful of tones), `Lamp` (the on-air light), `Equalizer` (bars
 * that bounce while sound plays), `SearchField`, `MoreToggle` ("Show all 5")
 * and `Hint` (a quiet line where a list has nothing to show yet).
 *
 * The card, row and label looks themselves are CSS utilities in index.css
 * (`ui-card`, `ui-row`, `ui-well`), so they can go on any element.
 */
import { ChevronDown, Search, X } from 'lucide-react'
import type { CSSProperties, ReactNode, Ref } from 'react'

export type BadgeTone = 'neutral' | 'yellow' | 'purple' | 'live' | 'amber' | 'magenta' | 'green'

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: 'bg-white/[0.09] text-white/80 ring-1 ring-inset ring-white/[0.08]',
  yellow: 'bg-atc-yellow text-black',
  purple: 'bg-atc-purple/20 text-[#CFC4FF] ring-1 ring-inset ring-atc-purple/35',
  live: 'bg-atc-live-badge text-white',
  amber: 'bg-[#FFB340]/15 text-[#FFC266] ring-1 ring-inset ring-[#FFB340]/25',
  magenta: 'bg-atc-magenta text-white',
  green: 'bg-[#34C759]/15 text-[#7EE2A8] ring-1 ring-inset ring-[#34C759]/25',
}

/** One pill for every status word in the app: a phase, a role, a count, "Replay". */
export function Badge({ tone = 'neutral', size = 'sm', className = '', children, title }: { tone?: BadgeTone; size?: 'sm' | 'md'; className?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-bold ${size === 'md' ? 'h-6 px-2.5 text-caption' : 'h-5 px-2 text-caption2'} ${BADGE_TONE[tone]} ${className}`}>
      {children}
    </span>
  )
}

/** A count on a tab or a rail button: yellow when it wants attention, plain otherwise. */
export function CountDot({ children, attention = false, className = '' }: { children?: ReactNode; attention?: boolean; className?: string }) {
  if (children == null) return <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${attention ? 'bg-atc-yellow' : 'bg-white/40'} ${className}`} />
  return (
    <span aria-hidden className={`grid h-4 min-w-4 shrink-0 place-items-center rounded-full px-1 text-[10px] font-bold leading-none tabular-nums ${attention ? 'bg-atc-yellow text-black' : 'bg-white/[0.12] text-white/75'} ${className}`}>
      {children}
    </span>
  )
}

export type LampState = 'off' | 'waiting' | 'live' | 'speaking'

/**
 * The on-air light. Dark when the radio is off, amber while it connects, a
 * steady red when it is live, and while somebody transmits it takes the
 * speaker's colour and sends out slow, soft rings (see `.lamp` in index.css).
 */
export function Lamp({ state, color, className = '' }: { state: LampState; color?: string; className?: string }) {
  const style = (state === 'speaking' && color ? { '--lamp': color } : undefined) as CSSProperties | undefined
  return <span aria-hidden data-state={state} style={style} className={`lamp ${className}`} />
}

/** Three bars that bounce while audio plays. */
export function Equalizer({ className = '' }: { className?: string }) {
  return (
    <span className={`flex h-3.5 items-end gap-[2px] ${className}`} aria-hidden>
      {[0, 160, 320].map((d) => (
        <span key={d} className="eq-bar w-[3px] origin-bottom rounded-full bg-current" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  )
}

/** The search box used at the top of every list: rounded, quiet until focused, with a clear button and room for a count. */
export function SearchField({
  value,
  onChange,
  onClear,
  placeholder,
  label,
  trailing,
  size = 'md',
  inputRef,
  onEscape,
  onEnter,
}: {
  value: string
  onChange: (v: string) => void
  onClear?: () => void
  placeholder: string
  label: string
  /** Shown at the right end while the box is empty (a count, say). */
  trailing?: ReactNode
  size?: 'md' | 'lg'
  inputRef?: Ref<HTMLInputElement>
  /** Escape with text in the box; return true when it was handled (the event then stops here). */
  onEscape?: () => boolean
  /** Enter in the box; return true when it was handled (the key press then goes no further). */
  onEnter?: () => boolean
}) {
  const big = size === 'lg'
  return (
    <label className={`relative flex items-center gap-2 rounded-full bg-white/[0.08] ring-1 ring-inset ring-white/[0.07] transition-[background-color,box-shadow] duration-[var(--duration-fast)] focus-within:bg-white/[0.11] focus-within:ring-2 focus-within:ring-atc-purple/80 ${big ? 'h-11 pl-3.5 pr-2' : 'h-10 pl-3 pr-2'}`}>
      <Search aria-hidden className={`shrink-0 text-white/45 ${big ? 'size-[18px]' : 'size-4'}`} strokeWidth={2.25} />
      <input
        ref={inputRef}
        type="search"
        enterKeyHint="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value && onEscape?.()) e.stopPropagation()
          else if (e.key === 'Enter' && onEnter?.()) e.preventDefault()
        }}
        className={`min-w-0 flex-1 appearance-none bg-transparent text-white outline-none placeholder:text-white/40 [&::-webkit-search-cancel-button]:hidden ${big ? 'text-body' : 'text-subhead'}`}
      />
      {value ? (
        <button type="button" aria-label="Clear search" className="pressable grid size-7 shrink-0 place-items-center rounded-full bg-white/15 text-white/80 hover:bg-white/25" onClick={() => (onClear ? onClear() : onChange(''))}>
          <X className="size-3.5" strokeWidth={2.75} />
        </button>
      ) : (
        trailing != null && <span className="shrink-0 pr-1.5 text-caption tabular-nums text-white/45">{trailing}</span>
      )}
    </label>
  )
}

/** "Show all 5" / "Show less" under a shortened list. */
export function MoreToggle({ open, onToggle, children, className = '' }: { open: boolean; onToggle: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" aria-expanded={open} className={`pressable flex min-h-9 items-center gap-1 rounded-full px-2 text-footnote font-semibold text-[#C9BCFF] hover:text-white ${className}`} onClick={onToggle}>
      {children}
      <ChevronDown aria-hidden className={`size-4 transition-transform duration-[var(--duration-base)] ease-[var(--ease-out)] ${open ? 'rotate-180' : ''}`} strokeWidth={2.5} />
    </button>
  )
}

/** A quiet line in a card where a list has nothing to show yet. */
export function Hint({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`ui-card px-3.5 py-3 text-footnote text-white/60 ${className}`}>{children}</p>
}
