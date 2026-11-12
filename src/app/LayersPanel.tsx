/** What is drawn on the map (the base map is always the navy chart). */
import { getAirport } from '../api/airports'
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
        <Row label="Procedures" hint={isUs ? 'Arrivals, departures and approaches' : 'US only'}>
          <Toggle checked={s.procedures} onChange={(v) => s.update('procedures', v)} label="Arrival, departure and approach procedures" />
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
