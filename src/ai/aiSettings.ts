/**
 * The AI choices a visitor has, remembered in this browser: the features on
 * or off, and which model (Haiku or Sonnet) and provider answer this device.
 * The model and provider are sent with each request (src/ai/client.ts); the
 * server accepts only the allowed values and otherwise uses the site's
 * defaults (`AI_MODEL`, `AI_PROVIDER`). Unset (null) means "the site's default".
 *
 * The keys are the site owner's and live in Cloudflare (see
 * docs/ai-setup.md); the browser never has a key. Earlier versions let a key
 * be typed into Settings and kept it in localStorage: `scrubStoredAiKeys`
 * deletes any such key the first time this version loads.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { allowedModel, allowedProvider, type AiProviderChoice, type ClaudeModelId } from '../api/ai/models'

export type AiSettings = {
  /** Master switch for every AI feature on this device. */
  enabled: boolean
  /** The model for this device; null: the site's default. */
  model: ClaudeModelId | null
  /** The provider for this device (it matters only when both keys are set); null: the site's default. */
  provider: AiProviderChoice | null
}

export const DEFAULT_AI_SETTINGS: AiSettings = { enabled: true, model: null, provider: null }

export const AI_STORAGE_KEY = 'atc-web.ai.v1'
const VERSION = 3

/** What is kept of a saved state: only values this version understands. */
function clean(state: unknown, version: number): AiSettings {
  const s = (state && typeof state === 'object' ? state : {}) as Record<string, unknown>
  // Before version 3, `provider` and `model` belonged to the old browser-key settings (Opus included): not carried over.
  const current = version >= VERSION
  return {
    enabled: s.enabled !== false,
    model: current ? allowedModel(typeof s.model === 'string' ? s.model : null) : null,
    provider: current ? allowedProvider(typeof s.provider === 'string' ? s.provider : null) : null,
  }
}

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
    const saved = JSON.parse(raw) as { state?: Record<string, unknown>; version?: number } | null
    const state = saved?.state ?? {}
    const keys = ['anthropicKey', 'openrouterKey'].some((k) => k in state)
    // The provider / model an old version saved went with its keys; this version's own are kept.
    const oldChoice = (saved?.version ?? 0) < VERSION && ['provider', 'model'].some((k) => k in state)
    if (!keys && !oldChoice) return false
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
      migrate: (saved, version) => clean(saved, version),
      // A stale or hand-edited entry cannot bring in a model the site does not offer.
      merge: (saved, current) => ({ ...current, ...clean(saved, VERSION) }),
      partialize: (s) => ({ enabled: s.enabled, model: s.model, provider: s.provider }),
    },
  ),
)
