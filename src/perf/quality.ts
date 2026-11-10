/**
 * Rendering quality tiers and the governor that picks one from how fast
 * frames actually come on this machine.
 *
 * The map's per-frame cost is mostly fixed by the screen (a 1920 px retina
 * window is four times the pixels of a laptop's) and by how many effects
 * redraw it. Rather than guess from the hardware, the governor watches the
 * real frame interval (requestAnimationFrame deltas over two-second windows)
 * and steps the expensive things down when frames are consistently slow,
 * and back up when there is headroom again. People can also pin a tier in
 * Settings (Smooth / Balanced / Beautiful).
 *
 * Everything here is pure, so it can be tested without a browser; the
 * runtime wiring is in `governor.ts`.
 */

export type QualityTier = 'smooth' | 'balanced' | 'beautiful'
/** The Settings choice: let the governor decide, or hold a tier. */
export type PerformanceMode = 'auto' | QualityTier

export const TIERS: QualityTier[] = ['smooth', 'balanced', 'beautiful']

/** What each tier allows. The aircraft layer, atmosphere and glass read these. */
export type QualityProfile = {
  /**
   * Aircraft data is re-sent to the map only once something on screen has
   * moved at least this far (screen pixels). Half a pixel is below what the
   * eye can follow on a moving icon (the artwork is drawn filtered, at
   * sub-pixel positions); a whole pixel is still smooth at map speeds.
   */
  motionPx: number
  /** Minimum time between aircraft updates driven by motion alone (ms). Discrete changes (a selection, a tag) go at once. */
  minSendMs: number
  /** Ceiling on the map canvas's pixel ratio. A retina desktop at 2 fills four times the pixels of 1. */
  maxPixelRatio: number
  /** Contrails behind high cruising traffic. */
  contrails: boolean
  /** Rain, snow and wind-line particle density (0..1 of the full count). */
  particles: number
  /** Redraws per second for the weather canvas overlay. */
  overlayFps: number
  /** The water sheen animates (each step re-uploads a pattern texture and repaints the map). */
  waterSheen: boolean
  /** The most frosted glass allowed (the glass module may choose less on its own). */
  glass: 'full' | 'lite' | 'off'
}

export const PROFILES: Record<QualityTier, QualityProfile> = {
  beautiful: { motionPx: 0.5, minSendMs: 0, maxPixelRatio: 2, contrails: true, particles: 1, overlayFps: 30, waterSheen: true, glass: 'full' },
  balanced: { motionPx: 0.75, minSendMs: 30, maxPixelRatio: 1.5, contrails: true, particles: 0.6, overlayFps: 24, waterSheen: true, glass: 'lite' },
  smooth: { motionPx: 1, minSendMs: 50, maxPixelRatio: 1, contrails: false, particles: 0.35, overlayFps: 15, waterSheen: false, glass: 'off' },
}

export function profileFor(tier: QualityTier): QualityProfile {
  return PROFILES[tier]
}

/** The map canvas pixel ratio for a screen of `dpr` at `tier`: never above the screen's own, never below 1. */
export function mapPixelRatio(dpr: number, tier: QualityTier): number {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
  return Math.max(Math.min(1, d), Math.min(d, PROFILES[tier].maxPixelRatio))
}

export function stepDown(tier: QualityTier): QualityTier {
  return TIERS[Math.max(0, TIERS.indexOf(tier) - 1)]
}

export function stepUp(tier: QualityTier): QualityTier {
  return TIERS[Math.min(TIERS.length - 1, TIERS.indexOf(tier) + 1)]
}

/** Where `auto` starts before any frame has been measured. Weak hardware starts in the middle rather than proving itself slow first. */
export function startingTier(s: { cores?: number | null; memoryGb?: number | null; saveData?: boolean }): QualityTier {
  if (s.saveData) return 'balanced'
  if (s.cores != null && s.cores > 0 && s.cores < 4) return 'balanced'
  if (s.memoryGb != null && s.memoryGb > 0 && s.memoryGb < 4) return 'balanced'
  return 'beautiful'
}

// ---------------------------------------------------------------------------
// Governor
// ---------------------------------------------------------------------------

