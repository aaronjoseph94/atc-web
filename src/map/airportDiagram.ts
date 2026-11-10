/**
 * Builds the painted surface of an airport from the OurAirports snapshot:
 * runway pavement plus the standard FAA/ICAO precision-runway markings
 * (threshold bars, designators, centreline, aiming points, touchdown-zone
 * bars, side stripes, displaced-threshold arrows) and the extended
 * centrelines aircraft fly down on approach.
 *
 * Dimensions follow FAA AC 150/5340-1 (Standards for Airport Markings).
 * Everything is generated as GeoJSON in real-world metres, so the paint stays
 * crisp and correctly sized at any zoom.
 */
import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson'
import { getRunways, icaoCode, paintedDesignator, type Runway } from '../api/airportData'
import { bearingDeg, distanceM, M_PER_FT, M_PER_NM, offset, toLocal, type LngLat } from './geo'

export type AirportDiagram = {
  /** Runway pavement rectangles (`surface`: `concrete` | `asphalt`). */
  surface: FeatureCollection<Polygon>
  /** Every white paint mark, as polygons (`kind` says which marking). */
  paint: FeatureCollection<Polygon>
  /** Painted numbers and letters, as the centre-lines of their stencil strokes. */
  designators: FeatureCollection<LineString>
  /** One point just outside each runway end, for the sign-style labels. */
  ends: FeatureCollection<Point>
  /** Extended centrelines with a tick every nautical mile. */
  approach: FeatureCollection<LineString>
  /**
   * Candidate blast pads, one per runway end: the paved overrun and its
   * chevrons, plus a point at its outer edge. The data doesn't say which ends
   * really have one, so the map only draws those that fall on airfield ground.
   */
  pads: BlastPad[]
}

export type BlastPad = { ident: string; probe: LngLat; features: Feature<Polygon | LineString>[] }

/** Length of a standard blast pad. */
const PAD_LENGTH_M = 250 * M_PER_FT

const ft = (n: number) => n * M_PER_FT

/** How far the extended centrelines reach. */
export const APPROACH_NM = 8

/** A runway end as a local frame: `s` metres down the runway, `t` metres to the right. */
type End = {
  ident: string
  /** Direction of travel when landing on this end, degrees true. */
  bearing: number
  displacedM: number
  at: (s: number, t: number) => LngLat
}

function frames(r: Runway): { lengthM: number; le: End; he: End; origin: LngLat; ux: number; uy: number } | null {
  const a: LngLat = [r.le.lon, r.le.lat]
  const b: LngLat = [r.he.lon, r.he.lat]
  const [e, n] = toLocal(a, b)
  const lengthM = Math.hypot(e, n)
  if (!(lengthM > 100)) return null
  const ux = e / lengthM
  const uy = n / lengthM
  // (ux, uy) points down the runway from the low end; (uy, -ux) is to its right.
  const make = (origin: LngLat, dx: number, dy: number, ident: string, displacedFt: number | undefined): End => ({
    ident,
    bearing: bearingDeg(origin, offset(origin, dx * 100, dy * 100)),
    displacedM: Math.min(ft(displacedFt ?? 0), lengthM / 3),
    at: (s, t) => offset(origin, dx * s + dy * t, dy * s - dx * t),
  })
  return {
    lengthM,
    origin: a,
    ux,
    uy,
    le: make(a, ux, uy, r.le.ident, r.le.displacedFt),
    he: make(b, -ux, -uy, r.he.ident, r.he.displacedFt),
  }
}

/** A runway's pavement as a rectangle, for deciding which runway keeps its markings at a crossing. */
type Rect = { origin: LngLat; ux: number; uy: number; lengthM: number; half: number }

/** Is `p` on the pavement of `r`, with `margin` metres of slack all round? */
function onPavement(r: Rect, p: LngLat, margin: number): boolean {
  const [x, y] = toLocal(r.origin, p)
  const along = x * r.ux + y * r.uy
  const cross = x * r.uy - y * r.ux
  return along > -margin && along < r.lengthM + margin && Math.abs(cross) < r.half + margin
}

/** Marks that stay painted through a crossing only on the runway that has right of way. */
const THROUGH_ONLY = new Set(['centre', 'edge', 'aim', 'tdz'])

