/**
 * Builds the painted surface of an airport from the runway data: runway
 * pavement plus the standard precision-runway markings (threshold stripes,
 * designators, centreline, aiming points, touchdown-zone bars, side stripes,
 * displaced-threshold arrows) and the extended centrelines aircraft fly down
 * on approach.
 *
 * US runways follow FAA AC 150/5340-1 (Standards for Airport Markings);
 * everywhere else follows ICAO Annex 14, which Canada uses: shorter
 * threshold stripes, smaller numbers, single touchdown bars and a long
 * aiming-point block. Everything is generated as GeoJSON in real-world
 * metres, so the paint stays crisp and correctly sized at any zoom.
 */
import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson'
import { getRunways, icaoCode, paintedDesignator, type Runway } from '../api/airportData'
import { bearingDeg, distanceM, M_PER_FT, M_PER_NM, offset, toLocal, type LngLat } from './geo'

export type AirportDiagram = {
  /** Runway pavement rectangles (`surface`: `concrete` | `asphalt`). */
  surface: FeatureCollection<Polygon>
  /** Every white paint mark, as polygons (`kind` says which marking). */
  paint: FeatureCollection<Polygon>
  /**
   * Painted strokes with a real-world width: the numbers and letters
   * (`kind: 'numeral'`, `w` = stroke width in metres) and the dashed
   * centreline (`kind: 'centre'`), drawn as a hairline. Also each runway's
   * unpainted axis (`kind: 'axis'`, `w` = runway width), used for label placement.
   */
  designators: FeatureCollection<LineString>
  /** One point just outside each runway end, for the sign-style labels. */
  ends: FeatureCollection<Point>
  /** Extended centrelines with a tick every nautical mile. */
  approach: FeatureCollection<LineString>
  /**
   * Candidate blast pads, one per runway end: the paved overrun and its
   * chevrons, plus points along its outer edge. The data doesn't say which
   * ends really have one, so the map only draws those that fall on airfield
   * ground clear of taxiways and water.
   */
  pads: BlastPad[]
}

export type BlastPad = {
  ident: string
  /** Centre of the outer edge. */
  probe: LngLat
  /** Outer corners and centre of the pad: all must be on airfield ground for it to be drawn. */
  probes: LngLat[]
  /** The pad's outline, to test taxiways against. */
  ring: LngLat[]
  features: Feature<Polygon | LineString>[]
}

/** Length of a standard blast pad. */
const PAD_LENGTH_M = 250 * M_PER_FT

const ft = (n: number) => n * M_PER_FT

/** How far the extended centrelines reach. */
export const APPROACH_NM = 8

/** Width of the grey bar painted across each end of the pavement. */
export const END_BAR_M = 3

/** Aiming-point block either side of the centreline: where it starts, its size, and its inner edge. */
type Aim = { start: number; length: number; width: number; inner: number }

/**
 * Dimensions of every marking under one standard, in metres. Lateral sizes
 * are for a full-width runway; narrower runways scale them down.
 */
export type MarkingSpec = {
  name: 'faa' | 'icao'
  /** Threshold stripes: start past the threshold, length, width, pitch, and the gap either side of the centreline. */
  stripeStart: number
  stripeLength: number
  stripeWidth: number
  stripePitch: number
  stripeInner: number
  /** Designator: gap after the stripes, character height, width and spacing, gap between letter and number, stroke. */
  designatorGap: number
  charHeight: number
  charWidth: number
  charGap: number
  letterGap: number
  stroke: number
  /** Centreline dash and gap. */
  dash: number
  dashGap: number
  /** Aiming point for a landing distance available, or nothing. */
  aim: (lda: number, k: number) => Aim | null
  /** Touchdown-zone bars: where each pair starts, how many bars, and their size and inner edge. */
  tdz: (lda: number, aim: Aim | null, k: number) => { at: number; bars: number; length: number; width: number; pitch: number; inner: number }[]
}

