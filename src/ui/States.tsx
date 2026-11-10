/**
 * One set of loading, empty and error states for the whole app, so a panel
 * that is waiting looks like every other panel that is waiting:
 *
 *  - `RadarSweep`: the animated scope shown while traffic first loads;
 *  - `QuietArt` / `OfflineArt`: small illustrations for "nobody's flying"
 *    and "the feeds are down";
 *  - `EmptyState`: art + title + text + actions, centred;
 *  - `Bone` and the `*Skeleton` layouts: shimmering placeholders shaped like
 *    the content they stand in for.
 *
 * Every animation here stops (and lands on a sensible still frame) under
 * reduced motion, through the global rules in index.css.
 */
import { RotateCw, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'

/** A radar scope with a sweeping beam and a few blips lighting up as it passes. */
export function RadarSweep({ size = 72, className = '' }: { size?: number; className?: string }) {
  // Where the blips sit, as [bearing in degrees, distance from the centre 0..1]; each lights as the beam passes.
  const blips: [number, number][] = [
    [52, 0.62],
    [148, 0.38],
    [236, 0.74],
    [318, 0.48],
  ]
  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="-50 -50 100 100" className="absolute inset-0 size-full">
        <defs>
          <radialGradient id="radar-face">
            <stop offset="0" stopColor="#7c5cfc" stopOpacity="0.22" />
            <stop offset="1" stopColor="#7c5cfc" stopOpacity="0.04" />
          </radialGradient>
        </defs>
        <circle r="49" fill="url(#radar-face)" stroke="rgba(167,139,250,0.45)" strokeWidth="1" />
        <circle r="33" fill="none" stroke="rgba(167,139,250,0.22)" strokeWidth="0.8" />
        <circle r="17" fill="none" stroke="rgba(167,139,250,0.22)" strokeWidth="0.8" />
        <path d="M-49 0H49M0 -49V49" stroke="rgba(167,139,250,0.16)" strokeWidth="0.8" />
      </svg>
      {/* The beam: a conic fade trailing behind a bright leading edge, clipped to the scope. */}
      <div className="absolute inset-[1px] animate-sweep overflow-hidden rounded-full">
        <div className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,transparent_280deg,rgba(167,139,250,0.08)_300deg,rgba(167,139,250,0.55)_359deg,transparent_360deg)]" />
        <div className="absolute bottom-1/2 left-1/2 h-1/2 w-px -translate-x-1/2 bg-gradient-to-t from-[#c4b5fd]/30 to-[#c4b5fd]" />
      </div>
      {blips.map(([deg, r]) => {
        const a = (deg * Math.PI) / 180
        return (
          <span
            key={deg}
            className="radar-blip absolute size-[7%] min-h-1 min-w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ddd6fe] shadow-[0_0_6px_#a78bfa]"
            style={{ left: `${50 + Math.sin(a) * r * 47}%`, top: `${50 - Math.cos(a) * r * 47}%`, animationDelay: `${(deg / 360) * 2.8}s` }}
          />
        )
      })}
      <span className="absolute left-1/2 top-1/2 size-[6%] min-h-1 min-w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ddd6fe]" />
    </div>
  )
}

/** A runway at night under a crescent moon: nothing on it, nothing on approach. */
export function QuietArt({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 104" className={`h-[104px] w-40 shrink-0 ${className}`} aria-hidden>
      <defs>
        <linearGradient id="quiet-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b2546" />
          <stop offset="1" stopColor="#0d1324" />
        </linearGradient>
        <linearGradient id="quiet-runway" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a3452" />
          <stop offset="1" stopColor="#384463" />
        </linearGradient>
        <clipPath id="quiet-clip">
          <rect width="160" height="104" rx="22" />
        </clipPath>
      </defs>
      <g clipPath="url(#quiet-clip)">
        <rect width="160" height="104" fill="url(#quiet-sky)" />
        {/* Stars, a couple of which twinkle. */}
        {[
          [22, 16, 1],
          [44, 30, 0.7],
          [70, 12, 0.8],
          [98, 26, 0.6],
          [132, 40, 0.7],
          [14, 44, 0.6],
          [118, 10, 0.9],
        ].map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill="#fff" opacity={0.75} className={i % 3 === 0 ? 'quiet-twinkle' : undefined} style={{ animationDelay: `${i * 0.7}s` }} />
        ))}
        {/* Crescent moon. */}
        <circle cx="128" cy="22" r="10" fill="#f5e7b5" />
        <circle cx="133" cy="18" r="9" fill="#1a2443" />
        {/* Grass horizon and the runway running away from us. */}
        <rect y="60" width="160" height="44" fill="#1d3a33" />
        <path d="M66 60H94L124 104H36Z" fill="url(#quiet-runway)" />
        <path d="M80 62V66M80 71V77M80 83V91M80 97V104" stroke="#e8edf6" strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />
        {/* Threshold bars and edge lights. */}
        <path d="M44 101H58M102 101H116" stroke="#e8edf6" strokeWidth="2" opacity="0.7" />
        {[0.08, 0.3, 0.55, 0.82].map((t) => (
          <g key={t} fill="#f5b93d">
            <circle cx={66 - 30 * t} cy={60 + 44 * t} r={0.9 + t} />
            <circle cx={94 + 30 * t} cy={60 + 44 * t} r={0.9 + t} />
          </g>
        ))}
        {/* A windsock hanging limp. */}
        <path d="M24 58V40" stroke="#c4cbd8" strokeWidth="1.2" />
        <path d="M24 41L30 42.5L29.4 51L24 49Z" fill="#f97316" opacity="0.9" />
      </g>
    </svg>
  )
}

