/**
 * Camera micro-drift: when the automatic camera has nothing to do, the map
 * wanders a few metres a second and breathes its zoom by a few hundredths,
 * like a broadcast camera on a long lens, so the picture never looks frozen.
 *
 * The path is a slow Lissajous figure around where the drift began, so it
 * never strays more than a short walk from the airfield however long the
 * screen is left alone, and it starts from rest (position and speed both
 * ease in from zero), so the first frames are indistinguishable from still.
 */

/** Quiet time (no input, no camera move) before the drift begins. */
export const IDLE_MS = 8000
/** Furthest the drift wanders from where it began, in metres. */
export const DRIFT_RADIUS_M = 50
/** Zoom breathes this far either side of where it began. */
export const ZOOM_BREATHE = 0.05
/** Periods of the east-west and north-south swings, and of the zoom breath. */
const PERIOD_E_MS = 110_000
const PERIOD_N_MS = 151_000
const PERIOD_Z_MS = 47_000
/** The drift fades in over this long. */
const RAMP_MS = 9000

/**
 * Zooms where something on the map switches on or off (label and data-block
 * thresholds in `AircraftLayer`): breathing across one would make tags blink.
 */
const ZOOM_EDGES = [9.3, 12.4, 13.4, 15.2]

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

/**
 * Offset from the drift's starting point `t` ms after it began: metres east
 * and north, and a zoom delta. `baseZoom` keeps the breath clear of zoom
 * levels where labels appear or disappear.
 */
export function driftAt(t: number, baseZoom: number): { east: number; north: number; zoom: number } {
  if (t <= 0) return { east: 0, north: 0, zoom: 0 }
  const ramp = smooth(t / RAMP_MS)
  const tau = 2 * Math.PI
  const east = DRIFT_RADIUS_M * ramp * Math.sin((tau * t) / PERIOD_E_MS)
  const north = DRIFT_RADIUS_M * 0.75 * ramp * Math.sin((tau * t) / PERIOD_N_MS)
  const clear = ZOOM_EDGES.every((z) => Math.abs(z - baseZoom) > ZOOM_BREATHE + 0.02)
  const zoom = clear ? ZOOM_BREATHE * ramp * Math.sin((tau * t) / PERIOD_Z_MS) : 0
  return { east, north, zoom }
}
