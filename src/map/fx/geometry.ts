/**
 * Where things sit on each aircraft drawing: wingtips (navigation lights and
 * strobes), the tail cone, the beacon on the fuselage, the nose (landing
 * lights), the engines (exhaust) and the fin (airline colour).
 *
 * Everything is in the drawings' own metres (nose toward -y, centred on the
 * bounding box, see `src/aircraft/outlines.ts`), read from the outlines where
 * the outline says it (the wingtip is the widest point of the half outline)
 * and from a small hand-measured table where it doesn't (engine positions).
 * `toIconPx` turns metres into pixels of the 48 px icon box the map draws, so
 * effect sprites line up with the artwork at every zoom and heading.
 */
import { OUTLINES } from '../../aircraft/outlines'
import { parsePoints, type ShapeId } from '../../aircraft/shapes'

/** Must match `mapImages.ts`: the icon box and the share of it the longer side fills. */
export const BOX = 48
export const FILL = 0.78

type Pt = [number, number]

export type Anchors = {
  maxDim: number
  /** Right wingtip (mirror x for the left one). */
  wingtip: Pt
  /** Tail cone, on the centreline. */
  tail: Pt
  /** Anti-collision beacon on top of the fuselage. */
  beacon: Pt
  nose: Pt
  /** Half the fuselage width, for sizing the fin colour. */
  bodyHalfWidth: number
  /** Right-side engine exhausts: `[x, yFront, yExit]` per engine (mirrored for the left). */
  engines: [number, number, number][]
  /** Fin colour patch: from `y0` (root) to `y1` (tail), half-width `w0` → `w1`. Null when the class has no airline livery. */
  fin: { y0: number; y1: number; w0: number; w1: number } | null
  /** Whether the class carries aircraft lights at all (not vehicles or dots). */
  lit: boolean
}

/**
 * Engines, measured off the outlines (right side, metres): nacelle centre x,
 * intake y and exhaust y. Propeller aircraft and helicopters aren't listed:
 * their exhaust isn't worth drawing.
 */
const ENGINES: Partial<Record<ShapeId, [number, number, number][]>> = {
  'ac-jet': [[5.0, -3.4, -0.5]],
  'ac-ejet': [[3.6, -2.2, -0.1]],
  'ac-heavy': [[8.8, -10.2, -5.3]],
  'ac-quad': [
    [9.6, -10.5, -5.4],
    [20.0, -2.4, 1.0],
  ],
  'ac-turboprop': [[3.8, -5.2, 1.7]],
  'ac-regional': [[2.2, 8.2, 12.8]],
  'ac-bizjet': [[2.3, 7.2, 11.7]],
}

/** Classes that wear an airline's colours on the fin. */
const LIVERIED: ShapeId[] = ['ac-jet', 'ac-ejet', 'ac-heavy', 'ac-quad', 'ac-turboprop', 'ac-regional', 'ac-bizjet']

const cache = new Map<ShapeId, Anchors>()

export function anchorsFor(id: ShapeId): Anchors {
  const hit = cache.get(id)
  if (hit) return hit
  const o: { half: string; body?: string; span: number; length: number } = OUTLINES[id]
  const half = parsePoints(o.half)
  const body = o.body ? parsePoints(o.body) : half
  // The widest point; among equals the rearmost, which is where a wingtip light sits.
  let tip: Pt = half[0]
  for (const p of half) if (p[0] > tip[0] + 1e-6 || (Math.abs(p[0] - tip[0]) <= 1e-6 && p[1] > tip[1])) tip = p
  const tailY = half[half.length - 1][1]
  const noseY = half[0][1]
  const length = tailY - noseY
  // Half-width of the fuselage at its widest.
  const bodyHalfWidth = Math.max(...body.map((p) => p[0]))
  const lit = id !== 'ac-vehicle' && id !== 'ac-dot'
  const anchors: Anchors = {
    maxDim: Math.max(o.span, o.length),
    wingtip: tip,
    tail: [0, tailY - 0.01 * length],
    // Just ahead of the wing root, where airliners carry the upper beacon.
    beacon: [0, noseY + 0.42 * length],
    nose: [0, noseY],
    bodyHalfWidth,
    engines: ENGINES[id] ?? [],
    // The fin seen from above, and the top of the fuselage under it.
    fin: LIVERIED.includes(id) ? { y0: tailY - 0.2 * length, y1: tailY - 0.015 * length, w0: bodyHalfWidth * 0.62, w1: bodyHalfWidth * 0.3 } : null,
    lit,
  }
  cache.set(id, anchors)
  return anchors
}

/** Pixels of the 48 px icon box per metre of this drawing. */
export function pxPerMetre(a: Anchors): number {
  return (BOX * FILL) / a.maxDim
}

/** A point in metres as an offset from the icon's centre, in icon-box pixels. */
export function toIconPx(a: Anchors, p: Pt): Pt {
  const k = pxPerMetre(a)
  return [p[0] * k, p[1] * k]
}

/** Bank angle drawn for the slight and the steep banked artwork (degrees). */
export const BANK_DRAWN = { 1: 11, 2: 23 } as const

/**
 * How much each wing's span shrinks in a drawing banked `deg` degrees seen
 * from above: both foreshorten, and the lower wing (farther from the eye)
 * a little more, which is what makes the drawing read as leaning.
 */
export function bankSpanScale(deg: number): { low: number; high: number } {
  const r = (Math.abs(deg) * Math.PI) / 180
  return { low: Math.cos(r) * (1 - 0.38 * Math.sin(r)), high: Math.cos(r) * (1 + 0.16 * Math.sin(r)) }
}

/** Parse a bank tag (`bR2`) into a signed bank angle in degrees (positive: right wing down). */
export function bankDegrees(tag: string | null | undefined): number {
  const m = tag ? /^b([LR])([12])$/.exec(tag) : null
  if (!m) return 0
  return BANK_DRAWN[Number(m[2]) as 1 | 2] * (m[1] === 'R' ? 1 : -1)
}
