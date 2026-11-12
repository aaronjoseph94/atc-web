/**
 * Frosted glass, only where the device can afford it.
 *
 * `backdrop-filter` re-blurs whatever is behind a surface every time that
 * changes, and behind our chrome is a WebGL map that redraws every frame
 * (aircraft glide continuously). The cost grows with the blurred area: the
 * small controls are nearly free, a full-height sheet or the docked side
 * panel is not (measured in software rendering: small chips left the frame
 * time alone, the 400 px side panel doubled it). So there are three tiers:
 *
 *  - `full`: everything is glass, sheets and the side panel included
 *    (`html.glass-on.glass-full`);
 *  - `lite`: the small floating controls, menus and toasts are glass; big
 *    surfaces are solid (`html.glass-on`);
 *  - `off`: all solid (`html.glass-off`), each surface a touch lighter so
 *    nothing loses contrast.
 *
 * The CSS lives in `index.css` (`.glass-chip`, `.glass-pop`, `.glass-sheet`).
 *
 * The decision uses what the browser tells us up front (support, cores,
 * memory, data saver, reduced transparency), a short frame-time probe once
 * the page is running, and a watchdog that turns the blur off for the rest of
 * the session if dragging the map runs slowly with it on.
 *
 * Override for testing: `?glass=on` / `?glass=off` in the URL, or
 * `localStorage['atc.glass']`.
 */

export type GlassTier = 'full' | 'lite' | 'off'

export type GlassSignals = {
  /** `CSS.supports('backdrop-filter', ...)` (or the -webkit- form). */
  supports: boolean
  /** `navigator.hardwareConcurrency`, when known. */
  cores?: number | null
  /** `navigator.deviceMemory` in GB (Chromium only), when known. */
  memoryGb?: number | null
  /** `prefers-reduced-transparency: reduce`. */
  reducedTransparency?: boolean
  /** Data saver / low-power hint. */
  saveData?: boolean
  /** Median frame interval measured while idle, in ms. */
  frameMs?: number | null
  /** Apple hardware: every one of them composites blur natively and cheaply. */
  apple?: boolean
}

/** Idle frames slower than this (under ~45 fps) leave no headroom for blur. */
export const PROBE_SLOW_MS = 22
/** While the map is being dragged, a median frame above this (under ~38 fps) turns the blur off. */
export const WATCHDOG_SLOW_MS = 26

/** Pure decision, so it can be tested without a browser. */
export function chooseGlass(s: GlassSignals): GlassTier {
  if (!s.supports || s.reducedTransparency || s.saveData) return 'off'
  if (s.cores != null && s.cores > 0 && s.cores < 4) return 'off'
  if (s.memoryGb != null && s.memoryGb > 0 && s.memoryGb < 4) return 'off'
  if (s.frameMs != null && s.frameMs > PROBE_SLOW_MS) return 'off'
  // ponytail: big blurred surfaces (sheets, the side panel) cost real frame time over a live map; never on by default.
  return 'lite'
}

/** One step down, for the watchdog. */
export function downgrade(tier: GlassTier): GlassTier {
  return tier === 'full' ? 'lite' : 'off'
}

/** Median of a list of frame intervals (ms); null when there are too few to judge. */
export function medianFrame(samples: number[], min = 12): number | null {
  // Ignore stalls (tab switches, GC pauses): they say nothing about steady-state cost.
  const xs = samples.filter((x) => x > 0 && x < 250).sort((a, b) => a - b)
  if (xs.length < min) return null
  const mid = xs.length >> 1
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
}

// ---------------------------------------------------------------------------
// Colour contrast helpers (WCAG 2), used by the tests to keep the tints honest.
// ---------------------------------------------------------------------------

export type Rgb = [number, number, number]

