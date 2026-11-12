/**
 * The one AI choice a visitor has: the features on or off, remembered in
 * this browser.
 *
 * The keys, the provider and the model are the site owner's and live in
 * Cloudflare (see docs/ai-setup.md); the browser never has a key. Earlier
 * versions let a key be typed into Settings and kept it in localStorage:
 * `scrubStoredAiKeys` deletes any such key the first time this version loads.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AiSettings = {
  /** Master switch for every AI feature on this device. */
  enabled: boolean
}

export const DEFAULT_AI_SETTINGS: AiSettings = { enabled: true }

export const AI_STORAGE_KEY = 'atc-web.ai.v1'
const VERSION = 2

type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * Remove API keys an earlier version saved in this browser, keeping only the
 * on/off choice. Returns true when something was removed. Runs before the
 * store below reads its saved state, so a key is never loaded into memory.
 */
export function scrubStoredAiKeys(storage: KeyStore | null = typeof localStorage !== 'undefined' ? localStorage : null): boolean {
  if (!storage) return false
  try {
    const raw = storage.getItem(AI_STORAGE_KEY)
    if (!raw) return false
    const saved = JSON.parse(raw) as { state?: Record<string, unknown> } | null
    const state = saved?.state ?? {}
    if (!['anthropicKey', 'openrouterKey', 'provider', 'model'].some((k) => k in state)) return false
    storage.setItem(AI_STORAGE_KEY, JSON.stringify({ state: { enabled: state.enabled !== false }, version: VERSION }))
    return true
  } catch {
    // Unreadable: better gone than left with a key in it.
    try {
      storage.removeItem(AI_STORAGE_KEY)
    } catch {
      // Storage is blocked altogether; nothing is stored, so nothing to remove.
    }
    return true
  }
}

scrubStoredAiKeys()

type AiSettingsState = AiSettings & {
  update: <K extends keyof AiSettings>(key: K, value: AiSettings[K]) => void
}

export const useAiSettings = create<AiSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_AI_SETTINGS,
      update: (key, value) => set({ [key]: value } as Partial<AiSettings>),
    }),
    {
      name: AI_STORAGE_KEY,
      version: VERSION,
      // Whatever an older version saved, only the switch is carried over.
      migrate: (saved) => ({ enabled: (saved as Partial<AiSettings> | null)?.enabled !== false }),
      partialize: (s) => ({ enabled: s.enabled }),
    },
  ),
)
