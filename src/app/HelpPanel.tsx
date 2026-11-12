/** Keyboard shortcuts, gestures, and the map data and credits. */
import { useEffect } from 'react'
import { AIRPORT_DATA_DATE, FAA_CYCLE_DATE } from '../api/airportData'
import { MAP_CREDITS, TRAFFIC_CREDITS, type Credit } from '../api/credits'
import { SHORTCUTS, WIDE_ONLY_SHORTCUTS } from '../hooks/useShortcuts'
import { usePlayhead } from '../playback/playheadStore'
import { useIsWide } from '../ui/layout'
import { Group, Kbd, SectionLabel, Sheet } from '../ui/Panel'
import { CREDITS_ID, takeHelpSection, wantedHelpSection } from './helpSection'

const GESTURES: [string, string][] = [
  ['Tap an aircraft', 'Open its card and follow it'],
  ['Tap the map', 'Let the aircraft go'],
  ['Tap a runway', 'Its length, headings and wind'],
  ['Tap a procedure line', 'Which arrival, departure or approach it is (turn on Procedures in the Map sheet)'],
  ['Press and hold, or right-click', 'Centre the map there'],
  ['Drag a card or sheet', 'Up for more, down to close'],
  ['Drag the map', 'Take over the camera; “Back to automatic map” hands it back'],
  ['Two fingers, or right-drag', 'Turn the map'],
  ['Drag the replay timeline', 'Scrub through time'],
]

/**
 * Everyone whose data is on screen, each with its own link. The map carries
 * no attribution control, so this list is where the licences' credit lines
 * live: the base map and the traffic feeds first (see `api/credits.ts`).
 */
const CREDITS: [string, Credit[]][] = [
  ['Base map', MAP_CREDITS],
  ['Live traffic', TRAFFIC_CREDITS],
  ['Aerial imagery', [{ name: 'USGS The National Map', href: 'https://www.usgs.gov/programs/national-geospatial-program/national-map' }]],
  ['Charts, frequencies', [{ name: 'FAA Aeronautical Information Services', href: 'https://www.faa.gov/air_traffic/flight_info/aeronav/' }]],
  ['Procedures', [{ name: 'FAA Coded Instrument Flight Procedures (CIFP)', href: 'https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/' }]],
  ['Runways', [{ name: 'OurAirports', href: 'https://ourairports.com/data/' }]],
  [
    'Aircraft details',
    [
      { name: 'hexdb.io', href: 'https://hexdb.io' },
      { name: 'adsbdb.com', href: 'https://www.adsbdb.com' },
    ],
  ],
  [
    'Weather, ATIS',
    [
      { name: 'aviationweather.gov (NOAA)', href: 'https://aviationweather.gov' },
      { name: 'atis.info', href: 'https://atis.info' },
    ],
  ],
  ['Radar', [{ name: 'NOAA NEXRAD via Iowa Environmental Mesonet', href: 'https://mesonet.agron.iastate.edu/' }]],
  ['Routes, airframes', [
      { name: 'adsbdb.com', href: 'https://www.adsbdb.com' },
      { name: 'AirNav Radar (for flights nobody else knows)', href: 'https://www.airnavradar.com' },
    ],
  ],
  ['Aircraft drawings', [{ name: 'Openclipart (public domain), drawn from published dimensions', href: 'https://openclipart.org' }]],
]

export function HelpPanel() {
  const open = usePlayhead((s) => s.panel === 'help')
  const setPanel = usePlayhead((s) => s.setPanel)
  const wide = useIsWide()

  // Opened from the menu's "Map data and credits": start at the credits.
  useEffect(() => {
    if (!open) {
      // Closed: a request nobody got to is dropped, so plain Help opens at the top next time.
      takeHelpSection()
      return
    }
    if (wantedHelpSection() !== 'credits') return
    // Once the sheet has been laid out and taken focus (it mounts on open). No glide: the sheet is still sliding in.
    const id = window.setTimeout(() => {
      takeHelpSection()
      document.getElementById(CREDITS_ID)?.scrollIntoView({ block: 'start' })
    }, 60)
    return () => window.clearTimeout(id)
  }, [open])

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
            {SHORTCUTS.filter(([k]) => wide || !WIDE_ONLY_SHORTCUTS.has(k)).map(([k, v]) => (
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

      <div id={CREDITS_ID} className="scroll-mt-2">
        <SectionLabel>Map data and credits</SectionLabel>
      </div>
      <Group>
        <ul aria-label="Map data and credits">
          {CREDITS.map(([what, who]) => (
            <li key={what} className="flex gap-3 border-b border-white/[0.07] py-2.5 text-footnote last:border-0">
              <span className="w-[42%] shrink-0 text-white/55">{what}</span>
              <span className="min-w-0">
                {who.map((c, i) => (
                  <span key={c.name}>
                    {i > 0 && ', '}
                    <a href={c.href} target="_blank" rel="noreferrer" className="underline decoration-white/25 underline-offset-2 transition-colors hover:decoration-white">
                      {c.name}
                    </a>
                  </span>
                ))}
              </span>
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
