import type { Aircraft } from '../api/types'

type Sample = { t: number; byId: Map<string, Aircraft> }

/** Hold last two OpenSky snapshots; rAF interpolates without React. */
export class LivePositionBuffer {
  private prev: Sample | null = null
  private next: Sample | null = null

  push(list: Aircraft[], now = performance.now()) {
    this.prev = this.next
    this.next = {
      t: now,
      byId: new Map(list.map((a) => [a.icao24, a])),
    }
  }

  sample(now = performance.now()): Aircraft[] {
    if (!this.next) return []
    if (!this.prev) return [...this.next.byId.values()]

    const span = Math.max(1, this.next.t - this.prev.t)
    // Blend prev→next; hold at next after the poll window (no teleport)
    const blend = Math.min(1, Math.max(0, (now - this.prev.t) / span))

    const ids = new Set([...this.prev.byId.keys(), ...this.next.byId.keys()])
    const out: Aircraft[] = []
    for (const id of ids) {
      const a = this.prev.byId.get(id)
      const b = this.next.byId.get(id)
      if (!b && a) {
        out.push(a)
        continue
      }
      if (!a && b) {
        out.push(b)
        continue
      }
      if (!a || !b) continue
      out.push({
        ...b,
        lat: a.lat + (b.lat - a.lat) * blend,
        lon: a.lon + (b.lon - a.lon) * blend,
        heading: lerpAngle(a.heading, b.heading, blend),
      })
    }
    return out
  }
}

function lerpAngle(a: number, b: number, u: number) {
  const d = ((b - a + 540) % 360) - 180
  return (a + d * u + 360) % 360
}
