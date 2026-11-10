/**
 * Which way a gate's stand faces, worked out from the buildings around it:
 * the aircraft parks nose-in to the nearest building face, so the stand runs
 * straight out from that face, and its lead-in line curves away from the bulk
 * of the building toward the open apron.
 */
import { offset, toLocal, type LngLat } from '../geo'

export type StandPose = { nose: LngLat; outBearing: number; turn: 1 | -1 }

/** Gates further than this from any building are remote stands; they get no lead-in. */
export const MAX_FACE_M = 90
/** Gap between the building face and the nose position (about a jet bridge's reach). */
export const NOSE_M = 9

type Ring = [number, number][]

/**
 * Is this bridge outline a jet bridge? OpenStreetMap maps passenger bridges,
 * road bridges and taxiway bridges all as `man_made=bridge`; a jet bridge is
 * the small, narrow one (a few metres wide, tens of metres long).
 */
export function isJetBridge(ring: LngLat[]): boolean {
  if (ring.length < 4) return false
  const pts = ring.map((p) => toLocal(ring[0], p))
  let area = 0
  let perimeter = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[i + 1]
    area += x0 * y1 - x1 * y0
    perimeter += Math.hypot(x1 - x0, y1 - y0)
  }
  area = Math.abs(area) / 2
  // For a long thin shape, twice the area over the perimeter is about its width.
  const width = perimeter ? (2 * area) / perimeter : 0
  return area > 15 && area < 900 && width < 8
}

function inside(p: [number, number], ring: Ring): boolean {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

/**
 * The stand pose for a gate, given the outer rings of nearby buildings (in
 * longitude/latitude), or null when no building face is close enough.
 */
export function standPose(gate: LngLat, buildings: LngLat[][]): StandPose | null {
  let best: { d: number; q: [number, number]; ring: Ring; nx: number; ny: number } | null = null
  for (const lnglat of buildings) {
    if (lnglat.length < 3) continue
    // Work in metres around the gate.
    const ring = lnglat.map((p) => toLocal(gate, p))
    for (let i = 0; i < ring.length - 1; i++) {
      const [ax, ay] = ring[i]
      const [bx, by] = ring[i + 1]
      const ex = bx - ax
      const ey = by - ay
      const len2 = ex * ex + ey * ey
      if (len2 < 1) continue
      const t = Math.max(0, Math.min(1, -(ax * ex + ay * ey) / len2))
      const qx = ax + ex * t
      const qy = ay + ey * t
      const d = Math.hypot(qx, qy)
      if (d > MAX_FACE_M || (best && d >= best.d)) continue
      const l = Math.sqrt(len2)
      best = { d, q: [qx, qy], ring, nx: ey / l, ny: -ex / l }
    }
  }
  if (!best) return null
  // The face normal that points out of the building.
  let { nx, ny } = best
  const probe: [number, number] = [best.q[0] + nx * 2, best.q[1] + ny * 2]
  if (inside(probe, best.ring)) {
    nx = -nx
    ny = -ny
  }
  // The nose stops a jet bridge's length off the face, or at the gate if that is further out.
  const out = Math.max(NOSE_M, (0 - best.q[0]) * nx + (0 - best.q[1]) * ny)
  const noseLocal: [number, number] = [best.q[0] + nx * out, best.q[1] + ny * out]
  const nose = offset(gate, noseLocal[0], noseLocal[1])
  // Bulk of the building, measured along the face (right of the outward direction is +).
  let cx = 0
  let cy = 0
  for (const [x, y] of best.ring) {
    cx += x
    cy += y
  }
  cx /= best.ring.length
  cy /= best.ring.length
  const rx = ny
  const ry = -nx
  const side = (cx - noseLocal[0]) * rx + (cy - noseLocal[1]) * ry
  // Curve away from the bulk, toward the open end of the pier or apron.
  return { nose, outBearing: ((Math.atan2(nx, ny) * 180) / Math.PI + 360) % 360, turn: side > 0 ? -1 : 1 }
}