/** A scope gone dark with a broken signal in the middle. */
export function OfflineArt({ className = '' }: { className?: string }) {
  return (
    <div className={`relative grid size-[72px] shrink-0 place-items-center ${className}`} aria-hidden>
      <svg viewBox="-50 -50 100 100" className="absolute inset-0 size-full">
        <circle r="49" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.18)" strokeWidth="1" strokeDasharray="3 4" />
        <circle r="31" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.8" />
      </svg>
      <span className="relative grid size-9 place-items-center rounded-full bg-white/10 text-white/80 ring-1 ring-white/15">
        <WifiOff className="size-[18px]" />
      </span>
    </div>
  )
}

/** Centred empty or error state with optional actions. */
export function EmptyState({ art, title, children, actions, compact = false }: { art?: ReactNode; title: string; children?: ReactNode; actions?: ReactNode; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center text-center ${compact ? 'gap-2.5 py-2' : 'gap-3 py-10'}`}>
      {art}
      <div>
        <p className="text-body font-semibold text-white">{title}</p>
        {children && <p className="mx-auto mt-1 max-w-[19rem] text-footnote text-white/65">{children}</p>}
      </div>
      {actions && <div className="mt-1 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  )
}

/** Pill button for empty-state actions: `primary` is yellow, the rest quiet glass. */
export function StateAction({ children, onClick, primary = false, busy = false }: { children: ReactNode; onClick: () => void; primary?: boolean; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`pressable flex h-9 items-center gap-1.5 rounded-full px-4 text-footnote font-semibold disabled:opacity-80 ${
        primary ? 'bg-atc-yellow text-black hover:bg-atc-yellow-deep' : 'bg-white/10 text-white ring-1 ring-inset ring-white/10 hover:bg-white/[0.16]'
      }`}
    >
      {busy && <RotateCw className="size-3.5 animate-spin" />}
      {children}
    </button>
  )
}

/** One shimmering placeholder; size and shape come from `className`. */
export function Bone({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`skeleton block ${className}`} />
}

/** Rows shaped like the traffic list (logo, callsign and type, altitude and speed). */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="mt-4 flex flex-col gap-1.5" role="status" aria-label="Loading">
      <Bone className="mb-1 ml-1 h-3 w-20" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex min-h-14 items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2" style={{ opacity: 1 - i * 0.12 }}>
          <Bone className="h-6 w-9 rounded-md" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Bone className="h-4 w-24" />
            <Bone className="h-3 w-32" />
          </span>
          <span className="flex flex-col items-end gap-1.5">
            <Bone className="h-3.5 w-14" />
            <Bone className="h-3 w-10" />
          </span>
        </div>
      ))}
    </div>
  )
}

/** The weather panel's layout: summary card, wind dial with runways, the tiles, an ATIS card. */
export function WeatherSkeleton() {
  const card = 'rounded-2xl bg-white/[0.04] ring-1 ring-inset ring-white/[0.04]'
  return (
    <div role="status" aria-label="Loading weather">
      <div className={`${card} flex flex-col gap-3 rounded-[1.375rem] p-4`}>
        <span className="flex items-center justify-between">
          <Bone className="h-6 w-28 rounded-full" />
          <Bone className="h-3 w-14" />
        </span>
        <span className="flex items-center justify-between">
          <Bone className="h-12 w-24 rounded-xl" />
          <Bone className="size-12 rounded-full" />
        </span>
        <Bone className="h-4.5 w-3/4" />
      </div>
      <div className={`${card} mt-2 flex items-center gap-4 p-3.5`}>
        <Bone className="size-[7.25rem] shrink-0 rounded-full" />
        <span className="flex min-w-0 flex-1 flex-col gap-2">
          <Bone className="h-3 w-10" />
          <Bone className="h-6 w-32" />
          <Bone className="h-3 w-28" />
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`${card} flex flex-col gap-1.5 px-3 py-2.5 ${i === 1 ? 'row-span-2' : ''}`}>
            <Bone className="h-3 w-16" />
            <Bone className="h-5 w-20" />
          </div>
        ))}
      </div>
      <Bone className="mb-2 ml-1 mt-6 h-3 w-12" />
      <div className={`${card} flex items-center gap-3 p-3.5`}>
        <Bone className="size-11 rounded-xl" />
        <span className="flex flex-1 flex-col gap-1.5">
          <Bone className="h-4 w-36" />
          <Bone className="h-3 w-24" />
        </span>
      </div>
    </div>
  )
}

/** The route strip in the flight view while its schedule loads. */
export function RouteSkeleton() {
  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl bg-white/[0.06] px-4 py-3.5" role="status" aria-label="Loading route">
      <span className="flex flex-col gap-1.5">
        <Bone className="h-6 w-12" />
        <Bone className="h-2.5 w-16" />
      </span>
      <Bone className="h-0.5 flex-1" />
      <span className="flex flex-col items-end gap-1.5">
        <Bone className="h-6 w-12" />
        <Bone className="h-2.5 w-16" />
      </span>
    </div>
  )
}