function quad(end: End, s0: number, s1: number, t0: number, t1: number, properties: Record<string, unknown>): Feature<Polygon> {
  const ring = [end.at(s0, t0), end.at(s1, t0), end.at(s1, t1), end.at(s0, t1), end.at(s0, t0)]
  return { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [ring] } }
}

/** Threshold stripes by runway width, per AC 150/5340-1 table 2-1. */
function thresholdStripeCount(widthFt: number): number {
  if (widthFt >= 200) return 16
  if (widthFt >= 150) return 12
  if (widthFt >= 100) return 8
  if (widthFt >= 75) return 6
  return 4
}

/**
 * Stencil numerals and side letters, as strokes on a unit square (x across,
 * y up). Runway numbers are painted in a plain block style: straight strokes
 * with clipped corners, which is what these are.
 */
const GLYPHS: Record<string, [number, number][][]> = {
  '0': [[[0.2, 0], [0.8, 0], [1, 0.18], [1, 0.82], [0.8, 1], [0.2, 1], [0, 0.82], [0, 0.18], [0.2, 0]]],
  '1': [[[0.15, 0.72], [0.55, 1], [0.55, 0]]],
  '2': [[[0, 0.8], [0.2, 1], [0.8, 1], [1, 0.8], [1, 0.58], [0, 0], [1, 0]]],
  '3': [[[0, 0.84], [0.18, 1], [0.82, 1], [1, 0.84], [1, 0.64], [0.84, 0.52], [0.4, 0.52]], [[0.84, 0.52], [1, 0.4], [1, 0.16], [0.82, 0], [0.18, 0], [0, 0.16]]],
  '4': [[[0.74, 0], [0.74, 1], [0, 0.3], [1, 0.3]]],
  '5': [[[1, 1], [0, 1], [0, 0.56], [0.8, 0.56], [1, 0.4], [1, 0.16], [0.82, 0], [0.18, 0], [0, 0.16]]],
  '6': [[[0.9, 1], [0.3, 1], [0, 0.72], [0, 0.16], [0.18, 0], [0.82, 0], [1, 0.16], [1, 0.4], [0.82, 0.56], [0, 0.56]]],
  '7': [[[0, 1], [1, 1], [0.36, 0]]],
  '8': [[[0.18, 0.52], [0, 0.64], [0, 0.84], [0.18, 1], [0.82, 1], [1, 0.84], [1, 0.64], [0.82, 0.52], [0.18, 0.52], [0, 0.4], [0, 0.16], [0.18, 0], [0.82, 0], [1, 0.16], [1, 0.4], [0.82, 0.52]]],
  '9': [[[0.1, 0], [0.7, 0], [1, 0.28], [1, 0.84], [0.82, 1], [0.18, 1], [0, 0.84], [0, 0.6], [0.18, 0.44], [1, 0.44]]],
  L: [[[0, 1], [0, 0], [1, 0]]],
  C: [[[1, 0.82], [0.8, 1], [0.2, 1], [0, 0.82], [0, 0.18], [0.2, 0], [0.8, 0], [1, 0.18]]],
  R: [[[0, 0], [0, 1], [0.78, 1], [1, 0.84], [1, 0.6], [0.78, 0.46], [0, 0.46]], [[0.5, 0.46], [1, 0]]],
}

/**
 * Lay a string of glyphs across the runway, centred on the centreline, with
 * its baseline `s` metres past the threshold and its top further down the
 * runway (so it reads the right way up to a landing pilot).
 */
function stencil(end: End, text: string, s: number, height: number, glyphWidth: number, gap: number, out: Feature<LineString>[]) {
  const total = text.length * glyphWidth + (text.length - 1) * gap
  let x = -total / 2
  for (const ch of text) {
    for (const stroke of GLYPHS[ch] ?? []) {
      out.push({
        type: 'Feature',
        properties: { kind: 'numeral' },
        geometry: { type: 'LineString', coordinates: stroke.map(([gx, gy]) => end.at(s + gy * height, x + gx * glyphWidth)) },
      })
    }
    x += glyphWidth + gap
  }
}

const isConcrete = (surface: string | null | undefined) => /^(con|pem)/i.test(surface ?? '')

