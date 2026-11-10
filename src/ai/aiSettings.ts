/**
 * The owner's AI keys and choices, kept in this browser only (localStorage,
 * its own key, separate from the other settings so a settings reset or export
 * never carries keys around). They are sent with each AI request to this
 * site's own `/api/ai`, which uses them for that call and stores nothing.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AiProviderChoice = 'auto' | 'anthropic' | 'openrouter'

export type AiSettings = {
  provider: AiProviderChoice
  /** Claude model id; on OpenRouter the same model under its OpenRouter name. */
  model: string
  anthropicKey: string
  openrouterKey: string
  /** Master switch for every AI feature (on when a key is set). */
  enabled: boolean
}

export const DEFAULT_AI_SETTINGS: AiSettings = { provider: 'auto', model: 'claude-opus-5-5', anthropicKey: '', openrouterKey: '', enabled: true }

export const AI_STORAGE_KEY = 'atc-web.ai.v1'

type AiSettingsState = AiSettings & {
  update: <K extends keyof AiSettings>(key: K, value: AiSettings[K]) => void
  clearKeys: () => void
}

export const useAiSettings = create<AiSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_AI_SETTINGS,
      update: (key, value) => set({ [key]: value } as Partial<AiSettings>),
      clearKeys: () => set({ anthropicKey: '', openrouterKey: '' }),
    }),
    {
      name: AI_STORAGE_KEY,
      partialize: (s) => ({ provider: s.provider, model: s.model, anthropicKey: s.anthropicKey, openrouterKey: s.openrouterKey, enabled: s.enabled }),
    },
  ),
)

/** Headers that carry this device's AI settings to `/api/ai` (names match `AI_HEADERS` on the server). */
export function aiHeaders(s: AiSettings = useAiSettings.getState()): Record<string, string> {
  const h: Record<string, string> = { 'x-atc-ai-provider': s.provider, 'x-atc-ai-model': s.model }
  if (s.anthropicKey.trim()) h['x-atc-anthropic-key'] = s.anthropicKey.trim()
  if (s.openrouterKey.trim()) h['x-atc-openrouter-key'] = s.openrouterKey.trim()
  return h
}
