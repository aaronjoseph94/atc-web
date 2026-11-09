import { useMemo } from 'react'
import { X } from 'lucide-react'
import { airportsByGroup } from '../api/airports'
import { usePlayhead } from '../playback/playheadStore'

export function AirportPicker() {
  const open = usePlayhead((s) => s.airportsOpen)
  const value = usePlayhead((s) => s.airportIcao)
  const setAirport = usePlayhead((s) => s.setAirport)
  const setAirportsOpen = usePlayhead((s) => s.setAirportsOpen)
  const groups = useMemo(() => airportsByGroup(), [])

  if (!open) return null

  return (
    <>
      <button
        type="button"
        className="picker-backdrop"
        aria-label="Close airports"
        onClick={() => setAirportsOpen(false)}
      />
      <div className="airport-sheet" role="dialog" aria-label="Select airport">
        <div className="airport-sheet-head">
          <h2>Select airport</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            onClick={() => setAirportsOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        {(['US', 'Canada'] as const).map((group) => (
          <section key={group} className="airport-group">
            <h3>{group}</h3>
            <ul>
              {groups[group].map((a) => (
                <li key={a.icao}>
                  <button
                    type="button"
                    className={`airport-option${a.icao === value ? ' active' : ''}`}
                    onClick={() => setAirport(a.icao)}
                  >
                    <span className="code">{a.icao}</span>
                    <span className="name">{a.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  )
}
