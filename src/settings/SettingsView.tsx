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
import { type ReactNode } from 'react'
import { AIRPORTS } from '../api/airports'
import { getAiStatus, getHealth } from '../api/client'
import { usePlayhead } from '../playback/playheadStore'
import { FullPanel, SectionLabel } from '../ui/Panel'
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, useSettings, type Settings } from './settingsStore'

export function SettingsView() {
  const open = usePlayhead((s) => s.panel === 'settings')
  const setPanel = usePlayhead((s) => s.setPanel)
  const setToast = usePlayhead((s) => s.setToast)
  const settings = useSettings()

  if (!open) return null

  const set = <K extends keyof Settings>(key: K) => (value: Settings[K]) => settings.update(key, value)

  const resetAll = () => {
    settings.reset()
    setToast('Settings restored to defaults')
  }

  const clearCaches = async () => {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
    setToast('Offline caches cleared')
  }

  return (
    <FullPanel
      title="Settings"
      onClose={() => setPanel(null)}
      headerExtra={
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium transition hover:bg-white/20"
          onClick={resetAll}
        >
          <RotateCcw className="size-3.5" /> Reset
        </button>
      }
    >
      <SectionLabel>Startup</SectionLabel>
      <Row label="Default airport" hint="Shown when the app opens">
        <select
          className={selectCls}
          value={settings.defaultAirport}
          onChange={(e) => set('defaultAirport')(e.target.value)}
        >
          {AIRPORTS.map((a) => (
            <option key={a.icao} value={a.icao}>
              {a.icao} — {a.name}
            </option>
          ))}
        </select>
      </Row>

      <SectionLabel>Live traffic</SectionLabel>
      <Row label="Poll interval" hint="How often positions refresh">
        <Segmented
          value={settings.pollSeconds}
          options={[
            [5, '5 s'],
            [8, '8 s'],
            [15, '15 s'],
          ]}
          onChange={set('pollSeconds')}
        />
      </Row>
      <Row label="Hide ground traffic" hint="Only show airborne aircraft">
        <Toggle checked={settings.hideGround} onChange={set('hideGround')} />
      </Row>
      <Row label="Trail length" hint="Points kept behind the selected aircraft">
        <Segmented
          value={settings.trailLength}
          options={[
            [24, 'Short'],
            [48, 'Medium'],
            [96, 'Long'],
          ]}
          onChange={set('trailLength')}
        />
      </Row>

      <SectionLabel>Map</SectionLabel>
      <Row label="Callsign labels" hint="Auto shows labels when zoomed in">
        <Segmented
          value={settings.labels}
          options={[
            ['auto', 'Auto'],
            ['always', 'Always'],
            ['never', 'Never'],
          ]}
          onChange={set('labels')}
        />
      </Row>
      <Row label="Map theme">
        <Segmented
          value={settings.mapTheme}
          options={[
            ['navy', 'Navy'],
            ['graphite', 'Graphite'],
          ]}
          onChange={set('mapTheme')}
        />
      </Row>
      <Row label="Reduce motion" hint="Disable pulse and camera easing">
        <Toggle checked={settings.reduceMotion} onChange={set('reduceMotion')} />
      </Row>

      <SectionLabel>Units</SectionLabel>
      <Row label="Altitude">
        <Segmented
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

      <SectionLabel>Backend</SectionLabel>
      <BackendStatus />

      <SectionLabel>Storage</SectionLabel>
      <Row label="Offline caches" hint="Map tiles and demo clips cached by the service worker">
        <button type="button" className={buttonCls} onClick={() => void clearCaches()}>
          Clear
        </button>
      </Row>
      <p className="mt-4 text-[11px] leading-relaxed text-atc-muted">
        Preferences are stored locally in this browser under <code className="rounded bg-white/10 px-1">{SETTINGS_STORAGE_KEY}</code>.
        Defaults: {DEFAULT_SETTINGS.pollSeconds}s polling, {DEFAULT_SETTINGS.defaultAirport}, feet/knots.
      </p>
    </FullPanel>
  )
}