/** Everything painted at one end of a runway. Returns where the designator stops. */
function endMarkings(
  end: End,
  lengthM: number,
  widthM: number,
  painted: string,
  paint: Feature<Polygon>[],
  designators: Feature<LineString>[],
): number {
  const d = end.displacedM
  const half = widthM / 2
  // Lateral dimensions are specified for a 150 ft runway; narrower ones scale down.
  const k = Math.min(1, widthM / ft(150))

  if (d > 30) {
    // Displaced threshold: a bar across the runway, with arrows leading up to it.
    paint.push(quad(end, d - ft(10), d, -half + 1, half - 1, { kind: 'threshold-bar' }))
    const count = Math.max(1, Math.floor(d / ft(200)))
    const step = d / (count + 0.5)
    // A row of arrowheads right before the bar, across the whole width.
    const headLen = ft(25)
    const headHalf = ft(11)
    const thick = ft(4)
    const t = d - ft(15)
    for (let c = ft(15); c < half - headHalf; c += ft(30)) {
      for (const x of [c, -c]) {
        paint.push({
          type: 'Feature',
          properties: { kind: 'arrow' },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              end.at(t - headLen, x - headHalf), end.at(t, x), end.at(t - headLen, x + headHalf),
              end.at(t - headLen - thick, x + headHalf), end.at(t - thick, x), end.at(t - headLen - thick, x - headHalf),
              end.at(t - headLen, x - headHalf),
            ]],
          },
        })
      }
    }
    for (let i = 0; i < count; i++) {
      const tip = d - ft(70) - i * step
      const base = tip - ft(45)
      if (base - ft(80) < 0) break
      paint.push({
        type: 'Feature',
        properties: { kind: 'arrow' },
        geometry: {
          type: 'Polygon',
          coordinates: [[end.at(base, -ft(7.5)), end.at(tip, 0), end.at(base, ft(7.5)), end.at(base, -ft(7.5))]],
        },
      })
      paint.push(quad(end, base - ft(80), base, -ft(1.5), ft(1.5), { kind: 'arrow' }))
    }
  }

  // Threshold: a solid bar across the end of the pavement, then the FAA
  // pattern of stripes, 150 ft long, 5.75 ft wide with 5.75 ft spaces, in two
  // groups either side of an 11.5 ft gap on the centreline.
  if (d <= 30) paint.push(quad(end, 0.6, 2.4, -half + 0.6, half - 0.6, { kind: 'threshold-bar' }))
  const s0 = d + 4
  const s1 = s0 + ft(150)
  const stripes = thresholdStripeCount(widthM / M_PER_FT)
  for (let i = 0; i < stripes / 2; i++) {
    const c = ft(8.625 + 11.5 * i)
    const w = ft(5.75) / 2
    paint.push(quad(end, s0, s1, c - w, c + w, { kind: 'threshold' }))
    paint.push(quad(end, s0, s1, -c - w, -c + w, { kind: 'threshold' }))
  }

  // Designator: the side letter nearest the threshold, then the number beyond
  // it, in thin stencil strokes about a third of the runway width tall.
  const m = /^(\d+)([LCR])?$/.exec(painted)
  const number = m?.[1] ?? painted
  const letter = m?.[2]
  let s = s1 + widthM * 0.2
  if (letter) {
    stencil(end, letter, s, widthM * 0.26, widthM * 0.15, 0, designators)
    s += widthM * 0.26 + widthM * 0.12
  }
  stencil(end, number, s, widthM * 0.3, widthM * 0.13, widthM * 0.07, designators)
  const designatorEnd = s + widthM * 0.3 + widthM * 0.22

  // Aiming point: two broad blocks about 1,000 ft in.
  if (lengthM >= ft(4200)) {
    const a0 = d + ft(1020)
    const c = ft(51) * k
    const w = (ft(30) * k) / 2
    paint.push(quad(end, a0, a0 + ft(150), c - w, c + w, { kind: 'aim' }))
    paint.push(quad(end, a0, a0 + ft(150), -c - w, -c + w, { kind: 'aim' }))
  }

  // Touchdown-zone bars in groups of 3, 2, 2, 1, 1 at 500 ft spacing. Groups
  // that would fall within 900 ft of the midpoint are left out, as on real runways.
  if (lengthM >= ft(6000)) {
    const groups: [number, number][] = [
      [500, 3],
      [1500, 2],
      [2000, 2],
      [2500, 1],
      [3000, 1],
    ]
    for (const [distFt, bars] of groups) {
      const g0 = d + ft(distFt)
      if (g0 + ft(75) > lengthM / 2 - ft(900)) break
      for (let b = 0; b < bars; b++) {
        const inner = (ft(36) + b * ft(11)) * k
        const outer = inner + ft(6)
        paint.push(quad(end, g0, g0 + ft(75), inner, outer, { kind: 'tdz' }))
        paint.push(quad(end, g0, g0 + ft(75), -outer, -inner, { kind: 'tdz' }))
      }
    }
  }

  return designatorEnd
}

