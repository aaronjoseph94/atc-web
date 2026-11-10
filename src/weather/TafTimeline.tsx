/**
 * The terminal forecast as a timeline: one bar from now to the end of the
 * forecast, coloured by flight category, with temporary and possible spells
 * on a thinner lane underneath; then a card per period (time, category,
 * wind, visibility, weather) that scrolls sideways. The raw TAF is one tap
 * away underneath.
 */
import { ArrowUp, Cloud, CloudRain, Eye } from 'lucide-react'
import { useMemo } from 'react'
import { useSettings } from '../settings/settingsStore'
import { CATEGORY_COLOR } from '../station/StationBar'
import { describeSky, describeWeather, formatVisibility, speedUnitLabel, speedValue } from './decode'
import { parseTaf, tafLines, upcoming, type TafPeriod } from './taf'
import { RawReport } from './RawReport'

const HOUR = 3_600_000
const NEUTRAL = 'rgba(255,255,255,0.22)'

/** `5 PM`, or `5:30 PM` off the hour, in the viewer's clock like every other time in the app. */
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], new Date(ms).getMinutes() ? { hour: 'numeric', minute: '2-digit' } : { hour: 'numeric' })
const dayName = (ms: number) => new Date(ms).toLocaleDateString([], { weekday: 'short' })
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()

/** Hatching for spells that may or may not happen. */
const hatch = (c: string) => `repeating-linear-gradient(135deg, ${c} 0 3px, transparent 3px 6px)`

function Timeline({ main, overlays, start, end }: { main: TafPeriod[]; overlays: TafPeriod[]; start: number; end: number }) {
  const span = Math.max(HOUR, end - start)
  const x = (t: number) => `${(((Math.min(end, Math.max(start, t)) - start) / span) * 100).toFixed(3)}%`
  const w = (p: TafPeriod) => `${(((Math.min(end, p.to) - Math.max(start, p.from)) / span) * 100).toFixed(3)}%`
  // Labels every six hours on the viewer's clock, kept clear of the ends.
  const ticks: number[] = []
  const first = new Date(start)
  first.setMinutes(0, 0, 0)
  for (let t = first.getTime() + HOUR; t < end; t += HOUR) if (new Date(t).getHours() % 6 === 0 && t - start > span * 0.1 && end - t > span * 0.16) ticks.push(t)
  return (
    <div aria-hidden className="px-0.5">
      <div className="relative h-2.5">
        {main.map((p) => (
          <span key={p.from} className="absolute inset-y-0 rounded-full border-x border-[#151c28]" style={{ left: x(p.from), width: w(p), background: p.category ? CATEGORY_COLOR[p.category] : NEUTRAL }} />
        ))}
      </div>
      {overlays.length > 0 && (
        <div className="relative mt-1 h-1.5">
          {overlays.map((p) => (
            <span key={`${p.kind}${p.from}`} className="absolute inset-y-0 rounded-full" style={{ left: x(p.from), width: w(p), background: hatch(p.category ? CATEGORY_COLOR[p.category] : NEUTRAL) }} />
          ))}
        </div>
      )}
      <div className="relative mt-1.5 h-4 text-caption2 font-medium tabular-nums text-white/45">
        <span className="absolute left-0 text-white/80">Now</span>
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: x(t) }}>
            {new Date(t).getHours() === 0 ? dayName(t) : clock(t)}
          </span>
        ))}
        <span className="absolute right-0 whitespace-nowrap">{sameDay(end, start) ? clock(end) : `${dayName(end)} ${clock(end)}`}</span>
      </div>
    </div>
  )
}

