/**
 * Settings page. Two halves:
 *   1. Preferences — persisted in `useSettings` (localStorage) and applied
 *      live across the app (map, flight sheet, polling).
 *   2. Backend status — read-only diagnostics from `/api/health` so a user
 *      can see which free data provider is serving traffic and whether the
 *      edge functions are healthy.
 */
import { useQuery } from '@tanstack/react-query'
import { Activity, RotateCcw } from 'lucide-react'
import { AIRPORTS } from '../api/airports'
import { getAiStatus, getHealth } from '../api/client'
import { usePlayhead } from '../playback/playheadStore'
import { FullPanel, Row, SectionLabel, Segmented, Toggle } from '../ui/Panel'
import { DEFAULT_SETTINGS, useSettings, type Settings } from './settingsStore'

export function SettingsView() {
  const open = usePlayhead((s) => s.panel === 'settings')
  const setPanel = usePlayhead((s) => s.setPanel)
  const setToast = usePlayhead((s) => s.setToast)
  const setCameraMode = usePlayhead((s) => s.setCameraMode)
  const settings = useSettings()

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
    <FullPanel
      open={open}
      title="Settings"
      onClose={() => setPanel(null)}
      headerExtra={
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-xs font-semibold transition hover:bg-white/20 active:scale-95"
          onClick={resetAll}
        >
          <RotateCcw className="size-3.5" /> Reset
        </button>
      }
    >
      <SectionLabel>Startup</SectionLabel>
      <Row label="Default airport" hint="Shown when the app opens">
        <select className={selectCls} value={settings.defaultAirport} aria-label="Default airport" onChange={(e) => set('defaultAirport')(e.target.value)}>
          {AIRPORTS.map((a) => (
            <option key={a.icao} value={a.icao}>
              {a.icao} {a.name}
            </option>
          ))}
        </select>
      </Row>

      <SectionLabel>Live traffic</SectionLabel>
      <Row label="Refresh every" hint="How often new positions are fetched">
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
      <Row label="Trail length" hint="How much path is kept behind the selected aircraft">
        <Segmented
          label="Trail length"
          value={settings.trailLength}
          options={[
            [24, 'Short'],
            [48, 'Medium'],
            [96, 'Long'],
          ]}
          onChange={set('trailLength')}
        />
      </Row>

      <SectionLabel>Camera and motion</SectionLabel>
      <Row label="Automatic map" hint="Move to whoever just took off, landed or is talking">
        <Toggle
          checked={settings.autoCamera}
          label="Automatic map"
          onChange={(v) => {
            set('autoCamera')(v)
            setCameraMode(v ? 'auto' : 'manual')
          }}
        />
      </Row>
      <Row label="Reduce motion" hint="No pulses, pings or camera glides">
        <Toggle checked={settings.reduceMotion} onChange={set('reduceMotion')} label="Reduce motion" />
      </Row>
      <Row label="Map style and overlays">
        <button type="button" className={buttonCls} onClick={() => setPanel('layers')}>
          Map layers
        </button>
      </Row>

      <SectionLabel>Units</SectionLabel>
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

      <SectionLabel>Radio explanations</SectionLabel>
      <AiStatus />

      <SectionLabel>Data feed</SectionLabel>
      <BackendStatus />

      <SectionLabel>Storage</SectionLabel>
      <Row label="Saved map tiles and clips" hint="Kept on this device so revisits load fast">
        <button type="button" className={buttonCls} onClick={() => void clearCaches()}>
          Clear
        </button>
      </Row>
      <p className="mt-4 text-[11px] leading-relaxed text-atc-muted">Settings, pinned airports and history stay in this browser. Nothing is sent to a server.</p>
    </FullPanel>
  )
}

// ---------------------------------------------------------------------------
// Backend diagnostics
// ---------------------------------------------------------------------------

function AiStatus() {
  const open = usePlayhead((s) => s.panel === 'settings')
  const status = useQuery({
    queryKey: ['ai-status'],
    queryFn: getAiStatus,
    staleTime: 60_000,
    retry: 0,
    enabled: open,
  })
  const s = status.data
  const on = s?.configured

  return (
    <div className="rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
      <div className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${on ? 'bg-atc-purple' : 'bg-atc-yellow'}`} />
        <span className="text-sm font-semibold">
          {status.isPending ? 'Checking…' : on ? 'AI summaries are on' : 'Built-in phrasebook'}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-atc-muted">
        {on
          ? `In a replay, tapping a plane asks ${s.model} for a plain-English summary of its latest radio calls.`
          : 'In a replay, tapping a plane explains its latest radio call in everyday language using a built-in phrasebook. To have a model write it instead, set AI_API_KEY on the server (see the README).'}
      </p>
    </div>
  )
}

function BackendStatus() {
  const open = usePlayhead((s) => s.panel === 'settings')
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const liveStatus = usePlayhead((s) => s.liveStatus)
  const liveUpdatedAt = usePlayhead((s) => s.liveUpdatedAt)
  const liveProvider = usePlayhead((s) => s.liveProvider)

  const health = useQuery({
    queryKey: ['health', airportIcao],
    queryFn: () => getHealth(airportIcao),
    refetchInterval: 15000,
    retry: 0,
    enabled: open,
  })

  const h = health.data
  const ok = health.isSuccess && h?.ok

  return (
    <div className="rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
      <div className="flex items-center gap-2">
        <Activity className={`size-4 ${ok ? 'text-emerald-400' : health.isPending ? 'text-atc-muted' : 'text-atc-live'}`} />
        <span className="text-sm font-semibold">
          {health.isPending ? 'Checking the feed…' : ok ? 'Feed is answering' : 'Feed isn’t answering'}
        </span>
        {h && <span className="ml-auto text-xs text-atc-muted">{h.region ?? ''}</span>}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
        <KV k="Answering now" v={h?.provider ?? '—'} />
        <KV k="Response time" v={h ? `${h.latencyMs} ms` : '—'} />
        <KV k={`Aircraft near ${airportIcao}`} v={h ? String(h.aircraft) : '—'} />
        <KV k="This session" v={liveStatus === 'ok' ? `live via ${liveProvider ?? 'feed'}` : liveStatus} />
        <KV k="Last update" v={liveUpdatedAt ? new Date(liveUpdatedAt).toLocaleTimeString() : '—'} />
        <KV k="Served from" v={h?.runtime ?? '—'} />
      </dl>
      {h?.error && <p className="mt-2 break-words text-xs text-atc-live">{h.error}</p>}
      <p className="mt-3 text-[11px] text-atc-muted">
        Traffic comes from free community ADS-B feeds, tried in this order: adsb.lol, adsb.fi, OpenSky. Answers are shared
        at the edge for a few seconds. No accounts or API keys are used.
      </p>
    </div>
  )
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-atc-muted">{k}</dt>
      <dd className="truncate font-medium tabular-nums">{v}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

const selectCls =
  'rounded-lg bg-white/10 px-2.5 py-1.5 text-sm outline-none ring-1 ring-white/10 focus:ring-atc-yellow/60 max-w-[14rem]'
const buttonCls = 'rounded-xl bg-white/10 px-3 py-1.5 text-sm font-semibold transition hover:bg-white/20 active:scale-95'