// ---------------------------------------------------------------------------
// Backend diagnostics
// ---------------------------------------------------------------------------

function AiStatus() {
  const status = useQuery({
    queryKey: ['ai-status'],
    queryFn: getAiStatus,
    staleTime: 60_000,
    retry: 0,
  })
  const s = status.data
  const on = s?.configured

  return (
    <div className="rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
      <div className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${on ? 'bg-atc-purple' : 'bg-atc-yellow'}`} />
        <span className="text-sm font-semibold">
          {status.isPending ? 'Checking…' : on ? 'AI summaries on' : 'Built-in explanations'}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-atc-muted">
        {on
          ? `Tapping a plane asks ${s.model} for a plain-English summary of its latest radio calls.`
          : 'Tapping a plane explains the latest radio call in everyday language using a built-in phrasebook. To use your own Claude or OpenRouter key, set AI_API_KEY on the server (optional AI_BASE_URL and AI_MODEL). OpenRouter: base https://openrouter.ai/api/v1. Claude direct: base https://api.anthropic.com.'}
      </p>
    </div>
  )
}

function BackendStatus() {
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const liveStatus = usePlayhead((s) => s.liveStatus)
  const liveUpdatedAt = usePlayhead((s) => s.liveUpdatedAt)

  const health = useQuery({
    queryKey: ['health', airportIcao],
    queryFn: () => getHealth(airportIcao),
    refetchInterval: 15000,
    retry: 0,
  })

  const h = health.data
  const ok = health.isSuccess && h?.ok

  return (
    <div className="rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
      <div className="flex items-center gap-2">
        <Activity className={`size-4 ${ok ? 'text-emerald-400' : health.isPending ? 'text-atc-muted' : 'text-atc-live'}`} />
        <span className="text-sm font-semibold">
          {health.isPending ? 'Checking edge functions…' : ok ? 'Edge functions healthy' : 'Edge functions unreachable'}
        </span>
        {h && <span className="ml-auto text-xs text-atc-muted">{h.region ?? ''}</span>}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
        <KV k="Traffic provider" v={h?.provider ?? '—'} />
        <KV k="Upstream latency" v={h ? `${h.latencyMs} ms` : '—'} />
        <KV k={`Aircraft near ${airportIcao}`} v={h ? String(h.aircraft) : '—'} />
        <KV k="Client feed" v={liveStatus} />
        <KV k="Last update" v={liveUpdatedAt ? new Date(liveUpdatedAt).toLocaleTimeString() : '—'} />
        <KV k="Runtime" v={h?.runtime ?? '—'} />
      </dl>
      {h?.error && <p className="mt-2 break-words text-xs text-atc-live">{h.error}</p>}
      <p className="mt-3 text-[11px] text-atc-muted">
        Traffic is fetched server-side from free ADS-B feeds (adsb.lol → adsb.fi → OpenSky) and cached at the edge for a few
        seconds. No accounts or API keys are used.
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
const buttonCls = 'rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium transition hover:bg-white/20'

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/5 py-3 last:border-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-atc-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`relative h-7 w-12 rounded-full transition ${checked ? 'bg-atc-yellow' : 'bg-white/15'}`}
      onClick={() => onChange(!checked)}
    >
      <span
        className={`absolute top-1 size-5 rounded-full bg-white shadow transition-[left] ${checked ? 'left-6' : 'left-1'}`}
      />
    </button>
  )
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T
  options: [T, string][]
  onChange: (v: T) => void
}) {
  return (
    <div role="radiogroup" className="flex rounded-lg bg-white/10 p-0.5 text-xs font-medium">
      {options.map(([v, label]) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={v === value}
          className={`rounded-md px-2.5 py-1.5 transition ${v === value ? 'bg-atc-yellow text-black' : 'text-white/75 hover:text-white'}`}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
