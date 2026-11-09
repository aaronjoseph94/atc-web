/**
 * The yellow station bar: airport code, airport name, active controller
 * position and an audio waveform. Tapping the code/name opens the airport
 * picker; tapping the station chip opens the station switcher.
 */
import { ChevronDown } from 'lucide-react'
import { formatMhz, FREQUENCY_ROLE } from '../api/airportData'
import { getAirport } from '../api/airports'
import { getActiveCue } from '../playback/interpolate'
import { usePlayhead } from '../playback/playheadStore'
import { Waveform } from './Waveform'

export function StationBar() {
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const stationId = usePlayhead((s) => s.stationId)
  const mode = usePlayhead((s) => s.mode)
  const playing = usePlayhead((s) => s.playing)
  const clip = usePlayhead((s) => s.clip)
  const tMs = usePlayhead((s) => s.tMs)
  const setPanel = usePlayhead((s) => s.setPanel)
  const setStationId = usePlayhead((s) => s.setStationId)

  const airport = getAirport(airportIcao)
  const station = airport.stations.find((s) => s.id === stationId) ?? airport.stations[0]
  const cue = mode === 'playback' && clip ? getActiveCue(clip.cues, tMs) : null
  const waveActive = mode === 'playback' && (playing || !!cue)

  // Cycle through this airport's stations (Tower → Ground → …).
  const nextStation = () => {
    const i = airport.stations.findIndex((s) => s.id === station.id)
    const next = airport.stations[(i + 1) % airport.stations.length]
    if (next) setStationId(next.id)
  }

  return (
    <div className="pointer-events-auto w-full overflow-hidden rounded-t-3xl bg-atc-yellow text-black shadow-[0_-10px_30px_rgba(0,0,0,0.45)] md:w-[min(92vw,40rem)] md:rounded-3xl md:shadow-2xl">
      <div className="flex items-stretch gap-3 px-4 pb-1 pt-3">
        <button
          type="button"
          className="shrink-0 text-left transition active:scale-95"
          onClick={() => setPanel('airports')}
          aria-label="Change airport"
        >
          <div className="text-[2.75rem] font-extrabold leading-none tracking-tight">{airport.icao}</div>
        </button>

        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <button
            type="button"
            className="truncate text-left text-base font-semibold leading-tight"
            onClick={() => setPanel('airports')}
          >
            {airport.name}
          </button>
          <button
            type="button"
            className="mt-1 flex w-fit max-w-full items-center gap-1 rounded-md bg-black/10 px-2 py-0.5 text-sm font-medium text-black/80 transition hover:bg-black/15"
            onClick={nextStation}
            aria-label="Switch station"
            title="Switch station"
          >
            <span className="truncate">{station?.label ?? 'Tower'}</span>
            {station?.frequencyMhz != null && (
              <span className="shrink-0 tabular-nums text-black/70">{formatMhz(station.frequencyMhz)}</span>
            )}
            <ChevronDown className="size-4 shrink-0 opacity-70" />
          </button>
          {station && <p className="mt-0.5 truncate text-[11px] leading-tight text-black/60">{FREQUENCY_ROLE[station.kind]}</p>}
        </div>
      </div>
      <div className="px-3 pb-[max(0.5rem,var(--safe-bottom))] md:pb-2">
        <Waveform active={waveActive} />
      </div>
    </div>
  )
}
