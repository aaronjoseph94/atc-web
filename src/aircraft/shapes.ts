/**
 * Aircraft classes as drawable geometry: the outline, the fuselage and any
 * parts that sit on top, as SVG path data in metres (nose toward -y). The map
 * icons and the flight view's illustration are both rendered from these, so
 * they always match.
 */
import { OUTLINES } from './outlines'

export type ShapeId = keyof typeof OUTLINES

export type Shape = {
  id: ShapeId
  /** Width and length of the drawing, metres. */
  span: number
  length: number
  /** Whole silhouette, SVG path data. */
  outline: string
  /** Fuselage on its own (drawn over the wing so it reads as a tube), or null. */
  body: string | null
  /** Parts above the fuselage: T-tails, rear-mounted engines. */
  over: string[]
  /** Main rotor `[x, y, radius]` for helicopters. */
  rotor: [number, number, number] | null
}

type Pt = [number, number]

export function parsePoints(s: string): Pt[] {
  return s
    .trim()
    .split(/\s+/)
    .map((p) => {
      const [x, y] = p.split(',').map(Number)
      return [x, y] as Pt
    })
}

const n = (v: number) => String(Math.round(v * 100) / 100)

function toPath(pts: Pt[]): string {
  return `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}Z`
}

/** Close a right-hand half (nose → tail along x ≥ 0) into the full symmetric outline. */
export function mirrorHalf(half: Pt[]): Pt[] {
  const left = half
    .slice(1, -1)
    .reverse()
    .map(([x, y]) => [-x, y] as Pt)
  return [...half, ...left]
}

/** A right-side part plus its mirror image, as two sub-paths. */
function pair(pts: Pt[]): string {
  return toPath(pts) + toPath(pts.map(([x, y]) => [-x, y] as Pt).reverse())
}

const cache = new Map<ShapeId, Shape>()

export function getShape(id: ShapeId): Shape {
  const hit = cache.get(id)
  if (hit) return hit
  const o: { half: string; body?: string; over?: string[]; rotor?: [number, number, number]; span: number; length: number } = OUTLINES[id]
  const shape: Shape = {
    id,
    span: o.span,
    length: o.length,
    outline: toPath(mirrorHalf(parsePoints(o.half))),
    body: o.body ? toPath(mirrorHalf(parsePoints(o.body))) : null,
    over: (o.over ?? []).map((p) => pair(parsePoints(p))),
    rotor: o.rotor ?? null,
  }
  cache.set(id, shape)
  return shape
}

export const SHAPE_IDS = Object.keys(OUTLINES) as ShapeId[]