/** FAA AC 150/5340-1: the US standard. */
export const FAA: MarkingSpec = {
  name: 'faa',
  stripeStart: ft(20),
  stripeLength: ft(150),
  stripeWidth: ft(5.75),
  stripePitch: ft(11.5),
  stripeInner: ft(5.75),
  designatorGap: ft(30),
  charHeight: ft(60),
  charWidth: ft(20),
  charGap: ft(10),
  letterGap: ft(20),
  stroke: 1.5,
  dash: ft(120),
  dashGap: ft(80),
  aim: (lda, k) => (lda >= ft(4200) ? { start: ft(1020), length: ft(150), width: ft(30) * k, inner: ft(36) * k } : null),
  tdz: (lda, _aim, k) => {
    if (lda < ft(6000)) return []
    const groups: [number, number][] = [
      [500, 3],
      [1500, 2],
      [2000, 2],
      [2500, 1],
      [3000, 1],
    ]
    return groups.map(([at, bars]) => ({ at: ft(at), bars, length: ft(75), width: ft(6), pitch: ft(11) * k, inner: ft(36) * k }))
  },
}

/** ICAO Annex 14 (and Transport Canada TP 312): single touchdown bars, aiming point by landing distance. */
export const ICAO: MarkingSpec = {
  name: 'icao',
  stripeStart: 6,
  stripeLength: 30,
  stripeWidth: 1.8,
  stripePitch: 3.6,
  stripeInner: 1.8,
  designatorGap: 12,
  charHeight: 9,
  charWidth: 3.4,
  charGap: 1.4,
  letterGap: 5,
  stroke: 1.1,
  dash: 30,
  dashGap: 30,
  aim: (lda, k) => {
    // Annex 14 table 5-1, at the generous end of each range.
    if (lda >= 2400) return { start: 400, length: 60, width: 10 * k, inner: 11.25 * k }
    if (lda >= 1200) return { start: 300, length: 45, width: 6 * k, inner: 9 * k }
    if (lda >= 800) return { start: 250, length: 30, width: 6 * k, inner: 4.5 * k }
    return { start: 150, length: 30, width: 4 * k, inner: 3 * k }
  },
  tdz: (lda, aim, k) => {
    // Pairs every 150 m; how many depends on the landing distance.
    const pairs = lda >= 2400 ? 6 : lda >= 1500 ? 4 : lda >= 1200 ? 3 : lda >= 900 ? 2 : 1
    const out = []
    for (let i = 1; i <= pairs; i++) {
      const at = i * 150
      // A pair that would run into the aiming-point block is left out.
      if (aim && at < aim.start + aim.length && at + 22.5 > aim.start) continue
      out.push({ at, bars: 1, length: 22.5, width: 1.8, pitch: 0, inner: aim?.inner ?? 11.25 * k })
    }
    return out
  },
}

/** The marking standard a catalog airport paints to. */
export function markingSpec(icao: string | undefined): MarkingSpec {
  return icao?.startsWith('K') || icao?.startsWith('P') ? FAA : ICAO
}

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

/** Marks that stay painted through a crossing only on the runway that has right of way (an end bar inside another runway is dropped too). */
const THROUGH_ONLY = new Set(['centre', 'edge', 'aim', 'tdz', 'arrow', 'end'])

function quad(end: End, s0: number, s1: number, t0: number, t1: number, properties: Record<string, unknown>): Feature<Polygon> {
  const ring = [end.at(s0, t0), end.at(s1, t0), end.at(s1, t1), end.at(s0, t1), end.at(s0, t0)]
  return { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [ring] } }
}

