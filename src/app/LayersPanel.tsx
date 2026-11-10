/** Map look and overlays: base style, 3D, radar, and what is drawn around aircraft. */
import { getAirport } from '../api/airports'
import { MAP_THEMES } from '../map/mapStyle'
import { usePlayhead } from '../playback/playheadStore'
import { useSettings } from '../settings/settingsStore'
import { Row, SectionLabel, Segmented, Sheet, Toggle } from '../ui/Panel'

export function LayersPanel() {
  const open = usePlayhead((s) => s.panel === 'layers')
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const tilt = usePlayhead((s) => s.tilt)
  const setTilt = usePlayhead((s) => s.setTilt)
  const setPanel = usePlayhead((s) => s.setPanel)
  const s = useSettings()
  const isUs = getAirport(airportIcao).group === 'US'

  return (
    <Sheet open={open} title="Map layers" onClose={() => setPanel(null)}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Map style">
        {MAP_THEMES.map((t) => {
          const unavailable = t.usOnly && !isUs
          const active = s.mapTheme === t.id && !unavailable
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={unavailable}
              className={`overflow-hidden rounded-2xl text-left ring-2 transition active:scale-[0.97] disabled:opacity-45 ${active ? 'ring-atc-yellow' : 'ring-transparent hover:ring-white/25'}`}
              onClick={() => s.update('mapTheme', t.id)}
            >
              {/* A miniature of the style: ground, infield, runway. */}
              <span className="relative block h-16" style={{ background: t.swatch[0] }}>
                <span className="absolute inset-x-3 top-3 h-6 rounded-md" style={{ background: t.swatch[1] }} />
                <span className="absolute inset-x-1 top-[1.35rem] h-1.5 rounded-full" style={{ background: t.swatch[2] }} />
                <span className="absolute left-1/2 top-9 h-5 w-1.5 -translate-x-1/2 rotate-[35deg] rounded-full" style={{ background: t.swatch[2] }} />
              </span>
              <span className="block bg-white/[0.07] px-2.5 py-2">
                <span className="block text-sm font-semibold">{t.label}</span>
                <span className="block truncate text-[11px] text-atc-muted">{unavailable ? 'US airports only' : t.hint}</span>
              </span>
            </button>
          )
        })}
      </div>

      <SectionLabel>View</SectionLabel>
      <Row label="3D view" hint="Tilt the map and raise the buildings">
        <Toggle checked={tilt} onChange={setTilt} label="3D view" />
      </Row>
      <Row label="Weather radar" hint={isUs ? 'Rain and snow from NEXRAD, updated every 5 minutes' : 'US coverage only'}>
        <Toggle checked={s.weatherRadar} onChange={(v) => s.update('weatherRadar', v)} label="Weather radar" />
      </Row>
      <Row label="Approach paths" hint="Dashed lines aircraft fly down to each runway, ticked every mile">
        <Toggle checked={s.approachPaths} onChange={(v) => s.update('approachPaths', v)} label="Approach paths" />
      </Row>

      <SectionLabel>Aircraft</SectionLabel>
      <Row label="Callsign labels" hint="Auto shows them as you zoom in">
        <Segmented
          label="Callsign labels"
          value={s.labels}
          options={[
            ['auto', 'Auto'],
            ['always', 'Always'],
            ['never', 'Never'],
          ]}
          onChange={(v) => s.update('labels', v)}
        />
      </Row>
      <Row label="Altitude and type under callsigns" hint="045↑ B738 means 4,500 ft and climbing">
        <Toggle checked={s.dataBlocks} onChange={(v) => s.update('dataBlocks', v)} label="Altitude and type under callsigns" />
      </Row>
      <Row label="Trails" hint="A short wake behind everything in the air">
        <Toggle checked={s.trails} onChange={(v) => s.update('trails', v)} label="Trails" />
      </Row>
      <Row label="Shadows" hint="Further from the aircraft the higher it flies">
        <Toggle checked={s.shadows} onChange={(v) => s.update('shadows', v)} label="Shadows" />
      </Row>
      <Row label="Hide aircraft on the ground" hint="Only show what is flying">
        <Toggle checked={s.hideGround} onChange={(v) => s.update('hideGround', v)} label="Hide aircraft on the ground" />
      </Row>
    </Sheet>
  )
}
