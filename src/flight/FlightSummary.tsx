/**
 * The selected flight's live numbers, under the purple hero in the full
 * flight view: altitude with its trend, vertical rate, groundspeed, heading,
 * squawk, and where it is from the airport you are listening to. Each with a
 * line of plain words under it, and rolling to its new value as reports
 * arrive.
 */
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { getAirport } from '../api/airports'
import { usePlayhead } from '../playback/playheadStore'
import { formatAltitude, formatSpeed, formatVerticalRate, useSettings } from '../settings/settingsStore'
import { Ticker } from '../ui/Ticker'
import { altitudeComparison, compassDirection } from './describe'
import { formatDistance, greatCircleNm, initialBearingDeg } from './route'
import type { FlightView } from './useFlight'

/** Squawk codes that mean trouble, in words. */
const EMERGENCY_SQUAWK: Record<string, string> = { '7500': 'hijack', '7600': 'radio failure', '7700': 'emergency' }

function Cell({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'alert' }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-caption2 font-medium text-white/55">{label}</div>
      <div className={`flex items-center gap-1 truncate text-body font-bold tabular-nums leading-tight ${tone === 'alert' ? 'w-fit rounded-md bg-atc-live/20 px-1.5 text-[#FF7A70] ring-1 ring-atc-live/40' : ''}`}>{value}</div>
      {hint && <div className="line-clamp-2 text-caption2 text-white/50">{hint}</div>}
    </div>
  )
}

export function FlightSummary({ flight }: { flight: FlightView }) {
  const altitudeUnit = useSettings((s) => s.altitudeUnit)
  const speedUnit = useSettings((s) => s.speedUnit)
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const airport = getAirport(airportIcao)
  const d = flight.detail
  if (!d) return null
  const airborne = !d.onGround

  const vr = d.verticalRateFpm ?? null
  const trend = !airborne || vr == null ? null : vr > 200 ? 'up' : vr < -200 ? 'down' : 'level'
  const TrendIcon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : trend === 'level' ? ArrowRight : null
  const squawkAlert = d.squawk ? (EMERGENCY_SQUAWK[d.squawk] ?? null) : null
  const emergency = d.emergency && d.emergency !== 'none' ? d.emergency : null
  const fromAirport = { nm: greatCircleNm({ lat: airport.center[1], lon: airport.center[0] }, d), bearing: initialBearingDeg({ lat: airport.center[1], lon: airport.center[0] }, d) }

  return (
    <section aria-label="Live numbers" className="ui-card mt-3 grid grid-cols-3 gap-x-3 gap-y-3 px-4 py-3.5">
      <Cell
        label="Altitude"
        value={
          d.onGround ? (
            'On ground'
          ) : (
            <>
              <Ticker value={d.altitudeFt} format={(v) => formatAltitude(v, altitudeUnit)} />
              {TrendIcon && <TrendIcon className={`size-4 shrink-0 ${trend === 'up' ? 'text-[#7EE2A8]' : trend === 'down' ? 'text-[#FFB27A]' : 'text-white/50'}`} aria-label={trend === 'up' ? 'climbing' : trend === 'down' ? 'descending' : 'level'} />}
            </>
          )
        }
        hint={d.onGround ? null : altitudeComparison(d.altitudeFt)}
      />
      <Cell
        label="Vertical rate"
        value={d.onGround || vr == null ? '—' : <Ticker value={vr} format={(v) => formatVerticalRate(v, altitudeUnit)} />}
        hint={d.selectedAltitudeFt != null && !d.onGround ? `autopilot set to ${formatAltitude(Math.round(d.selectedAltitudeFt / 100) * 100, altitudeUnit)}` : vr != null && !d.onGround && Math.abs(vr) > 200 ? (vr > 0 ? 'climbing' : 'descending') : null}
      />
      <Cell label="Groundspeed" value={<Ticker value={d.speedKt} format={(v) => formatSpeed(v, speedUnit)} />} hint={d.speedKt != null && speedUnit === 'kt' ? `${Math.round(d.speedKt * 1.15078)} mph` : null} />
      <Cell label="Heading" value={d.headingKnown === false ? '—' : `${Math.round(d.heading).toString().padStart(3, '0')}°`} hint={d.headingKnown === false ? null : `toward the ${compassDirection(d.heading)}`} />
      <Cell
        label="Squawk"
        value={d.squawk ?? '—'}
        tone={squawkAlert || emergency ? 'alert' : undefined}
        hint={emergency ? `emergency: ${emergency}` : squawkAlert ? squawkAlert : d.squawk === '1200' ? 'flying visually (VFR)' : d.squawk ? 'assigned by ATC' : null}
      />
      <Cell label={`From ${airport.icao}`} value={formatDistance(fromAirport.nm, speedUnit)} hint={fromAirport.nm < 0.5 ? 'on the field' : `${compassDirection(fromAirport.bearing)} of the field`} />
    </section>
  )
}
