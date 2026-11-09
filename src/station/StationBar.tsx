import { ChevronRight } from 'lucide-react'
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
  const setAirportsOpen = usePlayhead((s) => s.setAirportsOpen)
  const setMenuOpen = usePlayhead((s) => s.setMenuOpen)

  const airport = getAirport(airportIcao)
  const station = airport.stations.find((s) => s.id === stationId) ?? airport.stations[0]
  const cue = mode === 'playback' && clip ? getActiveCue(clip.cues, tMs) : null
  const waveActive = mode === 'playback' ? playing || !!cue : !!cue

  return (
    <div className="relative z-20 shrink-0 overflow-hidden rounded-t-2xl bg-atc-yellow text-black shadow-[0_-8px_24px_rgba(0,0,0,0.35)]">
      <div className="flex w-full items-stretch gap-3 px-4 pb-1 pt-3">
        <button
          type="button"
          className="text-left"
          onClick={() => setAirportsOpen(true)}
          aria-label="Change airport"
        >
          <div className="text-[2.75rem] font-extrabold leading-none tracking-tight">
            {airport.icao}
          </div>
        </button>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="flex min-w-0 flex-1 flex-col justify-center text-left"
        >
          <div className="truncate text-base font-semibold leading-tight">{airport.name}</div>
          <div className="mt-0.5 flex items-center gap-1 text-sm font-medium text-black/75">
            <span className="truncate rounded bg-black/10 px-2 py-0.5">
              {station?.label ?? 'Tower'}
            </span>
            <ChevronRight className="size-4 shrink-0 opacity-70" />
          </div>
        </button>
      </div>
      <div className="px-2 pb-[max(0.35rem,var(--safe-bottom))]">
        <Waveform active={waveActive} />
      </div>
    </div>
  )
}
