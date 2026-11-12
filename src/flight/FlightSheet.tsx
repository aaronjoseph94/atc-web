/**
 * The selected aircraft, in two sizes.
 *
 * `FlightCard`: the purple card that replaces the station bar when a plane is
 * tapped. Identity, route, speed and altitude, a quiet line with the airline,
 * aircraft type and registration (and how far it has to go), and one plain
 * sentence on what it is doing. Drag it up (or tap the sentence) for the full
 * view; drag it down to let the aircraft go.
 *
 * `FlightDetail` (src/flight/FlightDetail.tsx, re-exported here): the
 * full-height view the card opens into.
 */
import { ChevronRight, Plane, Radio, Sparkles, X } from 'lucide-react'
import { AirlineLogo } from '../airline/AirlineLogo'
import type { CSSProperties } from 'react'
import type { FlightInfo, RouteAirport } from '../api/types'
import { airlineInfo, parseCallsign } from '../airline/airlines'
import { aircraftProfile } from '../aircraft/types'
import { useRadio } from '../live/radio/radioStore'
import { FrequencyTuner } from '../station/FrequencyTuner'
import { Waveform } from '../station/Waveform'
import { usePlayhead } from '../playback/playheadStore'
import { formatAltitude, formatSpeed, useSettings } from '../settings/settingsStore'
import { CARD_BOTTOM, CARD_TOP, registerCardColors, useAirlineTint } from '../ui/airlineTint'
import { Grabber } from '../ui/Panel'
import { Ticker } from '../ui/Ticker'
import { usePresence } from '../ui/usePresence'
import { useSheetDrag } from '../ui/useSheetDrag'
import { aircraftTypeName, PHASE_LABEL } from './describe'
import { FollowButton } from './FollowButton'
import { Terms } from '../learn/Terms'
import { formatDistance, routeProgress } from './route'
import { Sparkline } from './Sparkline'
import { useFlight, useFlightInfo, type FlightView } from './useFlight'

const code = (a: RouteAirport | null | undefined) => a?.iata ?? a?.icao ?? null

registerCardColors()

export { FlightDetail } from './FlightDetail'

/**
 * The card's gradient, leaning toward the airline's colour. The two stops are
 * registered colour properties, so switching flights cross-fades the tint.
 * Merged with the drag style, whose transform transition must survive.
 */
function cardStyle(tint: { top: string; bottom: string } | null, base: CSSProperties): CSSProperties {
  const fade = '--card-top 700ms var(--ease-in-out), --card-bottom 700ms var(--ease-in-out)'
  const drag = base.transition && base.transition !== 'none' ? `${base.transition}, ` : ''
  return {
    ...base,
    ['--card-top' as string]: tint?.top ?? CARD_TOP,
    ['--card-bottom' as string]: tint?.bottom ?? CARD_BOTTOM,
    backgroundImage: 'linear-gradient(to bottom, var(--card-top), var(--card-bottom))',
    transition: drag + fade,
  }
}

function Identity({ flight, info, big = false }: { flight: FlightView; info: FlightInfo | undefined; big?: boolean }) {
  const type = flight.detail?.type
  return (
    <div className={`flex min-w-0 items-center ${big ? 'gap-3' : 'gap-2.5'}`}>
      {/* The airline's mark, about as tall as the callsign's capitals, as in the reference. */}
      <AirlineLogo callsign={flight.callsign} icao24={flight.icao24} height={big ? 24 : 21} maxWidth={big ? 40 : 36} className="shrink-0" />
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 className={`display-tight truncate font-display leading-none ${big ? 'text-[2.6rem]' : 'text-[1.9rem]'}`}>{flight.callsign}</h2>
        {type && (
          <span className="shrink-0 text-sm font-medium text-white/70" title={info?.typeName ?? aircraftTypeName(type) ?? undefined}>
            {type}
          </span>
        )}
      </div>
    </div>
  )
}

