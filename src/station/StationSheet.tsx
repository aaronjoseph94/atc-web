/**
 * Channel switcher: every published controller position at the airport,
 * grouped the way a pilot thinks of them (tower by runway, ground by sector,
 * approach, departure…). The sheet grows out of the yellow station bar.
 */
import { ChevronDown, ExternalLink, Volume2 } from 'lucide-react'
import { FAA_CYCLE_DATE, FREQUENCY_LABEL, FREQUENCY_ORDER, FREQUENCY_ROLE, formatMhz, icaoCode } from '../api/airportData'
import { getAirport, resolveStation } from '../api/airports'
import type { Station } from '../api/types'
import { usePlayhead } from '../playback/playheadStore'
import { Grabber, useDialog } from '../ui/Panel'
import { usePresence } from '../ui/usePresence'
import { useSheetDrag } from '../ui/useSheetDrag'

export function StationSheet() {
  const open = usePlayhead((s) => s.panel === 'stations')
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const stationId = usePlayhead((s) => s.stationId)
  const setStationId = usePlayhead((s) => s.setStationId)
  const setPanel = usePlayhead((s) => s.setPanel)

  const close = () => setPanel(null)
  const { mounted, closing } = usePresence(open, 240)
  const ref = useDialog(open, close)
  const drag = useSheetDrag({ onDown: close })
  if (!mounted) return null

  const airport = getAirport(airportIcao)
  const current = resolveStation(airport, stationId)
  const groups = FREQUENCY_ORDER.map((kind) => ({ kind, stations: airport.stations.filter((s) => s.kind === kind) })).filter((g) => g.stations.length)

  const choose = (s: Station) => {
    setStationId(s.id)
    // ATIS is the one channel we can actually let you hear: it opens with the broadcast.
    setPanel(s.kind === 'ATIS' ? 'weather' : null)
  }

  return (
    <div className="absolute inset-0 z-50 flex items-end justify-center">
      <button type="button" tabIndex={-1} aria-label="Close" className={`absolute inset-0 bg-black/40 ${closing ? 'animate-fade-out' : 'animate-fade'}`} onClick={close} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`Channels at ${airport.name}`}
        tabIndex={-1}
        style={drag.dragging || drag.style.transform ? drag.style : undefined}
        className={`on-yellow grain relative flex max-h-[84dvh] w-full flex-col overflow-hidden rounded-t-[1.75rem] bg-atc-yellow text-black shadow-[0_-16px_50px_rgba(0,0,0,0.5)] outline-none md:mb-6 md:w-[min(92vw,40rem)] md:rounded-[1.75rem] ${
          closing ? 'animate-sheet-out' : 'animate-sheet-in'
        }`}
      >
        <div {...drag.handlers} className="shrink-0 cursor-grab touch-none border-b border-black/10 active:cursor-grabbing">
          <Grabber dark />
          <div className="flex items-center gap-3 px-4 pb-3 pt-1">
            <div className="display-tight shrink-0 font-display text-[3.4rem] leading-[0.95]">{airport.icao}</div>
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
              <div className="max-w-full truncate text-[17px] font-bold leading-tight">{airport.stations[0]?.name ?? airport.name}</div>
              <button
                type="button"
                className="flex max-w-full items-center gap-1 rounded-lg bg-black/10 py-1 pl-2 pr-1 text-sm font-semibold text-black/85 transition hover:bg-black/15"
                onClick={close}
                aria-label="Close channel list"
              >
                <span className="truncate">{current?.label ?? 'Tower'}</span>
                <ChevronDown className="size-4 shrink-0" />
              </button>
            </div>
          </div>
        </div>

        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1.25rem,var(--safe-bottom))]">
          {groups.map((g) => (
            <section key={g.kind} aria-label={FREQUENCY_LABEL[g.kind]}>
              <h3 className="mb-2 mt-5 text-[13px] font-bold tracking-wide text-black/75">{FREQUENCY_LABEL[g.kind]}</h3>
              <ul className="overflow-hidden rounded-2xl bg-atc-yellow-deep">
                {g.stations.map((s) => {
                  const active = s.id === current?.id
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        aria-pressed={active}
                        className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors ${active ? 'bg-atc-yellow-press' : 'hover:bg-black/5 active:bg-black/10'}`}
                        onClick={() => choose(s)}
                      >
                        <span className="min-w-0 flex-1 truncate text-[17px] font-semibold">{s.position}</span>
                        {s.kind === 'ATIS' && <Volume2 className="size-4 shrink-0 text-black/60" aria-label="Can be read aloud" />}
                        {s.frequencyMhz != null && <span className="shrink-0 text-sm font-medium tabular-nums text-black/70">{formatMhz(s.frequencyMhz)}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-1.5 px-1 text-xs text-black/60">{FREQUENCY_ROLE[g.kind]}</p>
            </section>
          ))}

          <a
            href={`https://www.liveatc.net/search/?icao=${icaoCode(airport.icao) ?? airport.icao}`}
            target="_blank"
            rel="noreferrer"
            className="mt-6 flex items-center justify-between gap-3 rounded-2xl bg-black px-4 py-3.5 text-white transition hover:bg-black/85 active:scale-[0.99]"
          >
            <span>
              <span className="block text-[15px] font-semibold">Listen live on LiveATC</span>
              <span className="block text-xs text-white/65">Opens liveatc.net. Their streams can’t be embedded here.</span>
            </span>
            <ExternalLink className="size-4 shrink-0" />
          </a>
          <p className="mt-3 px-1 text-[11px] leading-relaxed text-black/55">
            {FAA_CYCLE_DATE && airport.group === 'US' ? `Frequencies from the FAA’s ${FAA_CYCLE_DATE} data cycle.` : 'Frequencies from OurAirports.'} For interest only, not for navigation.
          </p>
        </div>
      </div>
    </div>
  )
}
