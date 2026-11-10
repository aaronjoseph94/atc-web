/** Keyboard shortcuts, gestures and data credits. */
import { AIRPORT_DATA_DATE, FAA_CYCLE_DATE } from '../api/airportData'
import { SHORTCUTS } from '../hooks/useShortcuts'
import { usePlayhead } from '../playback/playheadStore'
import { SectionLabel, Sheet } from '../ui/Panel'

const GESTURES: [string, string][] = [
  ['Tap an aircraft', 'Open its card and lock the camera on it'],
  ['Tap the map', 'Let the aircraft go'],
  ['Drag a card up or down', 'Open the full view, or dismiss'],
  ['Drag the map', 'Take over the camera; “Back to automatic map” hands it back'],
  ['Two fingers, or right-drag', 'Rotate and tilt'],
  ['Drag the replay timeline', 'Scrub through time'],
]

const CREDITS: [string, string, string][] = [
  ['Live traffic', 'adsb.lol, adsb.fi, OpenSky Network', 'https://adsb.lol'],
  ['Base map', 'OpenFreeMap, OpenMapTiles, © OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright'],
  ['Aerial imagery', 'USGS The National Map', 'https://www.usgs.gov/programs/national-geospatial-program/national-map'],
  ['Charts, frequencies', 'FAA Aeronautical Information Services', 'https://www.faa.gov/air_traffic/flight_info/aeronav/'],
  ['Runways', 'OurAirports', 'https://ourairports.com/data/'],
  ['Weather, ATIS', 'aviationweather.gov, atis.info', 'https://aviationweather.gov'],
  ['Radar', 'NOAA NEXRAD via Iowa Environmental Mesonet', 'https://mesonet.agron.iastate.edu/'],
  ['Routes, photos', 'adsbdb.com, airport-data.com', 'https://www.adsbdb.com'],
]

export function HelpPanel() {
  const open = usePlayhead((s) => s.panel === 'help')
  const setPanel = usePlayhead((s) => s.setPanel)
  return (
    <Sheet open={open} title="Shortcuts and credits" onClose={() => setPanel(null)}>
      <SectionLabel>Touch and mouse</SectionLabel>
      <dl className="space-y-2">
        {GESTURES.map(([k, v]) => (
          <div key={k} className="flex gap-3 text-sm">
            <dt className="w-2/5 shrink-0 font-semibold">{k}</dt>
            <dd className="text-white/70">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="hidden [@media(hover:hover)]:block">
        <SectionLabel>Keyboard</SectionLabel>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} className="flex items-center gap-3 text-sm">
              <dt className="w-14 shrink-0">
                <kbd className="rounded-md bg-white/10 px-1.5 py-0.5 font-sans text-xs font-semibold ring-1 ring-white/15">{k}</kbd>
              </dt>
              <dd className="text-white/75">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <SectionLabel>Where the data comes from</SectionLabel>
      <ul className="space-y-1.5 text-sm">
        {CREDITS.map(([what, who, href]) => (
          <li key={what} className="flex gap-3">
            <span className="w-2/5 shrink-0 text-white/60">{what}</span>
            <a href={href} target="_blank" rel="noreferrer" className="underline decoration-white/25 underline-offset-2 hover:decoration-white">
              {who}
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[11px] leading-relaxed text-atc-muted">
        Airport data refreshed {AIRPORT_DATA_DATE}
        {FAA_CYCLE_DATE ? `; FAA cycle ${FAA_CYCLE_DATE}` : ''}. Everything here is free, public data shown for interest. It is not for navigation.
      </p>
    </Sheet>
  )
}
