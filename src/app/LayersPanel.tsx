/** Map look and overlays: the base style, then a short list of what is drawn on top. */
import { getAirport } from '../api/airports'
import { MAP_THEMES } from '../map/mapStyle'
import { usePlayhead } from '../playback/playheadStore'
import { useSettings } from '../settings/settingsStore'
import { Group, Row, SectionLabel, Segmented, Sheet, Toggle } from '../ui/Panel'

export function LayersPanel() {
  const open = usePlayhead((s) => s.panel === 'layers')
  const isUs = usePlayhead((s) => getAirport(s.airportIcao).group === 'US')
  const setPanel = usePlayhead((s) => s.setPanel)
  const s = useSettings()

  return (
    <Sheet open={open} title="Map" onClose={() => setPanel(null)}>
      <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Map style">
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
              title={unavailable ? 'US airports only' : t.hint}
              className="group pressable flex flex-col items-center gap-1.5 text-center disabled:opacity-40"
              onClick={() => s.update('mapTheme', t.id)}
            >
              {/* A miniature of the style: ground, infield, runway. */}
              <span
                className={`relative block aspect-[4/3] w-full overflow-hidden rounded-xl ring-2 ring-offset-2 ring-offset-atc-panel transition-shadow duration-[var(--duration-fast)] ${active ? 'ring-atc-yellow' : 'ring-transparent group-hover:ring-white/20'}`}
                style={{ background: t.swatch[0] }}
              >
                <span className="absolute inset-x-[18%] top-[22%] h-[40%] rounded-md" style={{ background: t.swatch[1] }} />
                <span className="absolute inset-x-[6%] top-[38%] h-[9%] rounded-full" style={{ background: t.swatch[2] }} />
                <span className="absolute left-1/2 top-[52%] h-[38%] w-[8%] -translate-x-1/2 rotate-[35deg] rounded-full" style={{ background: t.swatch[2] }} />
              </span>
              <span className={`text-footnote font-semibold ${active ? 'text-white' : 'text-white/65'}`}>{t.label}</span>
            </button>
          )
        })}
      </div>
      {!isUs && <p className="mt-2 px-1 text-caption text-atc-muted">Satellite and FAA chart cover US airports only.</p>}

      <SectionLabel>On the map</SectionLabel>
      <Group>
        <Row label="Lighting" hint={s.lighting === 'auto' ? 'Follows the sun' : s.lighting === 'day' ? 'Always daylight' : 'Airfield lights on'}>
          <Segmented
            label="Lighting"
            value={s.lighting}
            options={[
              ['auto', 'Auto'],
              ['day', 'Day'],
              ['night', 'Night'],
            ]}
            onChange={(v) => s.update('lighting', v)}
          />
        </Row>
        <Row label="Callsigns">
          <Segmented
            label="Callsign labels"
            value={s.labels}
            options={[
              ['auto', 'Auto'],
              ['always', 'All'],
              ['never', 'Off'],
            ]}
            onChange={(v) => s.update('labels', v)}
          />
        </Row>
        <Row label="Altitude and type" hint="Under each callsign">
          <Toggle checked={s.dataBlocks} onChange={(v) => s.update('dataBlocks', v)} label="Altitude and type under callsigns" />
        </Row>
        <Row label="Trails">
          <Toggle checked={s.trails} onChange={(v) => s.update('trails', v)} label="Trails" />
        </Row>
        <Row label="Approach paths">
          <Toggle checked={s.approachPaths} onChange={(v) => s.update('approachPaths', v)} label="Approach paths" />
        </Row>
        <Row label="Weather radar" hint={isUs ? undefined : 'US only'}>
          <Toggle checked={s.weatherRadar} onChange={(v) => s.update('weatherRadar', v)} label="Weather radar" />
        </Row>
        <Row label="Wind lines" hint="Drift with the reported wind">
          <Toggle checked={s.windStreamlines} onChange={(v) => s.update('windStreamlines', v)} label="Wind lines" />
        </Row>
        <Row label="Only aircraft in the air">
          <Toggle checked={s.hideGround} onChange={(v) => s.update('hideGround', v)} label="Hide aircraft on the ground" />
        </Row>
      </Group>
    </Sheet>
  )
}
