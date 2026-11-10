/**
 * The "Flight" section at the top of the full flight view: who is flying it
 * and under which flight number, where it is going and how far along it is,
 * when it should get there, and its live numbers (altitude with its trend,
 * vertical rate, groundspeed, heading, squawk, and where it is from the
 * airport you are listening to). Everything about the flight in one place,
 * so the rest of the view can be the aircraft, the timeline and the radio.
 */
import { ArrowDownRight, ArrowRight, ArrowUpRight, Plane } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { icaoCode } from '../api/airportData'
import { getAirport } from '../api/airports'
import type { FlightInfo, RouteAirport } from '../api/types'
import { airlineInfo, flightDesignator, parseCallsign } from '../airline/airlines'
import { usePlayhead } from '../playback/playheadStore'
import { formatAltitude, formatSpeed, formatVerticalRate, useSettings } from '../settings/settingsStore'
import { RouteSkeleton } from '../ui/States'
import { Ticker } from '../ui/Ticker'
import { altitudeComparison, compassDirection, PHASE_LABEL } from './describe'
import { formatDistance, greatCircleNm, initialBearingDeg, routeProgress, timeToGoMs } from './route'
import { formatDuration } from './timeline'
import type { FlightView } from './useFlight'

const code = (a: RouteAirport | null | undefined) => a?.iata ?? a?.icao ?? null

/** Squawk codes that mean trouble, in words. */
const EMERGENCY_SQUAWK: Record<string, string> = { '7500': 'hijack', '7600': 'radio failure', '7700': 'emergency' }

/** The line under the flight number: whose flight it is. */
function flightOwnerLine(flight: Pick<FlightView, 'callsign' | 'real'>, info: FlightInfo | undefined, registration: string | null | undefined): { title: string | null; sub: string | null } {
  const des = flightDesignator(flight.callsign)
  const operator = airlineInfo(parseCallsign(flight.callsign)?.prefix)
  const name = info?.airline ?? operator?.name ?? null
  if (des) {
    // A regional flown for a mainline brand: "Endeavor Air for Delta".
    const forBrand = des.operator && des.operator.icao !== des.brand.icao ? ` for ${des.brand.name}` : ''
    return { title: des.text, sub: name ? `${name}${forBrand}` : des.brand.name }
  }
  if (!flight.real) return { title: null, sub: 'Scripted demo flight' }
  if (name) return { title: null, sub: name }
  return { title: null, sub: info?.owner ?? (registration && registration !== flight.callsign ? registration : 'Private or unlisted flight') }
}

