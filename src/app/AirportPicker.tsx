/** Airport chooser, grouped by country. Selecting switches to live mode at that airport. */
import { Check } from 'lucide-react'
import { useMemo } from 'react'
import { airportsByGroup } from '../api/airports'
import { usePlayhead } from '../playback/playheadStore'
import { SectionLabel, Sheet } from '../ui/Panel'

export function AirportPicker() {
  const open = usePlayhead((s) => s.panel === 'airports')
  const value = usePlayhead((s) => s.airportIcao)
  const setAirport = usePlayhead((s) => s.setAirport)
  const setPanel = usePlayhead((s) => s.setPanel)
  const groups = useMemo(() => airportsByGroup(), [])

  if (!open) return null

  return (
    <Sheet title="Select airport" onClose={() => setPanel(null)}>
      {(['US', 'Canada'] as const).map((group) => (
        <section key={group}>
          <SectionLabel>{group === 'US' ? 'United States' : 'Canada'}</SectionLabel>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {groups[group].map((a) => {
              const active = a.icao === value
              return (
                <li key={a.icao}>
                  <button
                    type="button"
                    aria-pressed={active}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                      active
                        ? 'bg-atc-yellow/15 ring-1 ring-atc-yellow/60'
                        : 'bg-white/[0.04] hover:bg-atc-purple/15'
                    }`}
                    onClick={() => setAirport(a.icao)}
                  >
                    <span className="w-12 text-base font-bold tracking-wide text-atc-yellow">{a.icao}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{a.name}</span>
                    {active && <Check className="size-4 text-atc-yellow" />}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </Sheet>
  )
}
