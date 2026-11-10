/**
 * The quality tier in use right now, and the wiring that keeps it current.
 *
 * In `auto` (the default) the tier comes from `QualityGovernor`, fed with
 * the real frame interval by the aircraft layer's frame loop (it already
 * runs every frame, so this costs no extra loop). A tier chosen in
 * Settings holds instead. The effective tier is published in a small
 * store: the map reads it once a frame, React only when it changes.
 *
 * Side effects of a tier, applied here: the map canvas's pixel ratio and
 * the ceiling on frosted glass. The aircraft layer, the weather overlay and
 * the water sheen read the profile themselves.
 *
 * Override for testing: `?quality=smooth|balanced|beautiful` in the URL.
 * Browser tests (which draw the map in software at a few frames a second)
 * hold the starting tier, so their screenshots don't depend on timing.
 */
import { create } from 'zustand'
import { capGlass } from '../ui/glass'
import { mapPixelRatio, profileFor, QualityGovernor, startingTier, TIERS, type PerformanceMode, type QualityProfile, type QualityTier } from './quality'

type PerfState = {
  /** What Settings asks for. */
  mode: PerformanceMode
  /** The tier in effect. */
  tier: QualityTier
  /** Latest measured median frame interval (ms), for the diagnostics readout. */
  frameMs: number | null
}

export const usePerf = create<PerfState>(() => ({ mode: 'auto', tier: 'beautiful', frameMs: null }))

function urlTier(): QualityTier | null {
  try {
    const q = new URLSearchParams(location.search).get('quality')
    return q && (TIERS as string[]).includes(q) ? (q as QualityTier) : null
  } catch {
    return null
  }
}

function hardware() {
  if (typeof navigator === 'undefined') return {}
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
  return { cores: nav.hardwareConcurrency ?? null, memoryGb: nav.deviceMemory ?? null, saveData: !!nav.connection?.saveData }
}

const forced = typeof window !== 'undefined' ? urlTier() : null
const frozen = typeof window !== 'undefined' && Reflect.get(window, '__ATC_E2E__') === true
const governor = new QualityGovernor(startingTier(hardware()))

type PixelRatioMap = { setPixelRatio: (r: number) => void; getPixelRatio: () => number }
let map: PixelRatioMap | null = null

function effective(mode: PerformanceMode): QualityTier {
  if (forced) return forced
  return mode === 'auto' ? governor.tier : mode
}

function apply(tier: QualityTier) {
  const s = usePerf.getState()
  if (s.tier !== tier) usePerf.setState({ tier })
  capGlass(profileFor(tier).glass)
  if (map && typeof devicePixelRatio === 'number') {
    const want = mapPixelRatio(devicePixelRatio, tier)
    if (Math.abs(map.getPixelRatio() - want) > 0.01) map.setPixelRatio(want)
  }
}

/** The profile for the tier in effect (cheap; read every frame). */
export function quality(): QualityProfile {
  return profileFor(usePerf.getState().tier)
}

/** Settings changed the performance mode. */
export function setPerformanceMode(want: PerformanceMode) {
  // Anything stored that this build doesn't know means automatic.
  const mode: PerformanceMode = (TIERS as string[]).includes(want) ? want : 'auto'
  if (usePerf.getState().mode !== mode) usePerf.setState({ mode })
  apply(effective(mode))
}

/** The map to keep at the tier's pixel ratio (null when it goes away). */
export function attachPerfMap(m: PixelRatioMap | null) {
  map = m
  if (m) apply(usePerf.getState().tier)
}

let lastShown = 0

/** One frame went by, `dtMs` after the last; called from the map's frame loop. */
export function perfFrame(dtMs: number, now: number) {
  if (frozen || forced) return
  const tier = governor.frame(dtMs, now)
  // The readout in Settings only needs a fresh number every few seconds.
  if (governor.lastMedian != null && now - lastShown > 2000) {
    lastShown = now
    usePerf.setState({ frameMs: Math.round(governor.lastMedian * 10) / 10 })
  }
  const s = usePerf.getState()
  if (s.mode === 'auto' && tier !== s.tier) apply(tier)
}

/** Why aircraft data went to the map, counted, for measuring from the console and browser tests. */
export const sendStats: Record<string, number> = {}

export function noteSend(reason: string) {
  sendStats[reason] = (sendStats[reason] ?? 0) + 1
}

if (typeof window !== 'undefined' && (import.meta.env.DEV || frozen)) Object.assign(window, { __atcPerf: { sendStats, usePerf } })

if (typeof document !== 'undefined') {
  // Time spent hidden says nothing about drawing.
  document.addEventListener('visibilitychange', () => governor.reset())
  apply(effective('auto'))
}
