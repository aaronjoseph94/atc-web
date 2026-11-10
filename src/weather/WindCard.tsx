/**
 * The wind, the way a pilot looks at it: a small compass dial with the
 * arrow coming in from where the wind blows from (and the arc it swings
 * across when it varies), the speed and gusts, then what that means on each
 * runway in use: how much is down the runway (head or tail) and how much is
 * across it.
 */
import { PlaneLanding, PlaneTakeoff } from 'lucide-react'
import { useMemo } from 'react'
import type { Metar } from '../api/types'
import type { ActiveRunways } from '../live/runwayUse'
import type { RunwayEndGeometry } from '../map/airportDiagram'
import { RUNWAY_USE_COLOR } from '../map/mapStyle'
import { useSettings, type SpeedUnit } from '../settings/settingsStore'
import { runwayWinds, type RunwayWind } from './atis'
import { compassPoint, speedUnitLabel, speedValue, variableRange } from './decode'

const YELLOW = '#f5b93d'
/** Past this much crosswind (kt) light aircraft start to struggle; the number turns amber. */
const STRONG_CROSSWIND_KT = 15

const polar = (deg: number, r: number) => [Math.sin((deg * Math.PI) / 180) * r, -Math.cos((deg * Math.PI) / 180) * r] as const

function arcPath(from: number, to: number, r: number) {
  const sweep = (((to - from) % 360) + 360) % 360
  const [x1, y1] = polar(from, r)
  const [x2, y2] = polar(to, r)
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

function WindDial({ metar, lines, active, unit }: { metar: Metar; lines: RunwayEndGeometry[]; active: Set<string>; unit: SpeedUnit }) {
  const dir = metar.windDirDeg
  const kt = metar.windKt ?? 0
  const swing = variableRange(metar.raw)
  const calm = !kt
  return (
    <svg viewBox="-60 -60 120 120" className="size-[7.25rem] shrink-0 @md:size-32" role="img" aria-label={calm ? 'Wind calm' : dir != null ? `Wind from ${dir} degrees at ${kt} knots` : `Wind variable at ${kt} knots`}>
      <circle r="57" fill="rgba(255,255,255,0.035)" stroke="rgba(255,255,255,0.12)" />
      {/* Ticks every 10°, longer every 30°. */}
      {Array.from({ length: 36 }, (_, i) => {
        const major = i % 3 === 0
        const [x1, y1] = polar(i * 10, 57)
        const [x2, y2] = polar(i * 10, major ? 51 : 54)
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={major ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.16)'} strokeWidth={major ? 1.4 : 1} />
      })}
      {['N', 'E', 'S', 'W'].map((l, i) => {
        const [x, y] = polar(i * 90, 43)
        return (
          <text key={l} x={x} y={y + 3.4} textAnchor="middle" fontSize="9.5" fontWeight="700" fill={l === 'N' ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)'}>
            {l}
          </text>
        )
      })}
      {/* The runways, as they lie; the ones in use brighter. */}
      {lines.map((e) => (
        <line key={e.ident} x1="0" y1="-36" x2="0" y2="36" stroke={active.has(e.ident) ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.13)'} strokeWidth="5.5" strokeLinecap="round" transform={`rotate(${e.bearing})`} />
      ))}
      {swing && !calm && <path d={arcPath(swing[0], swing[1], 54)} fill="none" stroke={YELLOW} strokeOpacity="0.45" strokeWidth="5" strokeLinecap="round" />}
      {dir != null && !calm && (
        <g transform={`rotate(${dir})`} className="transition-transform duration-700 ease-[var(--ease-out)]">
          {/* Comes in from the rim on the side the wind blows from, head toward the middle. */}
          <line x1="0" y1="-55" x2="0" y2="-31" stroke={YELLOW} strokeWidth="3" strokeLinecap="round" />
          <path d="M0 -21 L-6.5 -33 L6.5 -33 Z" fill={YELLOW} stroke={YELLOW} strokeWidth="1.5" strokeLinejoin="round" />
        </g>
      )}
      <circle r="16.5" fill="#141b27" stroke="rgba(255,255,255,0.1)" />
      {calm ? (
        <text y="3.5" textAnchor="middle" fontSize="10" fontWeight="700" fill="rgba(255,255,255,0.8)">
          Calm
        </text>
      ) : (
        <>
          <text y="4" textAnchor="middle" fontSize="15" fontWeight="700" fill="#fff" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {speedValue(kt, unit)}
          </text>
          <text y="12.5" textAnchor="middle" fontSize="6.5" fontWeight="600" fill="rgba(255,255,255,0.5)">
            {dir == null ? 'VRB' : speedUnitLabel(unit)}
          </text>
        </>
      )}
    </svg>
  )
}

/** Small dark runway chip with a landing (green) or takeoff (blue) pictogram, like the badges on the map. */
export function RunwayChip({ ident, landing, departing }: { ident: string; landing: boolean; departing: boolean }) {
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-[#0d131d] pl-1.5 pr-2 text-footnote font-bold tabular-nums text-white ring-1 ring-inset ring-white/[0.14]">
      {landing && <PlaneLanding aria-hidden className="size-3.5" style={{ color: RUNWAY_USE_COLOR.arrivals }} strokeWidth={2.5} />}
      {departing && <PlaneTakeoff aria-hidden className="size-3.5" style={{ color: RUNWAY_USE_COLOR.departures }} strokeWidth={2.5} />}
      {ident}
    </span>
  )
}

function Component({ label, kt, unit, tone, title }: { label: string; kt: number; unit: SpeedUnit; tone?: 'warn'; title?: string }) {
  return (
    <span className="flex flex-col items-end leading-none" title={title}>
      <span className={`text-subhead font-semibold tabular-nums ${tone === 'warn' ? 'text-[#FFB340]' : 'text-white'}`}>
        {speedValue(kt, unit)}
        <span className="ml-0.5 text-caption2 font-medium text-white/45">{speedUnitLabel(unit)}</span>
      </span>
      <span className="mt-1 text-caption2 font-medium text-white/45">{label}</span>
    </span>
  )
}

type Row = { ident: string; landing: boolean; departing: boolean; wind: RunwayWind | null }

/** The runway ends to show: those in use, else the ones the wind favours. */
function runwayRows(active: ActiveRunways | null, winds: RunwayWind[]): { rows: Row[]; basis: ActiveRunways['basis'] } {
  const byIdent = new Map(winds.map((w) => [w.ident, w]))
  if (active && (active.landing.length || active.departing.length)) {
    const idents = [...new Set([...active.landing, ...active.departing])]
    return { basis: active.basis, rows: idents.map((ident) => ({ ident, landing: active.landing.includes(ident), departing: active.departing.includes(ident), wind: byIdent.get(ident) ?? null })) }
  }
  const favoured = active?.favoured.length ? active.favoured : winds.slice(0, 2).map((w) => w.ident)
  return { basis: 'wind', rows: favoured.slice(0, 3).map((ident) => ({ ident, landing: false, departing: false, wind: byIdent.get(ident) ?? null })) }
}

const BASIS_NOTE: Record<ActiveRunways['basis'], string> = {
  traffic: 'From the traffic',
  atis: 'Announced on the ATIS',
  wind: 'Best into the wind',
  none: 'Best into the wind',
}

export function WindCard({ metar, ends, active }: { metar: Metar; ends: RunwayEndGeometry[]; active: ActiveRunways | null }) {
  const unit = useSettings((s) => s.speedUnit)
  const kt = metar.windKt ?? 0
  const dir = metar.windDirDeg
  const swing = variableRange(metar.raw)
  const winds = useMemo(() => runwayWinds(metar, ends), [metar, ends])
  const { rows, basis } = runwayRows(active, winds)
  const inUse = new Set(rows.filter((r) => r.landing || r.departing).map((r) => r.ident))
  // One line per runway (both ends lie on it), lit if either end is in use.
  const byAxis = new Map<number, RunwayEndGeometry>()
  for (const e of ends) {
    const axis = Math.round(e.bearing % 180)
    if (!byAxis.has(axis) || inUse.has(e.ident)) byAxis.set(axis, e)
  }
  const lines = [...byAxis.values()]
  const u = speedUnitLabel(unit)

  return (
    <section aria-label="Wind" className="rounded-2xl bg-white/[0.05] ring-1 ring-inset ring-white/[0.06] @xl:grid @xl:grid-cols-2">
      <div className="flex items-center gap-4 p-3.5 @md:gap-5">
        <WindDial metar={metar} lines={lines} active={inUse} unit={unit} />
        <div className="min-w-0 flex-1">
          <div className="text-caption font-medium text-white/55">Wind</div>
          <div className="mt-0.5 text-title2 font-bold tabular-nums">
            {!kt ? (
              'Calm'
            ) : (
              <>
                {dir != null ? `${String(dir).padStart(3, '0')}°` : 'Variable'}
                <span className="mx-1.5 font-normal text-white/30">·</span>
                {speedValue(kt, unit)}
                <span className="ml-1 text-subhead font-semibold text-white/55">{u}</span>
              </>
            )}
          </div>
          <div className="mt-0.5 text-footnote text-white/60">{!kt ? 'No wind to speak of' : dir != null ? `From the ${compassPoint(dir)}` : 'Changing direction'}</div>
          {(metar.gustKt || (swing && kt)) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {metar.gustKt ? (
                <span className="rounded-full bg-[#FFB340]/15 px-2 py-0.5 text-caption font-semibold tabular-nums text-[#FFC266] ring-1 ring-inset ring-[#FFB340]/25">
                  Gusts {speedValue(metar.gustKt, unit)} {u}
                </span>
              ) : null}
              {swing && kt ? (
                <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-caption font-medium tabular-nums text-white/75 ring-1 ring-inset ring-white/10">
                  Varies {String(swing[0]).padStart(3, '0')}°–{String(swing[1]).padStart(3, '0')}°
                </span>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="border-t border-white/[0.07] px-3.5 pb-2.5 pt-2.5 @xl:border-l @xl:border-t-0">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <h4 className="text-footnote font-semibold text-white/85">{basis === 'wind' || basis === 'none' ? 'Favoured runways' : 'Runways in use'}</h4>
            <span className="text-caption text-white/45">{BASIS_NOTE[basis]}</span>
          </div>
          <ul>
            {rows.map((r) => {
              const w = r.wind
              const role = r.landing && r.departing ? 'Landing, departing' : r.landing ? 'Landing' : r.departing ? 'Departing' : null
              return (
                <li key={r.ident} className="flex min-h-11 items-center gap-3 border-b border-white/[0.05] py-1.5 last:border-0">
                  <RunwayChip ident={r.ident} landing={r.landing} departing={r.departing} />
                  <span className="min-w-0 flex-1 text-footnote leading-tight text-white/60">{role}</span>
                  {w ? (
                    <>
                      <Component label={w.headwindKt >= 0 ? 'Headwind' : 'Tailwind'} kt={Math.abs(w.headwindKt)} unit={unit} tone={w.headwindKt < 0 ? 'warn' : undefined} />
                      <Component
                        label={w.crosswindKt && w.from ? `Cross from ${w.from === 'left' ? 'L' : 'R'}` : 'Crosswind'}
                        title={w.from ? `Crosswind from the ${w.from}` : undefined}
                        kt={w.crosswindKt}
                        unit={unit}
                        tone={w.crosswindKt >= STRONG_CROSSWIND_KT ? 'warn' : undefined}
                      />
                    </>
                  ) : (
                    <span className="text-caption text-white/45">{kt ? 'Wind varies' : 'No crosswind'}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