/** `src` painted at `alpha` over `under`. */
export function over(src: Rgb, alpha: number, under: Rgb): Rgb {
  return [0, 1, 2].map((i) => src[i] * alpha + under[i] * (1 - alpha)) as Rgb
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * The glass tints, mirrored in `index.css`. Each is a colour and opacity laid
 * over the blurred map. Kept here so the tests can check text contrast over
 * the brightest thing the map ever puts behind a panel.
 */
export const GLASS_TINT = {
  /** Small controls floating over the map: buttons, the status pill. */
  chip: { rgb: [22, 29, 42] as Rgb, alpha: 0.66 },
  /** Menus, toasts, popovers. */
  pop: { rgb: [24, 31, 45] as Rgb, alpha: 0.8 },
  /** Sheets and the docked side panel. */
  sheet: { rgb: [14, 19, 28] as Rgb, alpha: 0.86 },
} as const

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'atc.glass'

function parseTier(v: string | null): GlassTier | null {
  if (v === 'on') return 'full'
  return v === 'full' || v === 'lite' || v === 'off' ? v : null
}

function readOverride(): GlassTier | null {
  try {
    return parseTier(new URLSearchParams(location.search).get('glass')) ?? parseTier(localStorage.getItem(STORAGE_KEY))
  } catch {
    // Storage can be blocked; the automatic choice is fine then.
  }
  return null
}

/** A downgrade made by the watchdog sticks for the session (a reload shouldn't flash the blur back). */
function sessionCap(): GlassTier | null {
  try {
    return parseTier(sessionStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

const RANK: Record<GlassTier, number> = { off: 0, lite: 1, full: 2 }
const atMost = (a: GlassTier, cap: GlassTier | null) => (cap && RANK[cap] < RANK[a] ? cap : a)

function staticSignals(): GlassSignals {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
  const supports = typeof CSS !== 'undefined' && (CSS.supports('backdrop-filter', 'blur(2px)') || CSS.supports('-webkit-backdrop-filter', 'blur(2px)'))
  return {
    supports,
    cores: nav.hardwareConcurrency ?? null,
    memoryGb: nav.deviceMemory ?? null,
    reducedTransparency: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-transparency: reduce)').matches,
    saveData: !!nav.connection?.saveData,
    apple: /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent),
  }
}

let current: GlassTier = 'off'
let locked = false
let installed = false
/** The most glass the rendering quality tier allows (see src/perf); the choice above is held under it. */
let perfCap: GlassTier = 'full'

function show(tier: GlassTier) {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  el.classList.toggle('glass-on', tier !== 'off')
  el.classList.toggle('glass-full', tier === 'full')
  el.classList.toggle('glass-off', tier === 'off')
  el.dataset.glass = tier
}

function apply(tier: GlassTier) {
  current = tier
  if (installed) show(locked ? tier : atMost(tier, perfCap))
}

/** The glass in use (this module's choice, under the quality tier's cap). */
export function glassTier(): GlassTier {
  return locked ? current : atMost(current, perfCap)
}

/** Hold the glass at or below `cap` (the quality tier's ceiling); lifting the cap restores this module's own choice. */
export function capGlass(cap: GlassTier) {
  if (cap === perfCap) return
  perfCap = cap
  if (installed) show(glassTier())
}

/** Collect `count` frame intervals with requestAnimationFrame. */
function sampleFrames(count: number): Promise<number[]> {
  return new Promise((resolve) => {
    const out: number[] = []
    let last = 0
    const tick = (t: number) => {
      if (last) out.push(t - last)
      last = t
      if (out.length >= count) resolve(out)
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

/**
 * Decide once at startup (synchronously from the static signals, so the first
 * paint is already right), then refine with a frame probe. Safe to call more than once.
 */
export function installGlass() {
  if (installed || typeof document === 'undefined') return
  installed = true
  const forced = readOverride()
  if (forced) {
    locked = true
    apply(forced)
    return
  }
  const base = staticSignals()
  const cap = sessionCap()
  apply(atMost(chooseGlass(base), cap))
  if (current === 'off') return
  // Probe after the first burst of work (map bundle, style, tiles) has settled. It only ever lowers the tier.
  window.setTimeout(() => {
    if (document.hidden) return
    void sampleFrames(40).then((xs) => {
      const tier = atMost(chooseGlass({ ...base, frameMs: medianFrame(xs) }), cap)
      if (RANK[tier] < RANK[current]) apply(tier)
    })
  }, 2500)
}

type MapLike = { on: (type: string, fn: () => void) => unknown; off: (type: string, fn: () => void) => unknown }

/**
 * While the map is being moved, measure frames; if they are slow with blur
 * on, step down a tier for the rest of the session. Returns an unsubscribe.
 */
export function watchMapFrames(map: MapLike): () => void {
  let samples: number[] = []
  let raf = 0
  let last = 0
  const tick = (t: number) => {
    if (last) samples.push(t - last)
    last = t
    if (samples.length >= 45) {
      const m = medianFrame(samples)
      samples = []
      if (m != null && m > WATCHDOG_SLOW_MS && current !== 'off' && !locked) {
        apply(downgrade(current))
        try {
          sessionStorage.setItem(STORAGE_KEY, current)
        } catch {
          // Not remembered across reloads then; harmless.
        }
      }
    }
    raf = requestAnimationFrame(tick)
  }
  const start = () => {
    if (current === 'off' || locked || raf) return
    samples = []
    last = 0
    raf = requestAnimationFrame(tick)
  }
  const stop = () => {
    cancelAnimationFrame(raf)
    raf = 0
  }
  map.on('movestart', start)
  map.on('moveend', stop)
  return () => {
    stop()
    map.off('movestart', start)
    map.off('moveend', stop)
  }
}
