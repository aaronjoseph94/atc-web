/**
 * Settings: only what people change. Everyday choices up top (start airport,
 * automatic camera, units), the map toggles, and the diagnostics folded away
 * at the bottom for when something seems wrong.
 */
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, MessageSquareText } from 'lucide-react'
import { useState } from 'react'
import { AIRPORTS } from '../api/airports'
import { getAiStatus, getHealth } from '../api/client'
import { SpottingSettingsGroup, UnrecognisedDataGroup } from '../discovery/SpottingSettingsGroup'
import { openFeedback } from '../feedback/store'
import { usePlayhead } from '../playback/playheadStore'
import { supportsHaptics } from '../ui/haptics'
import { Group, Row, SectionLabel, Segmented, Sheet, Toggle } from '../ui/Panel'
import { InsightSettingsGroup } from '../insights/InsightSettingsGroup'
import { AiSettingsGroup } from './AiSettingsGroup'
import { PerformanceSettings } from '../perf/PerformanceSettings'
import { DEFAULT_SETTINGS, useSettings, type Settings } from './settingsStore'

export function SettingsView() {
  const open = usePlayhead((s) => s.panel === 'settings')
  const setPanel = usePlayhead((s) => s.setPanel)
  const setToast = usePlayhead((s) => s.setToast)
  const setCameraMode = usePlayhead((s) => s.setCameraMode)
  const settings = useSettings()
  const [more, setMore] = useState(false)
  const [hasHaptics] = useState(supportsHaptics)

  const set = <K extends keyof Settings>(key: K) => (value: Settings[K]) => settings.update(key, value)

  const resetAll = () => {
    const before = { ...settings }
    settings.reset()
    setToast({
      message: 'Settings restored to defaults',
      action: { label: 'Undo', run: () => (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).forEach((k) => settings.update(k, before[k] as never)) },
    })
  }

  const clearCaches = async () => {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
    setToast('Saved map tiles and clips cleared')
  }

  return (
    <Sheet open={open} title="Settings" onClose={() => setPanel(null)}>
      <Group>
        <Row label="Start at">
          <select className={selectCls} value={settings.defaultAirport} aria-label="Airport shown when the app opens" onChange={(e) => set('defaultAirport')(e.target.value)}>
            {AIRPORTS.map((a) => (
              <option key={a.icao} value={a.icao}>
                {a.icao} {a.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Automatic camera" hint="Follows the action">
          <Toggle
            checked={settings.autoCamera}
            label="Automatic camera"
            onChange={(v) => {
              set('autoCamera')(v)
              setCameraMode(v ? 'auto' : 'manual')
            }}
          />
        </Row>
        <Row label="Reduce motion">
          <Toggle checked={settings.reduceMotion} onChange={set('reduceMotion')} label="Reduce motion" />
        </Row>
        {/* Only phones with a vibration motor (or iPhone's switch tick) get the option. */}
        {hasHaptics && (
          <Row label="Haptics" hint="Taps on dial, card, radio">
            <Toggle checked={settings.haptics} onChange={set('haptics')} label="Haptics" />
          </Row>
        )}
      </Group>

      <SectionLabel>Units</SectionLabel>
      <Group>
        <Row label="Altitude">
          <Segmented
            label="Altitude unit"
            value={settings.altitudeUnit}
            options={[
              ['ft', 'Feet'],
              ['m', 'Metres'],
            ]}
            onChange={set('altitudeUnit')}
          />
        </Row>
        <Row label="Speed">
          <Segmented
            label="Speed unit"
            value={settings.speedUnit}
            options={[
              ['kt', 'Knots'],
              ['kmh', 'km/h'],
              ['mph', 'mph'],
            ]}
            onChange={set('speedUnit')}
          />
        </Row>
      </Group>

      <SectionLabel>Map</SectionLabel>
      <Group>
        <Row label="Callsigns">
          <Segmented
            label="Callsign labels"
            value={settings.labels}
            options={[
              ['auto', 'Auto'],
              ['always', 'All'],
              ['never', 'Off'],
            ]}
            onChange={set('labels')}
          />
        </Row>
        <Row label="Altitude and type">
          <Toggle checked={settings.dataBlocks} onChange={set('dataBlocks')} label="Altitude and type under callsigns" />
        </Row>
        <Row label="Trails">
          <Toggle checked={settings.trails} onChange={set('trails')} label="Trails" />
        </Row>
        <Row label="Approach paths">
          <Toggle checked={settings.approachPaths} onChange={set('approachPaths')} label="Approach paths" />
        </Row>
        <Row label="Procedures" hint="US only">
          <Toggle checked={settings.procedures} onChange={set('procedures')} label="Arrival, departure and approach procedures" />
        </Row>
        <Row label="Weather radar" hint="US only">
          <Toggle checked={settings.weatherRadar} onChange={set('weatherRadar')} label="Weather radar" />
        </Row>
        <Row label="Hide ground traffic">
          <Toggle checked={settings.hideGround} onChange={set('hideGround')} label="Hide aircraft on the ground" />
        </Row>
      </Group>

      <SpottingSettingsGroup />
      <InsightSettingsGroup />

      <AiSettingsGroup />

      <Group className="mt-6">
        <button type="button" className="pressable-soft -mx-3.5 flex min-h-12 w-[calc(100%+1.75rem)] items-center justify-between rounded-2xl px-3.5 text-left text-subhead font-medium hover:bg-white/[0.04]" onClick={openFeedback}>
          Send feedback
          <MessageSquareText className="size-4 text-white/40" />
        </button>
      </Group>

      <button
        type="button"
        aria-expanded={more}
        className="pressable mt-6 flex items-center gap-1 rounded-lg px-1 text-footnote font-semibold text-white/55 hover:text-white/80"
        onClick={() => setMore(!more)}
      >
        Data and diagnostics
        <ChevronDown className={`size-4 transition-transform duration-[var(--duration-base)] ease-[var(--ease-out)] ${more ? 'rotate-180' : ''}`} />
      </button>
      {more && (
        <div className="motion-rise mt-2 space-y-2">
          <Group>
            <Row label="Refresh traffic every">
              <Segmented
                label="Refresh interval"
                value={settings.pollSeconds}
                options={[
                  [5, '5 s'],
                  [8, '8 s'],
                  [15, '15 s'],
                ]}
                onChange={set('pollSeconds')}
              />
            </Row>
            <Row label="Saved tiles and clips">
              <button type="button" className={buttonCls} onClick={() => void clearCaches()}>
                Clear
              </button>
            </Row>
            <Row label="All settings">
              <button type="button" className={buttonCls} onClick={resetAll}>
                Reset
              </button>
            </Row>
          </Group>
          <PerformanceSettings />
          <BackendStatus />
          <AiStatus />
          <UnrecognisedDataGroup />
        </div>
      )}
      <p className="mt-5 px-1 text-caption text-atc-muted">Stored in this browser.</p>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

function AiStatus() {
  const status = useQuery({ queryKey: ['ai-status'], queryFn: getAiStatus, staleTime: 60_000, retry: 0 })
  const s = status.data
  const on = s?.configured
  return (
    <Group className="py-3">
      <div className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${on ? 'bg-atc-purple' : 'bg-atc-yellow'}`} />
        <span className="text-subhead font-semibold">{status.isPending ? 'Checking…' : on ? 'AI radio summaries on' : 'Built-in radio phrasebook'}</span>
      </div>
      <p className="mt-1.5 text-footnote text-atc-muted">
        {on ? `Replay summaries by ${s.model}.` : 'Built-in phrasebook. Set AI_API_KEY for AI summaries.'}
      </p>
    </Group>
  )
}

function BackendStatus() {
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const liveStatus = usePlayhead((s) => s.liveStatus)
  const liveProvider = usePlayhead((s) => s.liveProvider)
  const health = useQuery({ queryKey: ['health', airportIcao], queryFn: () => getHealth(airportIcao), refetchInterval: 15000, retry: 0 })

  const h = health.data
  const ok = health.isSuccess && h?.ok
  return (
    <Group className="py-3">
      <div className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${ok ? 'bg-emerald-400' : health.isPending ? 'bg-atc-muted' : 'bg-atc-live'}`} />
        <span className="text-subhead font-semibold">{health.isPending ? 'Checking…' : ok ? 'Feed up' : 'Feed down'}</span>
      </div>
      <dl className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-2 text-footnote">
        <KV k="Source" v={h?.provider ?? '—'} />
        <KV k="Response" v={h ? `${h.latencyMs} ms` : '—'} />
        <KV k={`Near ${airportIcao}`} v={h ? `${h.aircraft} aircraft` : '—'} />
        <KV k="This session" v={liveStatus === 'ok' ? (liveProvider ?? 'live') : liveStatus} />
        <KV k="Region" v={h?.region ?? '—'} />
        <KV k="Runtime" v={h?.runtime ?? '—'} />
      </dl>
      {h?.error && <p className="mt-2 break-words text-footnote text-atc-live">{h.error}</p>}
      {h?.sources && (
        <ul className="mt-2.5 space-y-1 text-footnote">
          {h.sources.filter((s) => s.enabled !== false).map((s) => (
            <li key={s.name} className="flex items-center gap-2" title={s.error ?? s.note ?? ''}>
              <span className={`size-1.5 shrink-0 rounded-full ${s.ok ? 'bg-emerald-400' : s.ok === false ? 'bg-atc-live' : 'bg-white/30'}`} />
              <span className="font-medium">{s.name}</span>
              <span className="truncate text-atc-muted">{s.ok === false ? (s.error ?? 'failing') : s.latencyMs != null ? `${s.latencyMs} ms` : 'standby'}{s.breaker === 'open' ? ' · paused' : ''}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2.5 text-caption text-atc-muted">Community ADS-B and MLAT feeds, merged; a failing feed is skipped.</p>
    </Group>
  )
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-atc-muted">{k}</dt>
      <dd className="truncate font-medium tabular-nums">{v}</dd>
    </div>
  )
}

const selectCls = 'max-w-[11rem] truncate rounded-lg bg-white/10 px-2.5 py-1.5 text-footnote font-medium outline-none ring-1 ring-white/10 focus:ring-atc-yellow/60'
const buttonCls = 'pressable rounded-full bg-white/10 px-3.5 py-1.5 text-footnote font-semibold hover:bg-white/[0.18]'
