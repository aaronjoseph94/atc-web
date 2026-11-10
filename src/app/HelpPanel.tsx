/** Keyboard shortcuts, gestures and data credits. */
import { AIRPORT_DATA_DATE, FAA_CYCLE_DATE } from '../api/airportData'
import { SHORTCUTS } from '../hooks/useShortcuts'
import { usePlayhead } from '../playback/playheadStore'
import { Group, Kbd, SectionLabel, Sheet } from '../ui/Panel'

const GESTURES: [string, string][] = [
  ['Tap an aircraft', 'Open its card and follow it'],
  ['Tap the map', 'Let the aircraft go'],
  ['Tap a runway', 'Its length, headings and wind'],
  ['Press and hold, or right-click', 'Centre the map there'],
  ['Drag a card or sheet', 'Up for more, down to close'],
  ['Drag the map', 'Take over the camera; “Back to automatic map” hands it back'],
  ['Two fingers, or right-drag', 'Turn the map'],
  ['Drag the replay timeline', 'Scrub through time'],
]

const CREDITS: [string, string, string][] = [
  ['Live traffic', 'adsb.fi, adsb.lol (ODbL), The OpenSky Network', 'https://adsb.fi'],
  ['Base map', 'OpenFreeMap, OpenMapTiles, © OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright'],
  ['Aerial imagery', 'USGS The National Map', 'https://www.usgs.gov/programs/national-geospatial-program/national-map'],
  ['Charts, frequencies', 'FAA Aeronautical Information Services', 'https://www.faa.gov/air_traffic/flight_info/aeronav/'],
  ['Runways', 'OurAirports', 'https://ourairports.com/data/'],
  ['Aircraft details', 'hexdb.io, adsbdb.com, ADS-B feeds', 'https://hexdb.io'],
  ['Weather, ATIS', 'aviationweather.gov, NOAA, atis.info', 'https://aviationweather.gov'],
  ['Radar', 'NOAA NEXRAD via Iowa Environmental Mesonet', 'https://mesonet.agron.iastate.edu/'],
  ['Routes, airframes', 'adsbdb.com', 'https://www.adsbdb.com'],
  ['Aircraft drawings', 'Openclipart (public domain), drawn from published dimensions', 'https://openclipart.org'],
]

export function HelpPanel() {
  const open = usePlayhead((s) => s.panel === 'help')
  const setPanel = usePlayhead((s) => s.setPanel)
  return (
    <Sheet open={open} title="Help" onClose={() => setPanel(null)}>
      <SectionLabel>Touch and mouse</SectionLabel>
      <Group>
        <dl>
          {GESTURES.map(([k, v]) => (
            <div key={k} className="flex gap-3 border-b border-white/[0.07] py-2.5 text-footnote last:border-0">
              <dt className="w-[42%] shrink-0 font-semibold">{k}</dt>
              <dd className="text-white/65">{v}</dd>
            </div>
          ))}
        </dl>
      </Group>

      <div className="hidden [@media(hover:hover)]:block">
        <SectionLabel>Keyboard</SectionLabel>
        <Group className="py-2">
          <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {SHORTCUTS.map(([k, v]) => (
              <div key={k} className="flex items-center gap-3 py-1.5 text-footnote">
                <dt className="flex w-14 shrink-0 gap-1">
                  {k.split(' ').map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </dt>
                <dd className="text-white/70">{v}</dd>
              </div>
            ))}
          </dl>
        </Group>
      </div>

      <SectionLabel>Where the data comes from</SectionLabel>
      <Group>
        <ul>
          {CREDITS.map(([what, who, href]) => (
            <li key={what} className="flex gap-3 border-b border-white/[0.07] py-2.5 text-footnote last:border-0">
              <span className="w-[42%] shrink-0 text-white/55">{what}</span>
              <a href={href} target="_blank" rel="noreferrer" className="min-w-0 underline decoration-white/25 underline-offset-2 transition-colors hover:decoration-white">
                {who}
              </a>
            </li>
          ))}
        </ul>
      </Group>
      <p className="mt-4 px-1 text-caption text-atc-muted">
        Airport data refreshed {AIRPORT_DATA_DATE}
        {FAA_CYCLE_DATE ? `; FAA cycle ${FAA_CYCLE_DATE}` : ''}. Everything here is free, public data shown for interest. It is not for navigation.
      </p>
    </Sheet>
  )
}