export type GovernorOptions = {
  /** Length of one measuring window (ms). */
  windowMs: number
  /** A window needs at least this many frames to count. */
  minFrames: number
  /** Frames slower than this (ms, about 40 fps) are slow, if also well behind the display's own rate. */
  slowMs: number
  /** Frames this much slower than the display's refresh interval are slow (so a 30 Hz screen isn't punished for being 30 Hz). */
  slowFactor: number
  /** Windows with a median quicker than this leave headroom (ms, about 55 fps). */
  fastMs: number
  /** Slow windows in a row before stepping down. */
  downAfter: number
  /** Fast windows in a row before trying a step up. */
  upAfter: number
  /** After a step up that had to be undone, wait this long (ms) before trying again; doubles each time. */
  backoffMs: number
  backoffMaxMs: number
  /** A step down within this long (ms) of a step up counts as that step up failing. */
  failWithinMs: number
}

export const GOVERNOR_DEFAULTS: GovernorOptions = {
  windowMs: 2000,
  minFrames: 12,
  slowMs: 25,
  slowFactor: 1.5,
  fastMs: 18,
  downAfter: 2,
  upAfter: 4,
  backoffMs: 30_000,
  backoffMaxMs: 8 * 60_000,
  failWithinMs: 20_000,
}

/** Median of frame intervals, leaving out stalls (tab switches, GC pauses) that say nothing about steady cost. */
export function windowMedian(samples: number[]): number | null {
  const xs = samples.filter((x) => x > 0 && x < 250).sort((a, b) => a - b)
  if (!xs.length) return null
  const mid = xs.length >> 1
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
}

/**
 * Feed it every frame's interval; it answers with the tier to use. Steps
 * down after a few consistently slow windows, up after a longer run of
 * quick ones, and backs off from tiers that proved too much for the
 * machine, so it settles instead of see-sawing.
 */
export class QualityGovernor {
  private readonly o: GovernorOptions
  private tierNow: QualityTier
  private ceiling: QualityTier
  private samples: number[] = []
  private windowStart = -1
  private slowRun = 0
  private fastRun = 0
  /** Quickest window median seen: the display's own refresh interval, near enough. */
  private refreshMs = Infinity
  private lastUpAt = -Infinity
  private holdUntil = -Infinity
  private backoff: number
  /** Most recent window median (ms), for display. */
  lastMedian: number | null = null

  constructor(start: QualityTier, options: Partial<GovernorOptions> = {}, ceiling: QualityTier = 'beautiful') {
    this.o = { ...GOVERNOR_DEFAULTS, ...options }
    this.ceiling = ceiling
    this.tierNow = TIERS.indexOf(start) > TIERS.indexOf(ceiling) ? ceiling : start
    this.backoff = this.o.backoffMs
  }

  get tier(): QualityTier {
    return this.tierNow
  }

  /** Forget the current window (after the tab was hidden, say): the gap says nothing about rendering. */
  reset() {
    this.samples = []
    this.windowStart = -1
  }

  /** One frame took `dtMs`; it ended at `now` (ms). Returns the tier to use from now on. */
  frame(dtMs: number, now: number): QualityTier {
    if (this.windowStart < 0) this.windowStart = now
    this.samples.push(dtMs)
    if (now - this.windowStart < this.o.windowMs) return this.tierNow
    const enough = this.samples.filter((x) => x > 0 && x < 250).length >= this.o.minFrames
    const median = enough ? windowMedian(this.samples) : null
    this.samples = []
    this.windowStart = now
    if (median == null) return this.tierNow
    this.lastMedian = median
    this.refreshMs = Math.min(this.refreshMs, median)
    const slow = median > this.o.slowMs && median > this.refreshMs * this.o.slowFactor
    const fast = median < this.o.fastMs
    this.slowRun = slow ? this.slowRun + 1 : 0
    this.fastRun = fast ? this.fastRun + 1 : 0

    if (this.slowRun >= this.o.downAfter && this.tierNow !== 'smooth') {
      // Undoing a recent step up: that tier is too much here; wait longer before the next try.
      if (now - this.lastUpAt < this.o.failWithinMs) {
        this.holdUntil = now + this.backoff
        this.backoff = Math.min(this.o.backoffMaxMs, this.backoff * 2)
      }
      this.tierNow = stepDown(this.tierNow)
      this.slowRun = 0
      this.fastRun = 0
    } else if (this.fastRun >= this.o.upAfter && this.tierNow !== this.ceiling && now >= this.holdUntil) {
      this.tierNow = stepUp(this.tierNow)
      this.lastUpAt = now
      this.fastRun = 0
      this.slowRun = 0
    }
    return this.tierNow
  }
}