export function FlightCard() {
  const sheet = usePlayhead((s) => s.sheet)
  const select = usePlayhead((s) => s.select)
  const setSheet = usePlayhead((s) => s.setSheet)
  const live = usePlayhead((s) => s.mode === 'live')
  const playing = usePlayhead((s) => s.playing)
  const hasAudio = usePlayhead((s) => !!s.clip?.audioUrl)
  const radioLive = useRadio((s) => s.on && (s.status === 'live' || s.status === 'buffering'))
  const altitudeUnit = useSettings((s) => s.altitudeUnit)
  const speedUnit = useSettings((s) => s.speedUnit)
  const flight = useFlight()
  const info = useFlightInfo(flight).data
  const { mounted, closing } = usePresence(sheet === 'card' && !!flight, 220)
  const drag = useSheetDrag({ onDown: () => select(null), onUp: () => setSheet('full') })
  const tint = useAirlineTint(flight?.callsign, flight?.icao24)

  if (!mounted || !flight) return null
  const d = flight.detail
  const from = code(info?.origin)
  const to = code(info?.destination)
  // One quiet line: who flies it, on what, which airframe; and how far it has to go.
  const airline = info?.airline ?? airlineInfo(parseCallsign(flight.callsign)?.prefix)?.name ?? null
  const typeName = d?.type || info?.typeName ? aircraftProfile({ type: d?.type, category: d?.category, dbName: info?.typeName, dbManufacturer: info?.manufacturer }).title : null
  const registration = info?.registration ?? d?.registration ?? null
  const about = [airline, typeName, registration && registration !== flight.callsign ? registration : null].filter(Boolean).join(' · ')
  const left = d && !d.onGround && to ? routeProgress(info?.origin, info?.destination, d) : null

  return (
    <section
      aria-label={`Flight ${flight.callsign}`}
      {...drag.handlers}
      style={cardStyle(tint, drag.dragging || drag.style.transform ? drag.style : { touchAction: 'none' })}
      data-tint={tint?.brand}
      className={`pointer-events-auto w-full cursor-grab overflow-hidden rounded-t-[1.75rem] bg-atc-card text-white shadow-[0_-12px_40px_rgba(0,0,0,0.5)] active:cursor-grabbing md:w-[min(92vw,40rem)] md:rounded-[1.75rem] ${
        closing ? 'animate-sheet-out' : 'animate-sheet-in'
      }`}
    >
      <Grabber />
      <div className="flex items-center justify-between gap-3 px-4 pt-2">
        <Identity flight={flight} info={info} />
        <div className="flex shrink-0 items-center gap-2">
          <FollowButton tone="card" />
          <button type="button" data-no-drag aria-label="Close flight" className="grid size-8 place-items-center rounded-full bg-white/15 transition hover:bg-white/25 active:scale-90" onClick={() => select(null)}>
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-4 px-4 text-[15px] font-medium">
        <span className="flex min-w-0 items-center gap-1.5">
          {from || to ? (
            <>
              <span>{from ?? '—'}</span>
              <Plane className="size-3.5 rotate-45 text-white/70" aria-label="to" />
              <span>{to ?? '—'}</span>
            </>
          ) : (
            <span className="truncate text-white/75">{flight.phase ? PHASE_LABEL[flight.phase] : 'Locating…'}</span>
          )}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 tabular-nums">
          <Sparkline values={flight.series.speedKt} className="h-4 w-10 text-white/70" />
          <Ticker value={d?.speedKt} format={(v) => formatSpeed(v, speedUnit)} />
        </span>
        <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
          <Sparkline values={flight.series.altitudeFt} className="h-4 w-10 text-white/70" />
          {d?.onGround ? 'GND' :           <Ticker value={d?.altitudeFt} format={(v) => formatAltitude(v, altitudeUnit)} />}
        </span>
      </div>
      {(about || left) && (
        <div className="mt-0.5 flex items-baseline gap-3 px-4 text-caption text-white/60">
          <span className="min-w-0 flex-1 truncate">{about}</span>
          {left && (
            <span className="shrink-0 tabular-nums text-white/70">
              {formatDistance(left.remainingNm, speedUnit)} to {to}
            </span>
          )}
        </div>
      )}

      <button
        type="button"
        data-no-drag
        className="mx-4 mt-2.5 flex w-[calc(100%-2rem)] items-center gap-3 rounded-2xl bg-white/12 px-3.5 py-2.5 text-left ring-1 ring-white/10 transition hover:bg-white/18 active:scale-[0.99]"
        onClick={() => setSheet('full')}
        aria-label="Open full flight details"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 text-[11px] font-semibold text-white/60">
            {flight.nowSource === 'radio-ai' ? <Sparkles className="size-3" /> : flight.nowSource === 'radio' ? <Radio className="size-3" /> : null}
            Now
          </span>
          {flight.now ? (
            <span className="mt-0.5 line-clamp-2 block text-[15px] font-medium leading-snug">
              <Terms text={flight.now} />
            </span>
          ) : (
            <span className="mt-1.5 block space-y-1.5" aria-label="Loading">
              <span className="skeleton block h-3.5 w-11/12" />
              <span className="skeleton block h-3.5 w-7/12" />
            </span>
          )}
        </span>
        <ChevronRight className="size-5 shrink-0 text-white/50" />
      </button>

      {/* Live, the foot of the card is a dial for changing channel; a replayed scene stays on its own channel. */}
      {live ? (
        <FrequencyTuner />
      ) : (
        <p className="px-4 pb-2 pt-2.5 text-center text-[13px] font-medium text-white/75">{flight.stationLine}</p>
      )}
      {/* The channel's audio, as on the station bar. */}
      <div className="pb-[var(--safe-bottom)] md:pb-1">
        <Waveform active={live ? radioLive : playing && hasAudio} source={live ? 'live' : 'replay'} color="rgba(255,255,255,0.5)" />
      </div>
    </section>
  )
}