/** Threshold stripes by runway width: FAA AC 150/5340-1 table 2-1, which matches ICAO's 18/23/30/45/60 m steps. */
export function thresholdStripeCount(widthFt: number): number {
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
function stencil(end: End, text: string, s: number, height: number, glyphWidth: number, gap: number, stroke: number, out: Feature<LineString>[]) {
  // The strokes have width, so the outline of each glyph sits half a stroke inside its box.
  const h = height - stroke
  const w = glyphWidth - stroke
  const total = text.length * glyphWidth + (text.length - 1) * gap
  let x = -total / 2 + stroke / 2
  for (const ch of text) {
    for (const g of GLYPHS[ch] ?? []) {
      out.push({
        type: 'Feature',
        properties: { kind: 'numeral', w: stroke },
        geometry: { type: 'LineString', coordinates: g.map(([gx, gy]) => end.at(s + stroke / 2 + gy * h, x + gx * w)) },
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
  spec: MarkingSpec,
  paint: Feature<Polygon>[],
  strokes: Feature<LineString>[],
): number {
  const d = end.displacedM
  const half = widthM / 2
  // Lateral dimensions are specified for a 150 ft (45 m) runway; narrower ones scale down.
  const k = Math.min(1, widthM / ft(150))

  // A grey bar across the very end of the pavement, edge to edge.
  paint.push(quad(end, 0, END_BAR_M, -half + 0.2, half - 0.2, { kind: 'end' }))

  if (d > 30) {
    // Displaced threshold: a white bar across the runway, with arrows leading up to it.
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
      if (base - ft(80) < END_BAR_M + 2) break
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

  // Threshold stripes in two groups either side of a gap on the centreline.
  const s0 = d + spec.stripeStart
  const s1 = s0 + spec.stripeLength
  const stripes = thresholdStripeCount(widthM / M_PER_FT)
  for (let i = 0; i < stripes / 2; i++) {
    const c = spec.stripeInner + spec.stripeWidth / 2 + spec.stripePitch * i
    const w = spec.stripeWidth / 2
    paint.push(quad(end, s0, s1, c - w, c + w, { kind: 'threshold' }))
    paint.push(quad(end, s0, s1, -c - w, -c + w, { kind: 'threshold' }))
  }

  // Designator: the side letter nearest the threshold, then the number beyond it.
  const m = /^(\d+)([LCR])?$/.exec(painted)
  const number = m?.[1] ?? painted
  const letter = m?.[2]
  const charWidth = spec.charWidth * Math.max(0.6, k)
  let s = s1 + spec.designatorGap
  if (letter) {
    stencil(end, letter, s, spec.charHeight, charWidth, 0, spec.stroke, strokes)
    s += spec.charHeight + spec.letterGap
  }
  stencil(end, number, s, spec.charHeight, charWidth, spec.charGap * Math.max(0.6, k), spec.stroke, strokes)
  const designatorEnd = s + spec.charHeight + spec.designatorGap

  // Aiming point, then the touchdown-zone bars. Bars that would fall within
  // 900 ft of the midpoint are left out, so the two ends never meet.
  const lda = lengthM - d
  const aim = spec.aim(lda, k)
  if (aim && d + aim.start + aim.length < lengthM / 2) {
    const a0 = d + aim.start
    paint.push(quad(end, a0, a0 + aim.length, aim.inner, aim.inner + aim.width, { kind: 'aim' }))
    paint.push(quad(end, a0, a0 + aim.length, -aim.inner - aim.width, -aim.inner, { kind: 'aim' }))
  }
  for (const g of spec.tdz(lda, aim, k)) {
    const g0 = d + g.at
    if (g0 + g.length > lengthM / 2 - ft(900)) break
    for (let b = 0; b < g.bars; b++) {
      const inner = g.inner + b * g.pitch
      const outer = inner + g.width
      if (outer > half - 1) break
      paint.push(quad(end, g0, g0 + g.length, inner, outer, { kind: 'tdz' }))
      paint.push(quad(end, g0, g0 + g.length, -outer, -inner, { kind: 'tdz' }))
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

/** The paved pad before a runway end, with yellow chevrons pointing at the runway. */
function blastPad(end: End, widthM: number): BlastPad {
  // As wide as the runway, as in the reference.
  const half = widthM / 2
  const pad = quad(end, -PAD_LENGTH_M, 0, -half, half, { kind: 'pad' })
  const features: Feature<Polygon | LineString>[] = [pad]
  // Three chevrons at 45°, reaching nearly edge to edge, the first right behind the end bar (as in the reference).
  const span = half * 0.95
  const depth = span
  const count = 3
  const step = Math.max(10, (PAD_LENGTH_M - depth - 5) / (count - 1))
  for (let i = 0; i < count; i++) {
    const tip = -5 - i * step
    features.push({
      type: 'Feature',
      properties: { kind: 'chevron' },
      geometry: { type: 'LineString', coordinates: [end.at(tip - depth, -span), end.at(tip, 0), end.at(tip - depth, span)] },
    })
  }
  const probes = [end.at(-PAD_LENGTH_M, 0), end.at(-PAD_LENGTH_M, -half), end.at(-PAD_LENGTH_M, half)]
  return { ident: end.ident, probe: probes[0], probes, ring: pad.geometry.coordinates[0] as LngLat[], features }
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
  const spec = markingSpec(icao)

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

    out.surface.features.push(quad(f.le, 0, f.lengthM, -half, half, { surface, name, rank: rank[idx] }))

    const mine: Feature<Polygon>[] = []

    // Side stripes run the length of the runway along each edge, between the
    // end bars, in pieces that stop short of any runway crossing it.
    const edge = 0.9
    for (const side of [1, -1]) {
      // A crisp line right on the pavement edge, as in the reference.
      const t0 = side * (half - 0.1)
      const t1 = side * (half - 0.1 - edge)
      let runStart: number | null = null
      const stop = f.lengthM - END_BAR_M
      for (let s = END_BAR_M; s <= stop + 1e-6; s += 1) {
        const free = s < stop && !blocked(f.le.at(s + 0.5, t0), 1.5)
        if (free && runStart == null) runStart = s
        if (!free && runStart != null) {
          if (s - runStart > 4) mine.push(quad(f.le, runStart, s, Math.min(t0, t1), Math.max(t0, t1), { kind: 'edge' }))
          runStart = null
        }
      }
      // The last piece runs to the far end bar.
      if (runStart != null && stop - runStart > 4) mine.push(quad(f.le, runStart, stop, Math.min(t0, t1), Math.max(t0, t1), { kind: 'edge' }))
    }

    const leEnd = endMarkings(f.le, f.lengthM, widthM, paintedDesignator(r.le.ident, icao), spec, mine, out.designators.features)
    const heEnd = endMarkings(f.he, f.lengthM, widthM, paintedDesignator(r.he.ident, icao), spec, mine, out.designators.features)

    // Centreline dashes between the two designators, centred in the gap. They
    // are drawn as a hairline, so they live with the other strokes; a crossing
    // runway with right of way interrupts them.
    const from = leEnd
    const to = f.lengthM - heEnd
    const pitch = spec.dash + spec.dashGap
    const n = Math.floor((to - from + spec.dashGap) / pitch)
    const start = from + (to - from - (n * pitch - spec.dashGap)) / 2
    for (let i = 0; i < n; i++) {
      const s = start + i * pitch
      const a = f.le.at(s, 0)
      const b = f.le.at(s + spec.dash, 0)
      if (blocked(a) || blocked(b)) continue
      out.designators.features.push({ type: 'Feature', properties: { kind: 'centre' }, geometry: { type: 'LineString', coordinates: [a, b] } })
    }

    // The runway's axis, end to end: not painted, but it keeps taxiway letters off the runway.
    out.designators.features.push({ type: 'Feature', properties: { kind: 'axis', w: widthM }, geometry: { type: 'LineString', coordinates: [f.le.at(0, 0), f.le.at(f.lengthM, 0)] } })

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
  // The runway with right of way is drawn last, so its pavement edge stays unbroken at a crossing.
  out.surface.features.sort((a, b) => Number(a.properties?.rank) - Number(b.properties?.rank))
  // Strokes with a real-world width need to know how many pixels a metre is at this latitude.
  const k = all.length ? widthScale(all[0].f.origin[1]) : 1
  for (const f of out.designators.features) f.properties = { ...f.properties, k }
  for (const p of out.pads) for (const f of p.features) f.properties = { ...f.properties, k }
  return out
}

/**
 * The map style converts metres to pixels as if at 40°N (`metres()` in
 * mapStyle). Further north a metre covers more pixels: features carry this
 * factor (`k`) so their widths come out true.
 */
export function widthScale(lat: number): number {
  return Math.cos((40 * Math.PI) / 180) / Math.cos((lat * Math.PI) / 180)
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

// ---------------------------------------------------------------------------
// Markings that depend on the taxiways (worked out from the map tiles)
// ---------------------------------------------------------------------------

/**
 * Distance from runway centreline to the holding position: 280 ft is the FAA
 * figure for the large aircraft these airports see, 90 m the ICAO one for a
 * code 4 instrument runway.
 */
export const HOLD_OFFSET_M = { faa: 280 * M_PER_FT, icao: 90 } as const
/** Half-length of the marking: it spans the taxiway pavement as the map draws it. */
const BAR_HALF_M = 20
/**
 * Centre-to-centre spacing of the four lines of the marking. The real lines
 * are 6 in wide with 6 in gaps; this is a little wider so the dashed pair can
 * still be told from the solid pair on a phone.
 */
export const HOLD_LINE_PITCH_M = 0.7

/** Half the width of taxiway pavement: a centreline this close to a pad means the pavement overlaps it. */
const TAXIWAY_HALF_M = 15

/** Does a taxiway (its centreline, plus half its pavement) run into the blast pad? */
export function crossesPad(path: LngLat[], pad: BlastPad): boolean {
  const [a, b, , d] = pad.ring
  const [ex, ey] = toLocal(a, b)
  const [nx, ny] = toLocal(a, d)
  const len = Math.hypot(ex, ey)
  const wid = Math.hypot(nx, ny)
  if (!len || !wid) return false
  const inside = (p: LngLat, slack: number) => {
    const [x, y] = toLocal(a, p)
    const u = (x * ex + y * ey) / len
    const v = (x * nx + y * ny) / wid
    // On the runway side, a taxiway crossing the first stretch of runway still puts its pavement over the pad.
    return u > -slack && u < len + 2 * slack && v > -slack && v < wid + slack
  }
  for (let i = 0; i < path.length; i++) {
    if (inside(path[i], TAXIWAY_HALF_M)) return true
    if (i === 0) continue
    // Sample the segment so a taxiway that cuts straight across is caught too.
    const [sx, sy] = toLocal(path[i - 1], path[i])
    const steps = Math.ceil(Math.hypot(sx, sy) / 8)
    for (let k = 1; k < steps; k++) if (inside(offset(path[i - 1], (sx * k) / steps, (sy * k) / steps), TAXIWAY_HALF_M)) return true
  }
  return false
}

/** A holding-position marking found so far: which runway and side, how far along, and how squarely its taxiway meets the runway. */
export type HoldBar = { runway: string; side: number; along: number; squareness: number; marks: Feature<LineString>[] }

/**
 * Crossings closer together than this along the same side of a runway are
 * one holding position: the fillets of a junction are separate taxiway lines
 * in the data, and each would otherwise get its own bar.
 */
const HOLD_MERGE_M = 45

/**
 * Find where a taxiway crosses a runway's holding line and add the marking
 * there: two solid lines on the taxiway side, two dashed on the runway side,
 * over a dark band. Where several taxiway lines cross at one junction, only
 * the one that meets the runway most squarely keeps its bar. Returns true if
 * the set changed.
 */
export function holdBars(path: LngLat[], runways: RunwayEndGeometry[], holdOffset: number, bars: HoldBar[]): boolean {
  let changed = false
  for (const rw of runways) {
    const rb = (rw.bearing * Math.PI) / 180
    let prev = relativeToRunway(rw, path[0])
    for (let i = 1; i < path.length; i++) {
      const cur = relativeToRunway(rw, path[i])
      for (const side of [holdOffset, -holdOffset]) {
        const a = prev.cross - side
        const b = cur.cross - side
        if (a * b >= 0) continue
        const u = a / (a - b)
        const along = prev.along + (cur.along - prev.along) * u
        if (along < -40 || along > rw.lengthM + 40) continue

        // Unit vector along the taxiway, pointing toward the runway.
        const [e, n] = toLocal(path[i - 1], path[i])
        const len = Math.hypot(e, n) || 1
        const toward = Math.abs(cur.cross) < Math.abs(prev.cross) ? 1 : -1
        const dx = (e / len) * toward
        const dy = (n / len) * toward
        // 1 when the taxiway meets the runway at a right angle, 0 when it runs alongside.
        const squareness = 1 - Math.abs(dx * Math.sin(rb) + dy * Math.cos(rb))

        // The same crossing turns up again where tiles overlap, and junction fillets nearby.
        const near = bars.findIndex((h) => h.runway === rw.ident && h.side === side && Math.abs(h.along - along) < HOLD_MERGE_M)
        if (near >= 0 && bars[near].squareness >= squareness - 0.02) continue

        const p: LngLat = [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * u, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * u]
        const across = (c: LngLat): [number, number][] => [offset(c, -dy * BAR_HALF_M, dx * BAR_HALF_M), offset(c, dy * BAR_HALF_M, -dx * BAR_HALF_M)]
        const k = widthScale(p[1])
        // The dark band the yellow lines sit on.
        const marks: Feature<LineString>[] = [{ type: 'Feature', properties: { kind: 'band', k }, geometry: { type: 'LineString', coordinates: across(p) } }]
        ;[-1.5, -0.5, 0.5, 1.5].forEach((step, line) => {
          const c = offset(p, dx * step * HOLD_LINE_PITCH_M, dy * step * HOLD_LINE_PITCH_M)
          // The two lines nearer the runway are dashed.
          marks.push({ type: 'Feature', properties: { kind: line >= 2 ? 'dashed' : 'solid', k }, geometry: { type: 'LineString', coordinates: across(c) } })
        })
        const bar = { runway: rw.ident, side, along, squareness, marks }
        if (near >= 0) bars[near] = bar
        else bars.push(bar)
        changed = true
      }
      prev = cur
    }
  }
  return changed
}

// ---------------------------------------------------------------------------
// Wear and stand markings (drawn by the atmosphere layers)
// ---------------------------------------------------------------------------

/** Small seeded random numbers, so each runway's tyre marks look the same on every load. */
function seeded(text: string): () => number {
  let h = 2166136261
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return () => {
    h = (h + 0x6d2b79f5) | 0
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Point `along` metres past an end's threshold and `cross` metres to the right of its centreline. */
function onRunway(end: RunwayEndGeometry, along: number, cross: number): LngLat {
  const b = (end.bearing * Math.PI) / 180
  return offset(end.threshold, along * Math.sin(b) + cross * Math.cos(b), along * Math.cos(b) - cross * Math.sin(b))
}

/**
 * Rubber deposits in each touchdown zone: one broad, faint smudge down the
 * middle and a scatter of darker streaks along the main-gear tracks, densest
 * near the aiming point. Longer runways (the busier ones at most airports)
 * get more and darker marks. Each line carries its width `w` (m), opacity `o`
 * and latitude factor `k`.
 */
export function tyreMarks(airport: string): FeatureCollection<LineString> {
  const ends = runwayEnds(airport)
  const features: Feature<LineString>[] = []
  if (!ends.length) return { type: 'FeatureCollection', features }
  const longest = Math.max(...ends.map((e) => e.lengthM))
  const k = widthScale(ends[0].threshold[1])
  const line = (end: RunwayEndGeometry, a0: number, c0: number, a1: number, c1: number, w: number, o: number) =>
    features.push({ type: 'Feature', properties: { w, o: Math.round(o * 1000) / 1000, k }, geometry: { type: 'LineString', coordinates: [onRunway(end, a0, c0), onRunway(end, a1, c1)] } })
  for (const end of ends) {
    if (end.lengthM < 900) continue
    const rand = seeded(`${airport}:${end.ident}`)
    const busy = 0.55 + 0.45 * (end.lengthM / longest)
    const zoneEnd = Math.min(950, end.lengthM * 0.3)
    line(end, 140, 0, zoneEnd, 0, Math.min(20, end.widthM * 0.42), 0.2 * busy)
    const n = Math.round(30 * busy)
    for (let i = 0; i < n; i++) {
      const a0 = 120 + rand() ** 1.7 * (zoneEnd - 220)
      const len = 25 + rand() * 120
      const side = rand() < 0.5 ? -1 : 1
      // Main gear tracks: narrow-bodies about 3 m either side of the centreline, wide-bodies about 5.5 m.
      const c = side * (2.4 + rand() * 3.6)
      const drift = (rand() - 0.5) * 0.8
      line(end, a0, c, Math.min(a0 + len, zoneEnd + 60), c + drift, 0.9 + rand() * 1.5, (0.22 + rand() * 0.34) * busy)
    }
  }
  return { type: 'FeatureCollection', features }
}

/** The straight run of a stand's lead-in line out from the nose position, and the radius it turns on. */
export const STAND_STRAIGHT_M = 42
export const STAND_TURN_RADIUS_M = 30

/**
 * Painted stand markings for one gate: a yellow lead-in line running straight
 * out from the nose position along `outBearing` (away from the terminal) and
 * then curving 90° toward `turn` (1 right, -1 left, looking outward) onto the
 * taxilane, a stop bar across the nose position, and a point where the gate
 * number is painted, with `rot` the text rotation that reads along the stand.
 */
export function standMarkings(nose: LngLat, outBearing: number, turn: 1 | -1, ref: string | null): Feature[] {
  const b = (outBearing * Math.PI) / 180
  const ux = Math.sin(b)
  const uy = Math.cos(b)
  // Right of the outward direction.
  const rx = uy
  const ry = -ux
  const at = (along: number, right: number): LngLat => offset(nose, ux * along + rx * right, uy * along + ry * right)
  const pts: LngLat[] = [at(0, 0), at(STAND_STRAIGHT_M, 0)]
  const R = STAND_TURN_RADIUS_M
  for (let i = 1; i <= 8; i++) {
    const t = (i / 8) * (Math.PI / 2)
    pts.push(at(STAND_STRAIGHT_M + R * Math.sin(t), turn * R * (1 - Math.cos(t))))
  }
  const out: Feature[] = [
    { type: 'Feature', properties: { kind: 'lead' }, geometry: { type: 'LineString', coordinates: pts } },
    { type: 'Feature', properties: { kind: 'stop' }, geometry: { type: 'LineString', coordinates: [at(0, -3), at(0, 3)] } },
  ]
  if (ref) {
    // Text runs along the stand; keep it the right way up for a north-up map.
    let rot = (((outBearing - 90) % 360) + 360) % 360
    if (rot > 90 && rot < 270) rot -= 180
    out.push({ type: 'Feature', properties: { kind: 'num', ref, rot: Math.round(rot) }, geometry: { type: 'Point', coordinates: at(22, turn * -5) } })
  }
  return out
}
