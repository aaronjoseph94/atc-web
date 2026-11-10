/** Gestures, keyboard shortcuts and the one-line data credit. */
import { AIRPORT_DATA_DATE } from '../api/airportData'
import { SHORTCUTS, WIDE_ONLY_SHORTCUTS } from '../hooks/useShortcuts'
import { usePlayhead } from '../playback/playheadStore'
import { useIsWide } from '../ui/layout'
import { Group, Kbd, SectionLabel, Sheet } from '../ui/Panel'

const GESTURES: [string, string][] = [
  ['Tap aircraft', 'Follow it'],
  ['Tap map', 'Let go'],
  ['Tap runway', 'Details'],
  ['Hold or right-click', 'Centre map'],
  ['Drag card', 'Up: more. Down: close'],
  ['Drag map', 'Manual camera'],
  ['Two fingers or right-drag', 'Rotate'],
]

export function HelpPanel() {
  const open = usePlayhead((s) => s.panel === 'help')
  const setPanel = usePlayhead((s) => s.setPanel)
  const wide = useIsWide()
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

      {/* Attribution the data licences ask for (ODbL, adsb.fi). */}
      <p className="mt-6 px-1 text-caption text-atc-muted">
        Data: adsb.fi, adsb.lol (ODbL), adsb.one, OpenSky, OpenStreetMap, FAA, NOAA. Airport data {AIRPORT_DATA_DATE}. Not for navigation.
      </p>
    </Sheet>
  )
}
