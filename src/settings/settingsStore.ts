/**
 * User preferences, persisted to `localStorage` (Zustand `persist`).
 *
 * Keep this store free of transient UI state — anything here survives
 * reloads and is editable from the Settings panel.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_AIRPORT } from '../api/airports'

export type AltitudeUnit = 'ft' | 'm'
export type SpeedUnit = 'kt' | 'kmh' | 'mph'
export type LabelMode = 'auto' | 'always' | 'never'
export type MapTheme = 'navy' | 'graphite' | 'satellite' | 'chart'
/** Map lighting: follow the sun at the airport, or hold day or night. */
export type LightingMode = 'auto' | 'day' | 'night'

export type Settings = {
  /** Airport shown on launch. */
  defaultAirport: string
  /** Live traffic poll interval in seconds. */
  pollSeconds: 5 | 8 | 15
  altitudeUnit: AltitudeUnit
  speedUnit: SpeedUnit
  /** When callsign labels appear on the map. */
  labels: LabelMode
  /** Hide aircraft reported on the ground (ramp clutter). */
  hideGround: boolean
  /** Number of trail points kept for the selected aircraft. */
  trailLength: 24 | 48 | 96
  /** Disable pulse/camera easing for motion-sensitive users. */
  reduceMotion: boolean
  mapTheme: MapTheme
  /** Day/night look and airfield lights. */
  lighting: LightingMode
  /** Second label line with altitude, trend and type, like a controller's data block. */
  dataBlocks: boolean
  /** Faint wake behind every airborne aircraft. */
  trails: boolean
  /** Drop shadows that grow with height above the field. */
  shadows: boolean
  /** Dashed extended centrelines with mile ticks. */
  approachPaths: boolean
  /** Precipitation radar overlay (US). */
  weatherRadar: boolean
  /** Let the camera move to whoever is in the news unless the user takes over. */
  autoCamera: boolean
  /** Pinned airports, shown first in the picker. */
  favourites: string[]
  /** Most recently opened airports, newest first. */
  recents: string[]
  /** The "tap a plane" hint has been dismissed. */
  hintSeen: boolean
}

type SettingsState = Settings & {
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  /** Pin or unpin an airport. */
  toggleFavourite: (icao: string) => void
  /** Record that an airport was opened (keeps the five most recent). */
  noteRecent: (icao: string) => void
  reset: () => void
}

export const DEFAULT_SETTINGS: Settings = {
  defaultAirport: DEFAULT_AIRPORT,
  pollSeconds: 8,
  altitudeUnit: 'ft',
  speedUnit: 'kt',
  labels: 'auto',
  hideGround: false,
  trailLength: 48,
  reduceMotion: false,
  mapTheme: 'navy',
  lighting: 'auto',
  dataBlocks: true,
  trails: true,
  shadows: true,
  approachPaths: true,
  weatherRadar: false,
  autoCamera: true,
  favourites: [],
  recents: [],
  hintSeen: false,
}

export const SETTINGS_STORAGE_KEY = 'atc-web.settings.v1'

/**
 * Settings read back from storage, keeping only keys this version knows and
 * values of the right kind. Options that were removed (or stored by a newer
 * or older build) are dropped quietly instead of leaking into the store.
 */
export function restoreSettings(stored: unknown): Partial<Settings> {
  if (!stored || typeof stored !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(stored)) {
    if (!(k in DEFAULT_SETTINGS)) continue
    const def = DEFAULT_SETTINGS[k as keyof Settings]
    if (Array.isArray(def) ? Array.isArray(v) : typeof v === typeof def) out[k] = v
  }
  return out as Partial<Settings>
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      update: (key, value) => set({ [key]: value } as Partial<Settings>),
      toggleFavourite: (icao) =>
        set((s) => ({ favourites: s.favourites.includes(icao) ? s.favourites.filter((c) => c !== icao) : [...s.favourites, icao] })),
      noteRecent: (icao) => set((s) => ({ recents: [icao, ...s.recents.filter((c) => c !== icao)].slice(0, 5) })),
      // Pins and history are the user's data, not preferences: a reset keeps them.
      reset: () => set((s) => ({ ...DEFAULT_SETTINGS, favourites: s.favourites, recents: s.recents, hintSeen: s.hintSeen })),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      merge: (stored, current) => ({ ...current, ...restoreSettings(stored) }),
      // Only persist the data fields, not the actions.
      partialize: (s) =>
        Object.fromEntries(
          Object.keys(DEFAULT_SETTINGS).map((k) => [k, s[k as keyof Settings]]),
        ) as Settings,
    },
  ),
)

// ---------------------------------------------------------------------------
// Unit formatting helpers (pure; used by FlightSheet and tests)
// ---------------------------------------------------------------------------

export function formatAltitude(ft: number | null | undefined, unit: AltitudeUnit): string {
  if (ft == null) return '—'
  return unit === 'm' ? `${Math.round(ft * 0.3048).toLocaleString()} m` : `${Math.round(ft).toLocaleString()} ft`
}

export function formatSpeed(kt: number | null | undefined, unit: SpeedUnit): string {
  if (kt == null) return '—'
  if (unit === 'kmh') return `${Math.round(kt * 1.852)} km/h`
  if (unit === 'mph') return `${Math.round(kt * 1.15078)} mph`
  return `${Math.round(kt)} kt`
}

export function formatVerticalRate(fpm: number | null | undefined, unit: AltitudeUnit): string {
  if (fpm == null) return '—'
  const sign = fpm > 0 ? '+' : ''
  return unit === 'm'
    ? `${sign}${(fpm * 0.00508).toFixed(1)} m/s`
    : `${sign}${Math.round(fpm).toLocaleString()} fpm`
}
