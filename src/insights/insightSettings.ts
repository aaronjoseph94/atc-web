/**
 * Choices for the "understand what's happening" features: Learn mode, the
 * airport briefing, smart alerts and "what did I miss". Kept in their own
 * persisted store (not the main settings) so these features stay one
 * self-contained piece; validated on load like the main settings.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AlertKind = 'emergency' | 'goaround' | 'rto' | 'runway' | 'diversion'

export const ALERT_KINDS: { kind: AlertKind; label: string; hint: string }[] = [
  { kind: 'emergency', label: 'Emergencies', hint: '7500, 7600, 7700, mayday and pan-pan' },
  { kind: 'goaround', label: 'Go-arounds', hint: 'Including missed approaches' },
  { kind: 'rto', label: 'Rejected takeoffs', hint: 'A takeoff roll that stops' },
  { kind: 'runway', label: 'Runway changes', hint: 'Traffic turning around to the other end' },
  { kind: 'diversion', label: 'Diversions', hint: 'Heard on the radio' },
]

export type InsightSettings = {
  /** Underline known ATC terms; tap one for an explanation. */
  learn: boolean
  /** Pop the airport briefing up when an airport opens (and every ~20 min). */
  briefing: boolean
  /** Offer a catch-up when coming back after five minutes or more. */
  catchUp: boolean
  alerts: boolean
  alertKinds: AlertKind[]
  /** Also as system notifications while the app is in the background (needs permission). */
  notify: boolean
}

export const DEFAULT_INSIGHT_SETTINGS: InsightSettings = {
  learn: false,
  briefing: true,
  catchUp: true,
  alerts: true,
  alertKinds: ['emergency', 'goaround', 'rto', 'runway', 'diversion'],
  notify: false,
}

export const INSIGHT_STORAGE_KEY = 'atc-web.insights.v1'

export function restoreInsightSettings(stored: unknown): Partial<InsightSettings> {
  if (!stored || typeof stored !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(stored)) {
    if (!(k in DEFAULT_INSIGHT_SETTINGS)) continue
    const def = DEFAULT_INSIGHT_SETTINGS[k as keyof InsightSettings]
    if (Array.isArray(def)) {
      if (Array.isArray(v)) out[k] = v.filter((x) => ALERT_KINDS.some((a) => a.kind === x))
    } else if (typeof v === typeof def) out[k] = v
  }
  return out as Partial<InsightSettings>
}

type State = InsightSettings & {
  update: <K extends keyof InsightSettings>(key: K, value: InsightSettings[K]) => void
  toggleKind: (kind: AlertKind) => void
}

export const useInsightSettings = create<State>()(
  persist(
    (set) => ({
      ...DEFAULT_INSIGHT_SETTINGS,
      update: (key, value) => set({ [key]: value } as Partial<InsightSettings>),
      toggleKind: (kind) => set((s) => ({ alertKinds: s.alertKinds.includes(kind) ? s.alertKinds.filter((k) => k !== kind) : [...s.alertKinds, kind] })),
    }),
    {
      name: INSIGHT_STORAGE_KEY,
      merge: (stored, current) => ({ ...current, ...restoreInsightSettings(stored) }),
      partialize: (s) => Object.fromEntries(Object.keys(DEFAULT_INSIGHT_SETTINGS).map((k) => [k, s[k as keyof InsightSettings]])) as InsightSettings,
    },
  ),
)