/** Extended centreline out from one runway end, with nautical-mile ticks. */
function approachPath(end: End, features: Feature<LineString>[]) {
  const far = -APPROACH_NM * M_PER_NM
  features.push({
    type: 'Feature',
    properties: { kind: 'centreline', ident: end.ident },
    geometry: { type: 'LineString', coordinates: [end.at(-200, 0), end.at(far, 0)] },
  })
  for (let nm = 1; nm <= APPROACH_NM; nm++) {
    // Every fifth mile gets a longer tick, like a ruler.
    const half = nm % 5 === 0 ? 260 : 140
    features.push({
      type: 'Feature',
      properties: { kind: 'tick', ident: end.ident, nm },
      geometry: { type: 'LineString', coordinates: [end.at(-nm * M_PER_NM, -half), end.at(-nm * M_PER_NM, half)] },
    })
  }
}

/** The paved pad before a runway end, with chevrons pointing at the runway. */
function blastPad(end: End, widthM: number): BlastPad {
  const half = widthM * 0.72
  const features: Feature<Polygon | LineString>[] = [quad(end, -PAD_LENGTH_M, 0, -half, half, { kind: 'pad' })]
  const depth = half * 0.5
  for (let i = 0; i < 4; i++) {
    const tip = -5 - i * (PAD_LENGTH_M / 4.6)
    features.push({
      type: 'Feature',
      properties: { kind: 'chevron' },
      geometry: { type: 'LineString', coordinates: [end.at(tip - depth, -half * 0.86), end.at(tip, 0), end.at(tip - depth, half * 0.86)] },
    })
  }
  return { ident: end.ident, probe: end.at(-PAD_LENGTH_M, 0), features }
}

const empty = <G extends Polygon | Point | LineString>(): FeatureCollection<G> => ({ type: 'FeatureCollection', features: [] })

/** Diagram with no features, for airports without runway data. */
export function emptyDiagram(): AirportDiagram {
  return { surface: empty(), paint: empty(), designators: empty(), ends: empty(), approach: empty(), pads: [] }
}