/** Wall-clock time, refreshed every few seconds while `active` (for the arrival time). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 5000)
    return () => window.clearInterval(id)
  }, [active])
  return now
}

function Cell({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'alert' }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-caption2 font-medium text-white/50">{label}</div>
      <div className={`flex items-center gap-1 truncate text-body font-bold tabular-nums leading-tight ${tone === 'alert' ? 'w-fit rounded-md bg-atc-live/20 px-1.5 text-[#FF7A70] ring-1 ring-atc-live/40' : ''}`}>{value}</div>
      {hint && <div className="line-clamp-2 text-caption2 text-white/45">{hint}</div>}
    </div>
  )
}

export function FlightSummary({ flight, info, infoLoading }: { flight: FlightView; info: FlightInfo | undefined; infoLoading: boolean }) {
  const altitudeUnit = useSettings((s) => s.altitudeUnit)
  const speedUnit = useSettings((s) => s.speedUnit)
  const live = usePlayhead((s) => s.mode === 'live')
  const now = useNow(live)
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const airport = getAirport(airportIcao)
  const d = flight.detail
  const registration = info?.registration ?? d?.registration ?? null
  const owner = flightOwnerLine(flight, info, registration)

  // Route progress on the great circle, when both ends have coordinates.
  const progress = d ? routeProgress(info?.origin, info?.destination, d) : null
  const icao4 = icaoCode(airport.icao)
  const isHere = (a: RouteAirport | null | undefined) => !!a && (a.iata === airport.icao || (!!icao4 && a.icao === icao4))
  const airborne = !!d && !d.onGround
  // Arrivals here get their countdown from the timeline below; this is for flights going elsewhere.
  const toGo = airborne && progress && !isHere(info?.destination) ? timeToGoMs(progress.remainingNm, d?.speedKt) : null

  const vr = d?.verticalRateFpm ?? null
  const trend = !airborne || vr == null ? null : vr > 200 ? 'up' : vr < -200 ? 'down' : 'level'
  const TrendIcon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : trend === 'level' ? ArrowRight : null
  const squawkAlert = d?.squawk ? (EMERGENCY_SQUAWK[d.squawk] ?? null) : null
  const emergency = d?.emergency && d.emergency !== 'none' ? d.emergency : null
  const fromAirport = d ? { nm: greatCircleNm({ lat: airport.center[1], lon: airport.center[0] }, d), bearing: initialBearingDeg({ lat: airport.center[1], lon: airport.center[0] }, d) } : null

  return (
    <section aria-label="Flight" className="mb-4 overflow-hidden rounded-2xl bg-white/[0.06] ring-1 ring-white/[0.04]">
      {/* Flight number, airline, what it is doing */}
      <div className="flex items-start justify-between gap-3 px-4 pt-3">
        <div className="min-w-0">
          {owner.title && <div className="font-display text-title2 leading-none tracking-wide">{owner.title}</div>}
          {owner.sub && <div className={`truncate text-footnote text-white/60 ${owner.title ? 'mt-1' : ''}`}>{owner.sub}</div>}
        </div>
        {flight.phase && <span className="mt-0.5 shrink-0 rounded-full bg-atc-yellow px-2.5 py-1 text-caption2 font-bold text-black">{PHASE_LABEL[flight.phase]}</span>}
      </div>
      {flight.now && <p className="mt-2 px-4 text-subhead leading-snug text-white/85">{flight.now}</p>}

      {/* Route */}
      {infoLoading && (
        <div className="px-4 pt-3">
          <RouteSkeleton />
        </div>
      )}
      {(info?.origin || info?.destination) && (
        <div className="px-4 pt-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0 shrink-0">
              <div className="font-display text-title2 leading-none">{code(info.origin) ?? '—'}</div>
              <div className="mt-1 max-w-[7rem] truncate text-caption text-white/55">{info.origin?.city ?? ''}</div>
            </div>
            <div className="relative h-5 min-w-0 flex-1" role="img" aria-label={progress ? `${Math.round(progress.fraction * 100)} percent of the route flown` : 'Route'}>
              <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-white/15" />
              {progress && (
                <>
                  <div className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-atc-yellow transition-[width] duration-700" style={{ width: `${progress.fraction * 100}%` }} />
                  <Plane className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rotate-45 fill-atc-yellow text-atc-yellow transition-[left] duration-700" style={{ left: `${progress.fraction * 100}%` }} />
                </>
              )}
            </div>
            <div className="min-w-0 shrink-0 text-right">
              <div className="font-display text-title2 leading-none">{code(info.destination) ?? '—'}</div>
              <div className="ml-auto mt-1 max-w-[7rem] truncate text-caption text-white/55">{info.destination?.city ?? ''}</div>
            </div>
          </div>
          {progress && (
            <div className="mt-2 flex items-baseline justify-between gap-3 text-caption tabular-nums text-white/70">
              <span className="truncate">
                {formatDistance(progress.flownNm, speedUnit)} flown · {formatDistance(progress.remainingNm, speedUnit)} to go
              </span>
              {toGo != null && (
                <span className="shrink-0 font-semibold text-white" title="At the current groundspeed, straight to the destination">
                  {live ? `ETA ${new Date(now + toGo).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ` : ''}
                  {formatDuration(toGo)}
                </span>
              )}
            </div>
          )}
          <p className="mt-1.5 text-caption2 text-white/40">Scheduled route for this flight number. Diversions and re-used numbers can make it wrong.</p>
        </div>
      )}

      {/* Live numbers */}
      {d && (
        <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-3 border-t border-white/[0.07] px-4 pb-3.5 pt-3">
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
          {fromAirport && (
            <Cell
              label={`From ${airport.icao}`}
              value={formatDistance(fromAirport.nm, speedUnit)}
              hint={fromAirport.nm < 0.5 ? 'on the field' : `${compassDirection(fromAirport.bearing)} of the field`}
            />
          )}
        </div>
      )}
    </section>
  )
}
