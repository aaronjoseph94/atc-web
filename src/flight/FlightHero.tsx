/**
 * The top of the full flight view, in the purple of the flight card (leaning
 * toward the airline's colour, as the card does): the airline's mark and the
 * callsign in display type, whose flight it is, what it is doing, where it is
 * going and how far along it is, and one plain sentence on what is happening
 * now. Opening the card into the full view keeps the same colour and the
 * same facts in the same places, with more beneath.
 */
import { Plane, Radio, Sparkles } from 'lucide-react'
import { useEffect, useState, type Ref } from 'react'
import { AirlineLogo } from '../airline/AirlineLogo'
import { airlineInfo, flightDesignator, parseCallsign } from '../airline/airlines'
import { icaoCode } from '../api/airportData'
import { getAirport } from '../api/airports'
import type { FlightInfo, RouteAirport } from '../api/types'
import { Terms } from '../learn/Terms'
import { usePlayhead } from '../playback/playheadStore'
import { useSettings } from '../settings/settingsStore'
import { CARD_BOTTOM, CARD_TOP, useAirlineTint } from '../ui/airlineTint'
import { Badge } from '../ui/kit'
import { Bone } from '../ui/States'
import { aircraftTypeName, PHASE_LABEL } from './describe'
import { formatDistance, routeProgress, timeToGoMs } from './route'
import { formatDuration } from './timeline'
import type { FlightView } from './useFlight'

const code = (a: RouteAirport | null | undefined) => a?.iata ?? a?.icao ?? null

/** The line under the callsign: the flight number people know it by, and whose flight it is. */
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
function useClock(active: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 5000)
    return () => window.clearInterval(id)
  }, [active])
  return now
}

export function FlightHero({ flight, info, infoLoading, titleRef }: { flight: FlightView; info: FlightInfo | undefined; infoLoading: boolean; titleRef?: Ref<HTMLHeadingElement> }) {
  const speedUnit = useSettings((s) => s.speedUnit)
  const live = usePlayhead((s) => s.mode === 'live')
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const now = useClock(live)
  const tint = useAirlineTint(flight.callsign, flight.icao24)
  const airport = getAirport(airportIcao)
  const d = flight.detail
  const type = d?.type
  const registration = info?.registration ?? d?.registration ?? null
  const owner = flightOwnerLine(flight, info, registration)

  // Route progress on the great circle, when both ends have coordinates.
  const progress = d ? routeProgress(info?.origin, info?.destination, d) : null
  const icao4 = icaoCode(airport.icao)
  const isHere = (a: RouteAirport | null | undefined) => !!a && (a.iata === airport.icao || (!!icao4 && a.icao === icao4))
  const airborne = !!d && !d.onGround
  // Arrivals here get their countdown from the timeline below; this is for flights going elsewhere.
  const toGo = airborne && progress && !isHere(info?.destination) ? timeToGoMs(progress.remainingNm, d?.speedKt) : null
  const hasRoute = !!(info?.origin || info?.destination)

  return (
    <section
      aria-label="Flight"
      data-tint={tint?.brand}
      className="relative overflow-hidden rounded-[1.375rem] px-4 pb-4 pt-3.5 text-white shadow-[0_10px_28px_-12px_rgb(0_0_0/0.7)] ring-1 ring-inset ring-white/[0.1]"
      // The two stops are registered colour properties (registerCardColors), so a change of airline cross-fades.
      style={{
        ['--card-top' as string]: tint?.top ?? CARD_TOP,
        ['--card-bottom' as string]: tint?.bottom ?? CARD_BOTTOM,
        backgroundImage: 'linear-gradient(to bottom, var(--card-top), var(--card-bottom))',
        transition: '--card-top 700ms var(--ease-in-out), --card-bottom 700ms var(--ease-in-out)',
      }}
    >
      {/* Identity */}
      <div className="flex min-w-0 items-center gap-3">
        <AirlineLogo callsign={flight.callsign} icao24={flight.icao24} height={26} maxWidth={44} className="shrink-0" />
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h2 ref={titleRef} className="display-tight truncate font-display text-[2.4rem] leading-none">
            {flight.callsign}
          </h2>
          {type && (
            <span className="shrink-0 text-subhead font-medium text-white/80" title={info?.typeName ?? aircraftTypeName(type) ?? undefined}>
              {type}
            </span>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-footnote text-white/85">
          {owner.title && <span className="mr-2 font-display text-subhead tracking-wide text-white">{owner.title}</span>}
          {owner.sub}
        </p>
        {flight.phase && <Badge tone="yellow">{PHASE_LABEL[flight.phase]}</Badge>}
      </div>

      {/* Route */}
      {infoLoading && !hasRoute && (
        <div className="mt-3.5 flex items-center gap-3 opacity-70" role="status" aria-label="Loading route">
          <Bone className="h-6 w-12" />
          <Bone className="h-0.5 flex-1" />
          <Bone className="h-6 w-12" />
        </div>
      )}
      {hasRoute && (
        <div className="mt-3.5">
          <div className="flex items-center gap-3">
            <div className="min-w-0 shrink-0">
              <div className="font-display text-title2 leading-none">{code(info?.origin) ?? '—'}</div>
              <div className="mt-1 max-w-[7rem] truncate text-caption text-white/80">{info?.origin?.city ?? ''}</div>
            </div>
            <div className="relative h-5 min-w-0 flex-1" role="img" aria-label={progress ? `${Math.round(progress.fraction * 100)} percent of the route flown` : 'Route'}>
              <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-white/25" />
              {progress && (
                <>
                  <div className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-atc-yellow transition-[width] duration-700" style={{ width: `${progress.fraction * 100}%` }} />
                  <Plane className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rotate-45 fill-atc-yellow text-atc-yellow drop-shadow-[0_1px_2px_rgb(0_0_0/0.35)] transition-[left] duration-700" style={{ left: `${progress.fraction * 100}%` }} />
                </>
              )}
            </div>
            <div className="min-w-0 shrink-0 text-right">
              <div className="font-display text-title2 leading-none">{code(info?.destination) ?? '—'}</div>
              <div className="ml-auto mt-1 max-w-[7rem] truncate text-caption text-white/80">{info?.destination?.city ?? ''}</div>
            </div>
          </div>
          {progress && (
            <div className="mt-2 flex items-baseline justify-between gap-3 text-caption tabular-nums text-white/85">
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
        </div>
      )}

      {/* What it is doing, in a sentence: the same box as on the flight card. */}
      {flight.now && (
        <div className="mt-3.5 rounded-2xl bg-white/[0.12] px-3.5 py-2.5 ring-1 ring-inset ring-white/10">
          <div className="flex items-center gap-1 text-caption2 font-semibold text-white/80">
            {flight.nowSource === 'radio-ai' ? <Sparkles aria-label="Written by AI" className="size-3" /> : flight.nowSource === 'radio' ? <Radio aria-hidden className="size-3" /> : null}
            Now
          </div>
          <p className="mt-0.5 text-subhead font-medium leading-snug">
            <Terms text={flight.now} />
          </p>
        </div>
      )}
    </section>
  )
}

/** Shown under the hero when there is a route: where it comes from, and that it can be wrong. */
export function RouteCaveat({ info }: { info: FlightInfo | undefined }) {
  if (!info?.origin && !info?.destination) return null
  return <p className="mt-2 px-1 text-caption2 leading-snug text-white/50">Scheduled route for this flight number. Diversions and re-used numbers can make it wrong.</p>
}