/** Build the full painted diagram for a catalog airport (e.g. `ORD`). */
export function buildAirportDiagram(airport: string): AirportDiagram {
  const out = emptyDiagram()
  const icao = icaoCode(airport)

  // Where two runways cross, the longer one keeps its centreline, side stripes
  // and touchdown marks straight through; the shorter one is interrupted.
  const all = getRunways(airport)
    .map((r) => ({ r, f: frames(r) }))
    .filter((x): x is { r: Runway; f: NonNullable<ReturnType<typeof frames>> } => x.f != null)
  const rects = all.map(({ r, f }) => ({ origin: f.origin, ux: f.ux, uy: f.uy, lengthM: f.lengthM, half: ft(r.widthFt ?? 150) / 2 }))
  const rank = all.map(({ r, f }, i) => f.lengthM * 10 + (r.widthFt ?? 0) / 100 - i * 1e-6)

  all.forEach(({ r, f }, idx) => {
    const widthM = ft(r.widthFt ?? 150)
    const half = widthM / 2
    const surface = isConcrete(r.surface) ? 'concrete' : 'asphalt'
    const name = `${paintedDesignator(r.le.ident, icao)}/${paintedDesignator(r.he.ident, icao)}`
    const winners = rects.filter((_, j) => rank[j] > rank[idx])
    const blocked = (p: LngLat, margin = 2) => winners.some((w) => onPavement(w, p, margin))

    out.surface.features.push(quad(f.le, 0, f.lengthM, -half, half, { surface, name }))

    const mine: Feature<Polygon>[] = []

    // Side stripes run the length of the runway along each edge, in
    // pieces that stop short of any runway crossing it.
    const edge = Math.max(1, widthM * 0.022)
    for (const side of [1, -1]) {
      // A crisp line right on the pavement edge, as in the reference.
      const t0 = side * (half - 0.25)
      const t1 = side * (half - 0.25 - edge)
      let runStart: number | null = null
      for (let s = 0; s <= f.lengthM + 1e-6; s += 1) {
        const free = s < f.lengthM && !blocked(f.le.at(s + 0.5, t0), 1.5)
        if (free && runStart == null) runStart = s
        if (!free && runStart != null) {
          if (s - runStart > 4) mine.push(quad(f.le, runStart, s, Math.min(t0, t1), Math.max(t0, t1), { kind: 'edge' }))
          runStart = null
        }
      }
      // The last piece runs to the end of the pavement.
      if (runStart != null && f.lengthM - runStart > 4) mine.push(quad(f.le, runStart, f.lengthM, Math.min(t0, t1), Math.max(t0, t1), { kind: 'edge' }))
    }

    const leEnd = endMarkings(f.le, f.lengthM, widthM, paintedDesignator(r.le.ident, icao), mine, out.designators.features)
    const heEnd = endMarkings(f.he, f.lengthM, widthM, paintedDesignator(r.he.ident, icao), mine, out.designators.features)

    // Centreline: 120 ft stripes with 80 ft gaps between the two designators.
    const from = leEnd
    const to = f.lengthM - heEnd
    const pitch = ft(200)
    const n = Math.floor((to - from + ft(80)) / pitch)
    const start = from + (to - from - (n * pitch - ft(80))) / 2
    const cw = Math.max(0.6, ft(3) / 2)
    for (let i = 0; i < n; i++) {
      const s = start + i * pitch
      mine.push(quad(f.le, s, s + ft(120), -cw, cw, { kind: 'centre' }))
    }

    // Drop the through-marks that would run across a runway with right of way.
    for (const m of mine) {
      if (THROUGH_ONLY.has(String(m.properties?.kind)) && (m.geometry.coordinates[0] as LngLat[]).some((p) => blocked(p))) continue
      out.paint.features.push(m)
    }

    for (const end of [f.le, f.he]) {
      const painted = paintedDesignator(end.ident, icao)
      out.ends.features.push({
        type: 'Feature',
        properties: { ident: painted, bearing: end.bearing },
        geometry: { type: 'Point', coordinates: end.at(-Math.max(90, widthM * 1.6), 0) },
      })
      approachPath(end, out.approach.features)
      out.pads.push(blastPad(end, widthM))
    }
  })
  return out
}

// ---------------------------------------------------------------------------
// Runway geometry queries (used to work out which runway an aircraft is using)
// ---------------------------------------------------------------------------

export type RunwayEndGeometry = {
  /** Designator as painted (`28R`, `4L`, `05`). */
  ident: string
  /** Landing threshold position. */
  threshold: LngLat
  /** Direction of travel when landing or departing on this end. */
  bearing: number
  lengthM: number
  widthM: number
}

/** Both ends of every runway at an airport, as simple geometry records. */
export function runwayEnds(airport: string): RunwayEndGeometry[] {
  const icao = icaoCode(airport)
  const out: RunwayEndGeometry[] = []
  for (const r of getRunways(airport)) {
    const f = frames(r)
    if (!f) continue
    const widthM = ft(r.widthFt ?? 150)
    for (const end of [f.le, f.he]) {
      out.push({
        ident: paintedDesignator(end.ident, icao),
        threshold: end.at(end.displacedM, 0),
        bearing: end.bearing,
        lengthM: f.lengthM - end.displacedM,
        widthM,
      })
    }
  }
  return out
}

/**
 * Position of `p` relative to a runway end: `along` metres past the threshold
 * in the landing direction (negative = still on approach) and `cross` metres
 * right of the centreline.
 */
export function relativeToRunway(end: RunwayEndGeometry, p: LngLat): { along: number; cross: number } {
  const [e, n] = toLocal(end.threshold, p)
  const b = (end.bearing * Math.PI) / 180
  const sx = Math.sin(b)
  const cx = Math.cos(b)
  return { along: e * sx + n * cx, cross: e * cx - n * sx }
}

/** Runway length implied by the two published end coordinates, in feet. */
export function measuredLengthFt(r: Runway): number {
  return distanceM([r.le.lon, r.le.lat], [r.he.lon, r.he.lat]) / M_PER_FT
}
