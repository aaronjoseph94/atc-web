/**
 * Airport chooser: search by code, name or city; jump to the nearest one;
 * pinned and recently opened airports up top as big tappable codes; then the
 * full list by country. Selecting switches to live mode at that airport.
 */
import { LocateFixed, Pin } from 'lucide-react'
import { useMemo, useState } from 'react'
import { AIRPORTS, getAirport, type AirportConfig } from '../api/airports'
import { distanceM } from '../map/geo'
import { usePlayhead } from '../playback/playheadStore'
import { useSettings } from '../settings/settingsStore'
import { SearchField } from '../ui/kit'
import { SectionLabel, Sheet } from '../ui/Panel'

/** Nearest catalog airport to a position. */
export function nearestAirport(lon: number, lat: number): AirportConfig {
  return AIRPORTS.reduce((best, a) => (distanceM([lon, lat], a.center) < distanceM([lon, lat], best.center) ? a : best))
}

const matches = (a: AirportConfig, q: string) => `${a.icao} ${a.name} ${a.stations[0]?.name ?? ''}`.toLowerCase().includes(q)

export function AirportPicker() {
  const open = usePlayhead((s) => s.panel === 'airports')
  const value = usePlayhead((s) => s.airportIcao)
  const setAirport = usePlayhead((s) => s.setAirport)
  const setPanel = usePlayhead((s) => s.setPanel)
  const setToast = usePlayhead((s) => s.setToast)
  const favourites = useSettings((s) => s.favourites)
  const recents = useSettings((s) => s.recents)
  const toggleFavourite = useSettings((s) => s.toggleFavourite)
  const [query, setQuery] = useState('')
  const [locating, setLocating] = useState(false)

  const q = query.trim().toLowerCase()
  const results = useMemo(() => AIRPORTS.filter((a) => !q || matches(a, q)), [q])
  // Pinned first, then recent ones that aren't already pinned.
  const quick = useMemo(() => [...favourites, ...recents.filter((c) => !favourites.includes(c))].map(getAirport).slice(0, 8), [favourites, recents])

  const locate = () => {
    if (!navigator.geolocation) {
      setToast('This browser can’t share a location. Pick an airport from the list.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        setAirport(nearestAirport(pos.coords.longitude, pos.coords.latitude).icao)
      },
      () => {
        setLocating(false)
        setToast('Location wasn’t shared. Pick an airport from the list.')
      },
      { timeout: 8000, maximumAge: 600_000 },
    )
  }

  const row = (a: AirportConfig) => {
    const active = a.icao === value
    const pinned = favourites.includes(a.icao)
    return (
      <li key={a.icao} className={`flex items-center transition-colors duration-[var(--duration-fast)] ${active ? 'rounded-2xl bg-atc-yellow/15 ring-1 ring-inset ring-atc-yellow/60' : 'ui-card hover:bg-white/[0.09]'}`}>
        <button type="button" aria-current={active || undefined} className="pressable-soft flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-2 text-left" onClick={() => setAirport(a.icao)}>
          {/* Wide enough for the widest code (MDW), so every name starts on the same line. */}
          <span className="w-14 shrink-0 font-display text-[26px] leading-none text-atc-yellow">{a.icao}</span>
          <span className="min-w-0 flex-1 truncate text-subhead">{a.name}</span>
        </button>
        <button
          type="button"
          aria-label={pinned ? `Unpin ${a.icao}` : `Pin ${a.icao}`}
          aria-pressed={pinned}
          className={`pressable mr-1.5 grid size-9 shrink-0 place-items-center rounded-full hover:bg-white/10 ${pinned ? 'text-atc-yellow' : 'text-white/30 hover:text-white/60'}`}
          onClick={() => toggleFavourite(a.icao)}
        >
          <Pin className={`size-4 ${pinned ? 'fill-current' : ''}`} />
        </button>
      </li>
    )
  }

  return (
    <Sheet open={open} title="Airports" onClose={() => setPanel(null)}>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Code, airport or city"
            label="Search airports"
            onEscape={() => (setQuery(''), true)}
            onEnter={() => {
              if (!results[0]) return false
              // Handled here (and the key press stopped): closing the sheet hands focus back to the
              // "Change airport" button before this Enter's keypress arrives, which would press
              // that button and reopen the picker.
              setAirport(results[0].icao)
              return true
            }}
          />
        </div>
        <button
          type="button"
          className="pressable flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-white/[0.08] px-3.5 text-footnote font-semibold ring-1 ring-inset ring-white/[0.07] hover:bg-white/[0.14] disabled:opacity-60"
          onClick={locate}
          disabled={locating}
        >
          <LocateFixed className={`size-4 ${locating ? 'animate-pulse-dot' : ''}`} />
          {locating ? 'Finding…' : 'Near me'}
        </button>
      </div>

      {!q && quick.length > 0 && (
        <>
          <SectionLabel>Pinned and recent</SectionLabel>
          <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {quick.map((a) => (
              <li key={a.icao} className="shrink-0">
                <button
                  type="button"
                  className={`pressable flex min-w-[5.5rem] flex-col items-start rounded-2xl px-3 py-2.5 text-left ${a.icao === value ? 'bg-atc-yellow text-black' : 'bg-white/[0.07] hover:bg-white/[0.12]'}`}
                  onClick={() => setAirport(a.icao)}
                >
                  <span className="font-display text-[32px] leading-none">{a.icao}</span>
                  <span className={`mt-1 max-w-[7rem] truncate text-caption font-medium ${a.icao === value ? 'text-black/70' : 'text-atc-muted'}`}>{a.stations[0]?.name ?? a.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {results.length === 0 ? (
        <p className="py-10 text-center text-subhead text-atc-muted">
          No airport matches “{query}”. {AIRPORTS.length} major US and Canadian airports are covered.
        </p>
      ) : (
        (['US', 'Canada'] as const).map((group) => {
          const list = results.filter((a) => a.group === group)
          if (!list.length) return null
          return (
            <section key={group}>
              <SectionLabel>{group === 'US' ? 'United States' : 'Canada'}</SectionLabel>
              <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">{list.map(row)}</ul>
            </section>
          )
        })
      )}
    </Sheet>
  )
}
