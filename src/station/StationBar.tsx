/**
 * The yellow station bar: airport code, airport name and the controller
 * position being followed. Tapping the code or name opens the airport
 * picker; tapping the position opens the channel switcher; the round button
 * plays the channel live (LiveATC). In playback the bar turns into the
 * replay timeline.
 */
import { ChevronRight, Wind } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { formatMhz } from '../api/airportData'
import { getAirport, resolveStation } from '../api/airports'
import { getWeather } from '../api/client'
import { useRadio } from '../live/radio/radioStore'
import type { FlightCategory } from '../api/types'
import { Timeline } from '../playback/Timeline'
import { usePlayhead } from '../playback/playheadStore'
import { RadioButton, RadioStatusLine } from './RadioButton'
import { Waveform } from './Waveform'

/** Flight-category colours as used on every aviation weather map. */
export const CATEGORY_COLOR: Record<FlightCategory, string> = { VFR: '#16A34A', MVFR: '#2563EB', IFR: '#DC2626', LIFR: '#C026D3' }

/** Weather for the current airport; shared cache entry for the bar and the weather panel. */
export function useWeather(airport: string) {
  return useQuery({ queryKey: ['weather', airport], queryFn: () => getWeather(airport), staleTime: 4 * 60_000, refetchInterval: 5 * 60_000, retry: 1 })
}

export function StationBar() {
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const stationId = usePlayhead((s) => s.stationId)
  const mode = usePlayhead((s) => s.mode)
  const playing = usePlayhead((s) => s.playing)
  const clip = usePlayhead((s) => s.clip)
  const setPanel = usePlayhead((s) => s.setPanel)
  const radioLive = useRadio((s) => s.on && (s.status === 'live' || s.status === 'buffering'))

  const airport = getAirport(airportIcao)
  const station = resolveStation(airport, stationId)
  const weather = useWeather(airportIcao).data?.metar
  const stationText = station ? `${station.label}${station.frequencyMhz != null ? ` ${formatMhz(station.frequencyMhz)}` : ''}` : 'Tower'

  if (mode === 'playback' && clip) {
    return (
      <div className="on-yellow pointer-events-auto w-full overflow-hidden rounded-t-[1.75rem] bg-atc-yellow text-black shadow-[0_-10px_30px_rgba(0,0,0,0.45)] md:w-[min(92vw,40rem)] md:rounded-[1.75rem] md:shadow-2xl">
        <Timeline clip={clip} label={clip.kind === 'rewind' ? `${airport.icao} traffic replay` : `${airport.icao} ${stationText}`} />
        {clip.audioUrl && <Waveform active={playing} source="replay" />}
      </div>
    )
  }

  return (
    <div className="on-yellow pointer-events-auto w-full overflow-hidden rounded-t-[1.75rem] bg-atc-yellow text-black shadow-[0_-10px_30px_rgba(0,0,0,0.45)] md:w-[min(92vw,40rem)] md:rounded-[1.75rem] md:shadow-2xl">
      <div className="flex items-center gap-3 px-4 pb-1 pt-3">
        <button
          type="button"
          className="display-tight shrink-0 rounded-lg font-display text-[3.4rem] leading-[0.95] transition active:scale-95"
          onClick={() => setPanel('airports')}
          aria-label={`Change airport. Showing ${airport.name}`}
        >
          {airport.icao}
        </button>

        <div className="flex min-w-0 flex-1 flex-col items-start justify-center gap-1">
          <button type="button" className="max-w-full truncate rounded text-left text-[17px] font-bold leading-tight" onClick={() => setPanel('airports')} tabIndex={-1}>
            {airport.stations[0]?.name ?? airport.name}
          </button>
          <button
            type="button"
            className="flex max-w-full items-center gap-1 rounded-lg bg-black/10 py-1 pl-2 pr-1 text-sm font-semibold text-black/85 transition hover:bg-black/15 active:scale-[0.97]"
            onClick={() => setPanel('stations')}
            aria-label={`Switch channel. Following ${stationText}`}
          >
            <span className="truncate">{station?.label ?? 'Tower'}</span>
            <ChevronRight className="size-4 shrink-0" />
          </button>
        </div>

        {weather && (
          <button
            type="button"
            className="flex shrink-0 flex-col items-end gap-0.5 rounded-xl bg-black/10 px-2.5 py-1.5 text-right transition hover:bg-black/15 active:scale-95"
            onClick={() => setPanel('weather')}
            aria-label="Weather and ATIS"
          >
            <span className="flex items-center gap-1.5 text-[11px] font-bold">
              {weather.flightCategory && <span className="size-2 rounded-full ring-1 ring-black/20" style={{ background: CATEGORY_COLOR[weather.flightCategory] }} />}
              {weather.flightCategory ?? 'Weather'}
            </span>
            <span className="flex items-center gap-1 text-xs font-semibold tabular-nums text-black/80">
              <Wind className="size-3.5" />
              {weather.windKt ? `${weather.windDirDeg != null ? `${String(weather.windDirDeg).padStart(3, '0')}°` : 'Vrb'} ${weather.windKt}${weather.gustKt ? `G${weather.gustKt}` : ''}` : 'Calm'}
            </span>
          </button>
        )}
        <RadioButton label={stationText} />
      </div>
      <RadioStatusLine />
      <div className="pb-[var(--safe-bottom)]">
        <Waveform active={radioLive} source="live" />
      </div>
    </div>
  )
}