function PeriodCard({ p, now }: { p: TafPeriod; now: number }) {
  const unit = useSettings((s) => s.speedUnit)
  const heights = useSettings((s) => s.altitudeUnit)
  const overlay = p.kind === 'tempo' || p.kind === 'prob'
  const colour = p.category ? CATEGORY_COLOR[p.category] : NEUTRAL
  const wx = describeWeather(p.weather)
  const sky = describeSky(p.clouds, heights)
  const u = speedUnitLabel(unit)
  return (
    <li
      className={`relative w-[8.5rem] shrink-0 snap-start overflow-hidden rounded-xl p-2.5 pt-3 @md:w-[9.25rem] ${overlay ? 'border border-dashed border-white/20 bg-white/[0.025]' : 'bg-white/[0.06]'}`}
      aria-label={`${p.from <= now ? 'Now' : clock(p.from)} until ${clock(p.to)}`}
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: overlay ? hatch(colour) : colour }} />
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-footnote font-semibold tabular-nums">{p.from <= now ? 'Now' : sameDay(p.from, now) ? clock(p.from) : `${dayName(p.from)} ${clock(p.from)}`}</span>
        {p.category && (
          <span className="text-caption2 font-bold" style={{ color: colour, filter: 'brightness(1.35)' }}>
            {p.category}
          </span>
        )}
      </div>
      <div className="text-caption tabular-nums text-white/45">until {sameDay(p.to, p.from) ? clock(p.to) : `${dayName(p.to)} ${clock(p.to)}`}</div>
      {overlay && <div className="mt-1 text-caption2 font-semibold uppercase tracking-[0.04em] text-white/55">{p.kind === 'prob' ? `${p.probability}% chance` : 'At times'}</div>}
      <dl className="mt-2 space-y-1 text-caption text-white/80">
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Wind</dt>
          {p.wind?.dirDeg != null && p.wind.kt > 0 ? (
            // Points the way the wind blows, like a weather map arrow.
            <ArrowUp aria-hidden className="size-3.5 shrink-0 text-white/55" style={{ rotate: `${p.wind.dirDeg + 180}deg` }} strokeWidth={2.5} />
          ) : (
            <span aria-hidden className="size-3.5 shrink-0" />
          )}
          <dd className="truncate tabular-nums">
            {!p.wind ? '—' : !p.wind.kt ? 'Calm' : `${p.wind.dirDeg != null ? `${String(p.wind.dirDeg).padStart(3, '0')}°` : 'Vrb'} ${speedValue(p.wind.kt, unit)}`}
            {p.wind?.gustKt ? <span className="text-[#FFC266]"> G{speedValue(p.wind.gustKt, unit)}</span> : null}
            {p.wind?.kt ? <span className="text-white/45"> {u}</span> : null}
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Visibility</dt>
          <Eye aria-hidden className="size-3.5 shrink-0 text-white/55" strokeWidth={2.25} />
          <dd className="truncate tabular-nums">{formatVisibility(p.visibilitySm, p.visibilityPlus, heights)}</dd>
        </div>
        {wx && (
          <div className="flex items-start gap-1.5">
            <dt className="sr-only">Weather</dt>
            <CloudRain aria-hidden className="mt-px size-3.5 shrink-0 text-white/55" strokeWidth={2.25} />
            <dd className="line-clamp-2 leading-[15px]">{wx}</dd>
          </div>
        )}
        <div className="flex items-start gap-1.5">
          <dt className="sr-only">Sky</dt>
          <Cloud aria-hidden className="mt-px size-3.5 shrink-0 text-white/55" strokeWidth={2.25} />
          <dd className="line-clamp-2 leading-[15px]">{sky}</dd>
        </div>
      </dl>
    </li>
  )
}

export function TafTimeline({ raw, now, fetchedAt }: { raw: string; now: number; fetchedAt?: string }) {
  // Dated from the fetch (or now), which is always within a day or so of the issue time.
  const ref = fetchedAt ? Date.parse(fetchedAt) : now
  const taf = useMemo(() => parseTaf(raw, new Date(ref)), [raw, ref])
  const next = taf ? upcoming(taf, now) : null
  if (!taf || !next || !next.main.length) {
    // Couldn't read it, or it has run out: the raw text is still worth having.
    return <RawReport label="Raw TAF" text={raw} lines={tafLines(raw)} defaultOpen />
  }
  // Main periods in order, each followed by the temporary spells that start inside it.
  const cards = [...next.main, ...next.overlays].sort((a, b) => a.from - b.from || (a.kind === 'tempo' || a.kind === 'prob' ? 1 : -1))
  return (
    <>
      <div className="rounded-2xl bg-white/[0.05] p-3.5 ring-1 ring-inset ring-white/[0.06]">
        <Timeline main={next.main} overlays={next.overlays} start={now} end={taf.to} />
        <ol
          tabIndex={0}
          aria-label="Forecast periods"
          className="no-scrollbar -mx-3.5 mt-3 flex snap-x snap-mandatory scroll-px-3.5 gap-2 overflow-x-auto px-3.5 outline-none [mask-image:linear-gradient(to_right,transparent,#000_0.875rem,#000_calc(100%-1.5rem),transparent)]"
        >
          {cards.map((p) => (
            <PeriodCard key={`${p.kind}${p.from}${p.to}`} p={p} now={now} />
          ))}
        </ol>
      </div>
      <div className="mt-2">
        <RawReport label="Raw TAF" text={raw} lines={tafLines(raw)} />
      </div>
    </>
  )
}
