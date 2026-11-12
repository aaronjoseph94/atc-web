/**
 * The selected flight, folded down to one purple strip above the tabs: shown
 * while a flight is selected but one of the tabs has the panel (reading the
 * radio while following an arrival, say). Tap it to bring the flight's page
 * back over the tabs; the cross lets the aircraft go.
 */
import { ChevronRight, X } from 'lucide-react'
import { AirlineLogo } from '../../airline/AirlineLogo'
import { PHASE_LABEL } from '../../flight/describe'
import { useFlight } from '../../flight/useFlight'
import { usePlayhead } from '../../playback/playheadStore'
import { formatAltitude, useSettings } from '../../settings/settingsStore'
import { CARD_BOTTOM, CARD_TOP, useAirlineTint } from '../../ui/airlineTint'

export function FlightChip({ onOpen }: { onOpen: () => void }) {
  const flight = useFlight()
  const altitudeUnit = useSettings((s) => s.altitudeUnit)
  const tint = useAirlineTint(flight?.callsign, flight?.icao24)
  if (!flight) return null
  const d = flight.detail
  const where = d ? (d.onGround ? 'On the ground' : formatAltitude(d.altitudeFt, altitudeUnit)) : null
  return (
    <div className="motion-rise relative mx-3 mb-2 flex shrink-0 items-stretch overflow-hidden rounded-2xl text-white shadow-[0_4px_14px_-4px_rgb(0_0_0/0.5)]" style={{ backgroundImage: `linear-gradient(to bottom, ${tint?.top ?? CARD_TOP}, ${tint?.bottom ?? CARD_BOTTOM})` }}>
      <button type="button" className="pressable-soft flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-3 pr-1 text-left" aria-label={`Back to flight ${flight.callsign}`} onClick={onOpen}>
        <AirlineLogo callsign={flight.callsign} icao24={flight.icao24} height={18} maxWidth={30} className="shrink-0" />
        <span className="display-tight shrink-0 font-display text-[1.25rem] leading-none">{flight.callsign}</span>
        <span className="min-w-0 flex-1 truncate text-caption font-medium text-white/80">{[flight.phase ? PHASE_LABEL[flight.phase] : null, where].filter(Boolean).join(' · ')}</span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-white/70" />
      </button>
      <button type="button" aria-label="Close flight" className="pressable grid w-10 shrink-0 place-items-center text-white/80 hover:bg-white/15 hover:text-white" onClick={() => usePlayhead.getState().select(null)}>
        <X className="size-4" />
      </button>
    </div>
  )
}
