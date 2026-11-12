/**
 * The flat local plane the motion model works in: metres east (x) and north
 * (y) of an origin near the airport. Curves, speeds and distances are plain 2D
 * maths there; positions are converted back to longitude/latitude for drawing.
 */
import { metersPerDegLat, metersPerDegLon, type LngLat } from '../geo'

export type XY = { x: number; y: number }

/** Metres per second in one knot. */
export const MPS_PER_KT = 0.514444

const RAD = Math.PI / 180

/** A local frame around `origin`. Converting there and back is exact; distances are true to well under 1% across the area the app shows. */
export class Frame {
  readonly origin: LngLat
  private readonly kx: number
  private readonly ky: number
  constructor(origin: LngLat) {
    this.origin = origin
    this.kx = metersPerDegLon(origin[1])
    this.ky = metersPerDegLat(origin[1])
  }
  toXY(lon: number, lat: number): XY {
    return { x: (lon - this.origin[0]) * this.kx, y: (lat - this.origin[1]) * this.ky }
  }
  lon(x: number): number {
    return this.origin[0] + x / this.kx
  }
  lat(y: number): number {
    return this.origin[1] + y / this.ky
  }
}

/** Unit vector pointing along a compass heading (degrees clockwise from north). */
export function dirOf(headingDeg: number): XY {
  const r = headingDeg * RAD
  return { x: Math.sin(r), y: Math.cos(r) }
}

/** Compass heading (0–360) of a direction vector. */
export function headingOf(dx: number, dy: number): number {
  return (Math.atan2(dx, dy) / RAD + 360) % 360
}

/** Signed smallest difference `to − from` in degrees (−180..180). */
export function angleDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180
}

export function dist(a: XY, b: XY): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
