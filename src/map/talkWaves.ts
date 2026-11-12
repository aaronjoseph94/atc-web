/**
 * The look of an aircraft that is on the radio: a soft halo that breathes
 * round it and a thin ring pinging outwards, in the speaker's colour (pink
 * while the tower talks to it, blue while its pilot talks; see `ui/speaker.ts`).
 *
 * Everything here is plain numbers worked out from the clock, which
 * `AircraftLayer` pushes into circle layers as paint values. Nothing is sent
 * to the map as data, so a pulse costs a few uniform changes per frame.
 *
 * A ring is a circle with a transparent fill and a wide stroke, blurred by
 * the stroke's own width: MapLibre feathers the outside edge and the join
 * between fill and stroke by the same amount, so what is drawn is a soft band
 * with no hard line on either side.
 */

/** One full swell of a ring. Slow on purpose: this should breathe, not blink. */
export const WAVE_PERIOD_MS = 2600
/** Rings on screen at once, evenly spaced through the cycle. */
export const WAVE_COUNT = 3
/** A ring's opacity at its strongest. */
export const WAVE_PEAK = 0.3
/** How much of a ring's outer radius is feathered edge (also its `circle-blur`). */
export const WAVE_SOFTNESS = 0.3
/** The steady glow's opacity at its centre. */
export const GLOW_OPACITY = 0.3
/** The effect fades in over this long when a call starts, and out when it ends. */
export const TALK_FADE_IN_MS = 450
export const TALK_FADE_OUT_MS = 700

export type Ring = {
  /** `circle-radius`: the transparent middle. */
  radius: number
  /** `circle-stroke-width`: the visible band. */
  stroke: number
  /** `circle-stroke-opacity`. */
  opacity: number
  /** `circle-opacity` of the ring's fill (a ring drawn as a disc). */
  fill: number
}

export type TalkWaves = {
  glow: { radius: number; opacity: number }
  rings: Ring[]
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const smooth = (x: number) => {
  const c = clamp(x, 0, 1)
  return c * c * (3 - 2 * c)
}

/** Where the rings start and how far they travel, in pixels, for an aircraft drawn `reachPx` from nose to centre. */
export function waveExtent(reachPx: number): { inner: number; outer: number } {
  // They leave from just inside the wingtips, so they seem to come out of the aircraft, and travel
  // about two aircraft further: big enough to notice on the wide view, never a searchlight close in.
  const inner = clamp(reachPx * 0.8, 12, 54)
  return { inner, outer: inner + clamp(reachPx * 2, 36, 86) }
}

/**
 * A ring's strength through its life (`p` from 0 to 1): it eases in as it
 * clears the aircraft, then ebbs all the way to nothing, so the cycle wraps
 * without a visible join.
 */
export function waveEnvelope(p: number): number {
  if (p <= 0 || p >= 1) return 0
  return smooth(p / 0.24) * (1 - smooth((p - 0.3) / 0.7))
}

/** How far a ring has travelled at `p`: quick off the aircraft, slowing as it spreads. */
export function waveTravel(p: number): number {
  return 1 - (1 - clamp(p, 0, 1)) ** 1.7
}

/** Breathing period of the halo, as in the earlier look the owner preferred (sin(t / 620)). */
export const HALO_BREATH_MS = 620
/** One ping, from the aircraft out to nothing. */
export const PING_PERIOD_MS = 1500

/**
 * The look at time `tMs`, as the app had it before (the owner preferred it):
 * two soft discs in the speaker's colour that breathe gently round the
 * aircraft (`glow` the inner one, the first ring the outer one, drawn as a
 * fill), and a thin ring that pings outwards and fades (the second ring).
 * Sizes follow the aircraft a little, so a heavy isn't swamped and a light
 * aircraft isn't buried. With reduced motion: steady discs, a still ring.
 */
export function talkWaves(tMs: number, reachPx: number, reduceMotion: boolean): TalkWaves {
  const s = clamp(reachPx / 18, 0.85, 1.6)
  const wave = reduceMotion ? 0 : Math.sin(tMs / HALO_BREATH_MS)
  const phase = reduceMotion ? 0.4 : (((tMs % PING_PERIOD_MS) + PING_PERIOD_MS) % PING_PERIOD_MS) / PING_PERIOD_MS
  return {
    glow: { radius: (20 + 2 * wave) * s, opacity: 0.36 + 0.06 * wave },
    rings: [
      { radius: (36 + 5 * wave) * s, stroke: 0, opacity: 0, fill: 0.2 + 0.05 * wave },
      { radius: (12 + 34 * phase) * s, stroke: 2, opacity: reduceMotion ? 0.35 : 0.75 * (1 - phase) ** 1.6, fill: 0 },
      { radius: 0, stroke: 0, opacity: 0, fill: 0 },
    ],
  }
}

/**
 * Fade of the whole effect: up over `TALK_FADE_IN_MS` from `startedAt`, and,
 * once `endedAt` is set, down to nothing over `TALK_FADE_OUT_MS`.
 */
export function talkFade(now: number, startedAt: number, endedAt: number | null): number {
  const up = smooth((now - startedAt) / TALK_FADE_IN_MS)
  if (endedAt == null) return up
  return up * (1 - smooth((now - endedAt) / TALK_FADE_OUT_MS))
}
