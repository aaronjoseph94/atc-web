/**
 * Session state for the insight features: alerts raised (and their one-line
 * reasons), runway changes seen, the alerts on screen, the catch-up sheet and
 * the briefing card. Reset when the airport changes. Not persisted.
 */
import { create } from 'zustand'
import type { BriefingInput } from '../api/ai/tasks/airportBriefing'
import type { Alert } from './alerts'

export type RunwayChange = { at: number; landing: string[]; departing: string[]; prevLanding: string[]; prevDeparting: string[] }

export type CatchUpWindow = { since: number; until: number; auto: boolean }

type InsightsState = {
  airport: string
  /** Every alert raised this session at this airport, newest first (shown or not). */
  alerts: Alert[]
  /** Alert ids currently on screen as toasts. */
  showing: string[]
  /** Alert id → a short AI-written reason. */
  why: Record<string, string>
  runwayLog: RunwayChange[]
  catchUp: CatchUpWindow | null
  /** The latest briefing's numbers, gathered when the airport opens and every twenty minutes. */
  briefing: BriefingInput | null
  /** The briefing card is up (it hides itself after a while or when dismissed). */
  briefingOpen: boolean

  reset: (airport: string) => void
  setAlerts: (alerts: Alert[]) => void
  show: (id: string) => void
  hide: (id: string) => void
  setWhy: (id: string, why: string) => void
  addRunwayChange: (c: RunwayChange) => void
  openCatchUp: (w: CatchUpWindow) => void
  closeCatchUp: () => void
  setBriefing: (b: BriefingInput, open: boolean) => void
  closeBriefing: () => void
}

/** Toasts on screen at once; more wait until one goes. */
export const MAX_SHOWING = 2

export const useInsights = create<InsightsState>((set) => ({
  airport: '',
  alerts: [],
  showing: [],
  why: {},
  runwayLog: [],
  catchUp: null,
  briefing: null,
  briefingOpen: false,

  reset: (airport) => set({ airport, alerts: [], showing: [], why: {}, runwayLog: [], catchUp: null, briefing: null, briefingOpen: false }),
  setAlerts: (alerts) => set({ alerts: alerts.slice(0, 200) }),
  show: (id) => set((s) => (s.showing.includes(id) ? s : { showing: [id, ...s.showing].slice(0, MAX_SHOWING) })),
  hide: (id) => set((s) => ({ showing: s.showing.filter((x) => x !== id) })),
  setWhy: (id, why) => set((s) => ({ why: { ...s.why, [id]: why } })),
  addRunwayChange: (c) => set((s) => ({ runwayLog: [...s.runwayLog, c].slice(-40) })),
  openCatchUp: (catchUp) => set({ catchUp }),
  closeCatchUp: () => set({ catchUp: null }),
  setBriefing: (briefing, open) => set((s) => ({ briefing, briefingOpen: open || s.briefingOpen })),
  closeBriefing: () => set({ briefingOpen: false }),
}))
