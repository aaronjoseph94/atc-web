/**
 * Spotting preferences, kept in this browser under their own key so the
 * feature stays self-contained (a settings reset leaves them alone).
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type SpotSettings = {
  /** A short toast when a rare aircraft comes within range. */
  toasts: boolean
  /** A small star on rare aircraft's map tags. */
  stars: boolean
}

export const DEFAULT_SPOT_SETTINGS: SpotSettings = { toasts: true, stars: true }

type SpotSettingsState = SpotSettings & { update: <K extends keyof SpotSettings>(key: K, value: SpotSettings[K]) => void }

export const useSpotSettings = create<SpotSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SPOT_SETTINGS,
      update: (key, value) => set({ [key]: value } as Partial<SpotSettings>),
    }),
    { name: 'atc-web.spotting.v1', partialize: (s) => ({ toasts: s.toasts, stars: s.stars }) },
  ),
)
