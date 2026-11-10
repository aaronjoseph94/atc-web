/**
 * Aircraft seen from the side, nose to the right, for the compact aircraft
 * card in the flight view. (The map keeps its top views in `outlines.ts`.)
 *
 * Every drawing is generated here from a handful of numbers per class:
 * fuselage length and height, nose and tail-cone lengths, fin size and sweep,
 * where the wing sits and how it is swept, the engines' size and placement,
 * window rows, and optionally the landing gear. Nothing is traced from
 * outside artwork. Proportions follow published general-arrangement
 * dimensions for a typical member of each class, and the length is the
 * actual type's when we know it, so an A321 comes out longer than an A319.
 *
 * Units are metres. x runs from the end of the tail cone (0) to the nose
 * (the fuselage length); y points down (SVG), with 0 on the fuselage centre
 * line. The renderer (`SideView.tsx`) paints the parts in the order given,
 * so the list is back to front.
 */
import type { ShapeId } from './shapes'

export type SideClass = 'narrow' | 'wide' | 'quad' | 'regional' | 'smalljet' | 'turboprop' | 'bizjet' | 'light' | 'lighttwin' | 'heli' | 'generic'

export const SIDE_CLASSES: SideClass[] = ['narrow', 'wide', 'quad', 'regional', 'smalljet', 'turboprop', 'bizjet', 'light', 'lighttwin', 'heli', 'generic']

/**
 * What a part is, which decides how it is painted. `windows`, `gear`,
 * `strut`, `skid` and `mast` are strokes (see `Part.stroke`); the rest are fills.
 */
export type PartRole =
  | 'fin'
  | 'fuselage'
  | 'fairing'
  | 'stab'
  | 'wing'
  | 'pylon'
  | 'nacelle'
  | 'intake'
  | 'exhaust'
  | 'glass'
  | 'windows'
  | 'prop'
  | 'blade'
  | 'spinner'
  | 'rotor'
  | 'hub'
  | 'mast'
  | 'gear'
  | 'wheel'
  | 'strut'
  | 'skid'

export type Part = {
  role: PartRole
  /** SVG path data, metres. */
  d: string
  /** Stroke width in metres, for the stroked roles. */
  stroke?: number
  /** Dash and gap in metres (window rows). */
  dash?: [number, number]
  /** Round line ends: oval cabin windows rather than square ones. */
  round?: boolean
}

export type SideProfile = {
  cls: SideClass
  /** Fuselage length and height, metres. */
  length: number
  height: number
  /** viewBox: x, y, width, height (metres, padded). */
  box: [number, number, number, number]
  /** Where the lower fuselage turns to the darker belly (y, metres). */
  bellyY: number
  /** Back to front. */
  parts: Part[]
}

// ---------------------------------------------------------------------------
// Class per drawing, and per-class defaults
// ---------------------------------------------------------------------------

const BY_SHAPE: Record<ShapeId, SideClass> = {
  'ac-jet': 'narrow',
  'ac-heavy': 'wide',
  'ac-quad': 'quad',
  'ac-regional': 'regional',
  'ac-ejet': 'smalljet',
  'ac-turboprop': 'turboprop',
  'ac-bizjet': 'bizjet',
  'ac-light': 'light',
  'ac-twin-piston': 'lighttwin',
  'ac-heli': 'heli',
  'ac-vehicle': 'generic',
  'ac-dot': 'generic',
}

export function sideClassFor(shape: ShapeId): SideClass {
  return BY_SHAPE[shape] ?? 'generic'
}

/** Typical fuselage length when the type's isn't known, metres. */
export const DEFAULT_LENGTH: Record<SideClass, number> = {
  narrow: 38,
  wide: 63,
  quad: 70.7,
  regional: 32,
  smalljet: 34,
  turboprop: 30,
  bizjet: 21,
  light: 8.3,
  lighttwin: 9.1,
  heli: 12.2,
  generic: 36,
}

/** Lengths outside these are someone's typo; clamp so the drawing stays sane. */
const LENGTH_RANGE: Record<SideClass, [number, number]> = {
  narrow: [28, 56],
  wide: [45, 80],
  quad: [45, 85],
  regional: [20, 46],
  smalljet: [26, 42],
  turboprop: [12, 36],
  bizjet: [10, 36],
  light: [5, 13],
  lighttwin: [7, 14],
  heli: [7, 30],
  generic: [8, 80],
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const n = (v: number) => String(Math.round(v * 100) / 100)

// ---------------------------------------------------------------------------
// Path building, with running bounds for the viewBox
// ---------------------------------------------------------------------------

class Bounds {
  x0 = Infinity
  y0 = Infinity
  x1 = -Infinity
  y1 = -Infinity
  add(x: number, y: number, pad = 0) {
    this.x0 = Math.min(this.x0, x - pad)
    this.y0 = Math.min(this.y0, y - pad)
    this.x1 = Math.max(this.x1, x + pad)
    this.y1 = Math.max(this.y1, y + pad)
  }
}

type Pt = [number, number]

class Pen {
  d = ''
  private b: Bounds
  private pad: number
  constructor(b: Bounds, pad = 0) {
    this.b = b
    this.pad = pad
  }
  M(x: number, y: number) {
    this.b.add(x, y, this.pad)
    this.d += `M${n(x)} ${n(y)}`
    return this
  }
  L(x: number, y: number) {
    this.b.add(x, y, this.pad)
    this.d += `L${n(x)} ${n(y)}`
    return this
  }
  /** Cubic Bézier. Control points count toward the bounds, which only ever makes the box a touch roomier. */
  C(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    this.b.add(x1, y1, this.pad)
    this.b.add(x2, y2, this.pad)
    this.b.add(x, y, this.pad)
    this.d += `C${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(x)} ${n(y)}`
    return this
  }
  Q(x1: number, y1: number, x: number, y: number) {
    this.b.add(x1, y1, this.pad)
    this.b.add(x, y, this.pad)
    this.d += `Q${n(x1)} ${n(y1)} ${n(x)} ${n(y)}`
    return this
  }
  poly(pts: Pt[]) {
    pts.forEach(([x, y], i) => (i ? this.L(x, y) : this.M(x, y)))
    return this.Z()
  }
  /** Ellipse as two arcs. */
  ellipse(cx: number, cy: number, rx: number, ry: number) {
    this.b.add(cx - rx, cy - ry, this.pad)
    this.b.add(cx + rx, cy + ry, this.pad)
    this.d += `M${n(cx - rx)} ${n(cy)}A${n(rx)} ${n(ry)} 0 1 0 ${n(cx + rx)} ${n(cy)}A${n(rx)} ${n(ry)} 0 1 0 ${n(cx - rx)} ${n(cy)}Z`
    return this
  }
  Z() {
    this.d += 'Z'
    return this
  }
}

/** Point on a cubic Bézier. */
function bez(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]
}

class Drawing {
  b = new Bounds()
  parts: Part[] = []
  pen(pad = 0) {
    return new Pen(this.b, pad)
  }
  fill(role: PartRole, d: string) {
    this.parts.push({ role, d })
  }
  line(role: PartRole, pts: Pt[], width: number, dash?: [number, number], round = false) {
    const p = this.pen(width / 2)
    pts.forEach(([x, y], i) => (i ? p.L(x, y) : p.M(x, y)))
    this.parts.push({ role, d: p.d, stroke: width, ...(dash ? { dash } : {}), ...(round ? { round } : {}) })
  }
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

type Tube = {
  L: number
  H: number
  /** Length of the nose taper. */
  nose: number
  /** Nose tip height, as a fraction of the radius (positive = below the centre line). */
  tipY: number
  /** 0 = blunt, round airliner nose; 1 = long pointed business-jet nose. */
  sharp: number
  /** Length of the upswept tail cone. */
  tail: number
  /** Tail end, top and bottom, as fractions of the radius. */
  tailTop: number
  tailBot: number
  /** 747-style upper deck: starts this far from the tail, rises this much above the roof. */
  hump?: { x: number; h: number }
}

type NoseCurve = { p0: Pt; p1: Pt; p2: Pt; p3: Pt }

/** The fuselage outline. Returns the path and the nose's top curve, for placing the cockpit windows. */
function tube(dw: Drawing, t: Tube): { d: string; nose: NoseCurve; roofAt: (x: number) => number } {
  const r = t.H / 2
  const { L, nose, tail } = t
  const tipY = t.tipY * r
  const roof = -r - (t.hump?.h ?? 0)
  const p = dw.pen()
  p.M(0, t.tailTop * r)
  p.Q(tail * 0.25, -r, tail * 0.65, -r)
  if (t.hump) {
    // Main roof, then the upper deck rising to its own roof, which runs into the nose.
    const hx = t.hump.x
    const rise = Math.min(t.H * 0.9, L - nose - hx)
    p.L(hx, -r)
    p.C(hx + rise * 0.45, -r, hx + rise * 0.4, roof, hx + rise, roof)
  }
  p.L(L - nose, roof)
  const nc: NoseCurve = {
    p0: [L - nose, roof],
    p1: [L - nose * (0.5 - t.sharp * 0.1), roof],
    p2: [L - nose * t.sharp * 0.12, tipY - (roof - tipY) * -0.62 * (1 - t.sharp * 0.55)],
    p3: [L, tipY],
  }
  p.C(nc.p1[0], nc.p1[1], nc.p2[0], nc.p2[1], L, tipY)
  // Underside of the nose, back to the keel.
  p.C(L - nose * t.sharp * 0.08, tipY + (r - tipY) * (0.7 - t.sharp * 0.25), L - nose * (0.55 - t.sharp * 0.1), r, L - nose, r)
  p.L(tail, r)
  // Tail cone sweeping up to the tail end.
  p.C(tail * 0.55, r, tail * 0.22, t.tailBot * r + r * 0.3, 0, t.tailBot * r)
  p.Z()
  const roofAt = (x: number) => {
    if (x < tail * 0.65) {
      // Along the quadratic from the tail end, near enough.
      const k = clamp(x / (tail * 0.65), 0, 1)
      return t.tailTop * r + (-r - t.tailTop * r) * (1 - (1 - k) * (1 - k))
    }
    if (t.hump && x > t.hump.x) return x > t.hump.x + t.H * 0.9 ? roof : -r + (roof + r) * clamp((x - t.hump.x) / (t.H * 0.9), 0, 1)
    return -r
  }
  return { d: p.d, nose: nc, roofAt }
}

/** Airliner flight-deck windows: a slanted dark band on the shoulder of the nose. */
function flightDeck(dw: Drawing, nc: NoseCurve, r: number, scale = 1) {
  const a = bez(nc.p0, nc.p1, nc.p2, nc.p3, 0.34)
  const b = bez(nc.p0, nc.p1, nc.p2, nc.p3, 0.62)
  const drop = 0.13 * r * scale
  const depth = 0.24 * r * scale
  const p = dw.pen()
  p.M(a[0], a[1] + drop)
  p.L(b[0], b[1] + drop)
  p.L(b[0] - (b[0] - a[0]) * 0.18, b[1] + drop + depth * 0.85)
  p.L(a[0] + (b[0] - a[0]) * 0.06, a[1] + drop + depth)
  p.Z()
  dw.fill('glass', p.d)
}

type Fin = {
  /** Root trailing edge, metres from the tail end. */
  x: number
  /** Height above the roof. */
  h: number
  root: number
  tip: number
  /** How far back the tip's leading edge sits from the root's. */
  sweep: number
  /** Roof height at the fin, y. */
  baseY: number
  /** Long dorsal fillet running forward into the roof. */
  fillet?: number
}

/** Fin, drawn before the fuselage so its root tucks in. Returns the tip's leading and trailing edges. */
function fin(dw: Drawing, f: Fin, r: number): { le: Pt; te: Pt } {
  const rootLE: Pt = [f.x + f.root, f.baseY]
  const tipLE: Pt = [f.x + f.root - f.sweep, f.baseY - f.h]
  const tipTE: Pt = [tipLE[0] - f.tip, f.baseY - f.h * 0.985]
  const fil = f.fillet ?? 0.3
  const filletStart: Pt = [rootLE[0] + f.root * fil * 1.6, f.baseY + r * 0.1]
  const onLE: Pt = [rootLE[0] + (tipLE[0] - rootLE[0]) * fil, rootLE[1] + (tipLE[1] - rootLE[1]) * fil]
  const p = dw.pen()
  p.M(f.x - f.root * 0.05, f.baseY + r * 0.45)
  p.L(filletStart[0], filletStart[1] + r * 0.35)
  p.L(filletStart[0], filletStart[1])
  p.Q(rootLE[0], rootLE[1], onLE[0], onLE[1])
  p.L(tipLE[0], tipLE[1])
  p.Q(tipLE[0] - f.tip * 0.1, tipLE[1] - f.h * 0.01, tipLE[0] - f.tip * 0.25, tipLE[1])
  p.L(tipTE[0], tipTE[1])
  p.Z()
  dw.fill('fin', p.d)
  return { le: tipLE, te: tipTE }
}

/** A swept tailplane or wing seen edge-on: a thin sliver running back (and up, with dihedral) from its root. */
function sliver(dw: Drawing, role: PartRole, o: { x: number; y: number; root: number; tip: number; sweep: number; rise: number; thick: number }) {
  const p = dw.pen()
  p.M(o.x, o.y - o.thick * 0.55)
  p.Q(o.x + o.thick * 0.6, o.y, o.x, o.y + o.thick * 0.45)
  p.L(o.x - o.root, o.y + o.thick * 0.15)
  p.L(o.x - o.sweep - o.tip, o.y - o.rise + o.thick * 0.12)
  p.Q(o.x - o.sweep + o.tip * 0.15, o.y - o.rise + o.thick * 0.2, o.x - o.sweep, o.y - o.rise - o.thick * 0.25)
  p.Z()
  dw.fill(role, p.d)
}

/** Turbofan nacelle, intake to the right. */
function turbofan(dw: Drawing, front: number, cy: number, len: number, dia: number) {
  const R = dia / 2
  const back = front - len
  const p = dw.pen()
  p.M(front, cy - R * 0.9)
  p.C(front - len * 0.1, cy - R * 1.04, back + len * 0.45, cy - R, back + len * 0.18, cy - R * 0.72)
  p.L(back, cy - R * 0.42)
  p.L(back, cy + R * 0.4)
  p.L(back + len * 0.18, cy + R * 0.7)
  p.C(back + len * 0.45, cy + R, front - len * 0.1, cy + R * 1.02, front, cy + R * 0.88)
  p.Q(front + R * 0.12, cy, front, cy - R * 0.9)
  p.Z()
  dw.fill('nacelle', p.d)
  dw.fill('intake', dw.pen().ellipse(front + R * 0.02, cy, R * 0.16, R * 0.82).d)
  // Exhaust plug.
  dw.fill('exhaust', dw.pen().poly([
    [back + len * 0.02, cy - R * 0.36],
    [back - len * 0.14, cy - R * 0.05],
    [back - len * 0.14, cy + R * 0.05],
    [back + len * 0.02, cy + R * 0.34],
  ]).d)
}

/** Propeller disc seen edge-on to the blades' sweep: a pale disc, one blade, a spinner. */
function propeller(dw: Drawing, x: number, cy: number, radius: number) {
  dw.fill('prop', dw.pen().ellipse(x, cy, radius * 0.14, radius).d)
  dw.fill('blade', dw.pen().poly([
    [x - radius * 0.025, cy - radius * 0.96],
    [x + radius * 0.025, cy - radius * 0.96],
    [x + radius * 0.035, cy + radius * 0.96],
    [x - radius * 0.035, cy + radius * 0.96],
  ]).d)
  const s = radius * 0.2
  const p = dw.pen()
  p.M(x - s * 0.3, cy - s)
  p.Q(x + s * 1.5, cy - s * 0.4, x + s * 1.6, cy)
  p.Q(x + s * 1.5, cy + s * 0.4, x - s * 0.3, cy + s)
  p.Z()
  dw.fill('spinner', p.d)
}

/** Landing gear legs ending in wheels on the ground line. */
function gearLeg(dw: Drawing, x: number, top: number, ground: number, wheel: number, wheels = 1, width = 0.18) {
  const cy = ground - wheel
  dw.line('gear', [
    [x, top],
    [x, cy],
  ], width)
  const spread = wheel * 2.15
  for (let i = 0; i < wheels; i++) {
    const wx = x + (i - (wheels - 1) / 2) * spread
    dw.fill('wheel', dw.pen().ellipse(wx, cy, wheel, wheel).d)
  }
  if (wheels > 1) dw.line('gear', [
    [x - ((wheels - 1) / 2) * spread, cy],
    [x + ((wheels - 1) / 2) * spread, cy],
  ], width)
}

function windowRow(dw: Drawing, x1: number, x2: number, y: number, H: number, k = 1) {
  if (x2 - x1 < H * 0.5) return
  dw.line('windows', [
    [x1, y],
    [x2, y],
  ], H * 0.085 * k, [H * 0.075 * k, H * 0.1 * k])
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

type Ctx = { L: number; type: string; gear: boolean }

/** Airliners with engines under the wing: narrow-bodies, wide-bodies, quads, E-jets, the generic fallback. */
function underwingJet(dw: Drawing, cls: SideClass, c: Ctx): number {
  const { L, type } = c
  const big = cls === 'wide' || cls === 'quad'
  const a380 = /^A38/.test(type)
  const b747 = /^(B74|BLCF)/.test(type)
  // Fuselage height: published outside heights for each family.
  let H = cls === 'narrow' ? 4 : cls === 'smalljet' ? (/^BCS/.test(type) ? 3.7 : 3.35) : cls === 'generic' ? 4 : clamp(L * 0.09, 5, 6.2)
  if (cls === 'narrow' && /^(B75)/.test(type)) H = 4.1
  if (a380) H = 8.4
  if (b747) H = 6.6
  if (cls === 'quad' && !a380 && !b747) H = clamp(L * 0.085, 5.6, 6.6)
  const r = H / 2
  const nose = H * (big ? 1.25 : 1.35)
  const tail = L * (big ? 0.24 : 0.27)
  const hump = b747 ? { x: L - nose - L * (/^B748|^B74S/.test(type) ? 0.42 : 0.33), h: H * 0.32 } : undefined
  const tb = tube(dw, { L, H, nose, tipY: big ? 0.18 : 0.22, sharp: 0.05, tail, tailTop: -0.82, tailBot: -0.42, hump })
  const finH = H * (cls === 'smalljet' ? 1.8 : big ? 1.65 : 1.8)
  const finRoot = L * (big ? 0.15 : 0.18)
  // The fin goes first so the fuselage covers its root.
  const finX = L * 0.02
  fin(dw, { x: finX, h: finH, root: finRoot, tip: finRoot * 0.36, sweep: finH * 0.78, baseY: tb.roofAt(finX + finRoot * 0.5), fillet: 0.28 }, r)
  dw.fill('fuselage', tb.d)

  // Wing: low, its root a little behind the middle; swept back and rising with dihedral.
  const wx = L * (big ? 0.6 : 0.62)
  const chord = L * (big ? 0.15 : 0.18)
  const sweep = chord * 1.45
  const rise = r * 0.55
  const wy = r * 0.62
  // Belly fairing under the wing root.
  {
    const p = dw.pen()
    p.M(wx + chord * 0.25, r * 0.86)
    p.C(wx + chord * 0.05, r * 1.17, wx - chord * 1.1, r * 1.17, wx - chord * 1.35, r * 0.86)
    p.Z()
    dw.fill('fairing', p.d)
  }
  // Conventional tailplane, low on the tail cone.
  sliver(dw, 'stab', { x: finX + finRoot * 0.95, y: -r * 0.25, root: finRoot * 0.7, tip: finRoot * 0.25, sweep: finRoot * 0.85, rise: r * 0.22, thick: r * 0.16 })
  // Cabin windows (two decks on the A380, a short row on a 747's upper deck).
  const winFrom = tail * 0.92
  const winTo = L - nose * 1.12
  if (a380) {
    windowRow(dw, winFrom, winTo, -r * 0.42, H * 0.6)
    windowRow(dw, winFrom + H * 0.3, winTo - H * 0.15, r * 0.14, H * 0.6)
  } else {
    windowRow(dw, winFrom, winTo, -r * 0.2, H)
    if (hump) windowRow(dw, hump.x + H * 0.9, L - nose * 1.05, -r - hump.h * 0.5, H * 0.75)
  }
  flightDeck(dw, tb.nose, r + (hump?.h ?? 0) * 0.5, a380 ? 0.7 : 1)
  sliver(dw, 'wing', { x: wx, y: wy, root: chord, tip: chord * 0.28, sweep, rise, thick: r * 0.3 })

  // Engines: one twin's near engine, or a quad's inner and outer.
  const dia = H * (cls === 'smalljet' ? 0.6 : big ? 0.58 : 0.52)
  const len = dia * (big ? 2.0 : 2.15)
  const stations = cls === 'quad' ? [0.3, 0.62] : [0.34]
  let lowest = r
  for (const f of stations) {
    const wingY = wy - rise * f
    const front = wx - sweep * f + len * 0.55
    const cy = wingY + r * 0.08 + dia * 0.5
    dw.fill('pylon', dw.pen().poly([
      [front - len * 0.2, cy - dia * 0.38],
      [front - len * 0.78, cy - dia * 0.38],
      [front - len * 0.95, wingY - r * 0.02],
      [front - len * 0.3, wingY - r * 0.06],
    ]).d)
    turbofan(dw, front, cy, len, dia)
    lowest = Math.max(lowest, cy + dia / 2)
  }

  if (c.gear) {
    const ground = Math.max(r + H * 0.5, lowest + H * 0.16)
    const wheel = H * (big ? 0.12 : 0.14)
    gearLeg(dw, wx - chord * 0.62, r * 0.85, ground, wheel, big ? (cls === 'quad' ? 2 : 3) : 1, H * 0.07)
    gearLeg(dw, L - nose * 0.78, r * 0.9, ground, wheel * 0.8, 1, H * 0.06)
  }
  return H
}

/** Jets with engines on the rear fuselage and a T-tail: regional jets and business jets. */
function rearJet(dw: Drawing, cls: 'regional' | 'bizjet', c: Ctx): number {
  const { L, type } = c
  const biz = cls === 'bizjet'
  let H = biz ? clamp(L * 0.105, 1.7, 2.7) : 2.7
  if (!biz && /^(B712|MD8|MD9|DC9|F100|F70|F28)/.test(type)) H = 3.35
  if (!biz && /^(E13|E14|E45)/.test(type)) H = 2.28
  const r = H / 2
  const nose = H * (biz ? 2.1 : 1.55)
  const tail = L * (biz ? 0.3 : 0.28)
  const tb = tube(dw, { L, H, nose, tipY: biz ? 0.08 : 0.15, sharp: biz ? 0.8 : 0.3, tail, tailTop: -0.78, tailBot: -0.4 })
  const finH = H * (biz ? 1.55 : 1.45)
  const finRoot = L * (biz ? 0.17 : 0.16)
  const finX = L * 0.01
  const tip = fin(dw, { x: finX, h: finH, root: finRoot, tip: finRoot * 0.62, sweep: finH * (biz ? 1.0 : 0.85), baseY: tb.roofAt(finX + finRoot * 0.5), fillet: 0.22 }, r)
  // T-tail on top of the fin.
  sliver(dw, 'stab', { x: tip.le[0] + finRoot * 0.08, y: tip.le[1] + r * 0.05, root: finRoot * 0.62, tip: finRoot * 0.25, sweep: finRoot * 0.6, rise: r * 0.05, thick: r * 0.2 })
  dw.fill('fuselage', tb.d)

  const wx = L * (biz ? 0.6 : 0.6)
  const chord = L * (biz ? 0.17 : 0.15)
  const sweep = chord * (biz ? 1.4 : 1.2)
  const wy = r * 0.65
  {
    const p = dw.pen()
    p.M(wx + chord * 0.2, r * 0.86)
    p.C(wx, r * 1.14, wx - chord * 1.05, r * 1.14, wx - chord * 1.3, r * 0.86)
    p.Z()
    dw.fill('fairing', p.d)
  }
  const engX = L * (biz ? 0.255 : 0.25)
  const winFrom = Math.max(tail * 0.9, engX + L * 0.1)
  const winTo = L - nose * 1.12
  if (biz) {
    // Big oval cabin windows, spaced out.
    dw.line('windows', [
      [winFrom, -r * 0.12],
      [winTo, -r * 0.12],
    ], H * 0.2, [H * 0.08, H * 0.4], true)
  } else windowRow(dw, winFrom, winTo, -r * 0.2, H)
  flightDeck(dw, tb.nose, r, biz ? 0.85 : 1)
  sliver(dw, 'wing', { x: wx, y: wy, root: chord, tip: chord * 0.3, sweep, rise: r * 0.4, thick: r * 0.24 })
  if (biz) {
    // Winglet.
    const tx = wx - sweep
    const ty = wy - r * 0.4
    dw.fill('wing', dw.pen().poly([
      [tx + chord * 0.02, ty - r * 0.05],
      [tx - chord * 0.12, ty - r * 0.75],
      [tx - chord * 0.24, ty - r * 0.75],
      [tx - chord * 0.24, ty + r * 0.05],
    ]).d)
  }

  // Engine on its stub pylon, high on the rear fuselage.
  const dia = H * (biz ? 0.5 : 0.52)
  const len = L * (biz ? 0.16 : 0.125)
  const cy = -r * (biz ? 0.5 : 0.48)
  const front = engX + len / 2
  dw.fill('pylon', dw.pen().poly([
    [front - len * 0.25, cy],
    [front - len * 0.75, cy],
    [front - len * 0.8, r * 0.1],
    [front - len * 0.3, r * 0.1],
  ]).d)
  turbofan(dw, front, cy, len, dia)

  if (c.gear) {
    const ground = r + H * 0.6
    const wheel = H * 0.14
    gearLeg(dw, wx - chord * 0.7, r * 0.85, ground, wheel, 1, H * 0.06)
    gearLeg(dw, L - nose * 0.8, r * 0.85, ground, wheel * 0.8, 1, H * 0.05)
  }
  return H
}

/** High-wing twin turboprop airliner with a T-tail (Dash 8, ATR). */
function turbopropAirliner(dw: Drawing, c: Ctx): number {
  const { L } = c
  const H = clamp(L * 0.09, 1.9, 2.8)
  const r = H / 2
  const nose = H * 1.35
  const tail = L * 0.3
  const tb = tube(dw, { L, H, nose, tipY: 0.18, sharp: 0.2, tail, tailTop: -0.8, tailBot: -0.35 })
  const finH = H * 1.75
  const finRoot = L * 0.18
  const finX = L * 0.015
  const tip = fin(dw, { x: finX, h: finH, root: finRoot, tip: finRoot * 0.55, sweep: finH * 0.7, baseY: tb.roofAt(finX + finRoot * 0.5), fillet: 0.3 }, r)
  sliver(dw, 'stab', { x: tip.le[0] + finRoot * 0.05, y: tip.le[1] + r * 0.05, root: finRoot * 0.6, tip: finRoot * 0.35, sweep: finRoot * 0.3, rise: 0, thick: r * 0.2 })
  dw.fill('fuselage', tb.d)
  // Main-gear sponson under the wing.
  const wx = L * 0.6
  const chord = L * 0.09
  {
    const p = dw.pen()
    p.M(wx + chord * 0.3, r * 0.8)
    p.C(wx + chord * 0.1, r * 1.22, wx - chord * 1.6, r * 1.22, wx - chord * 2, r * 0.8)
    p.Z()
    dw.fill('fairing', p.d)
  }
  windowRow(dw, tail * 0.95, L - nose * 1.15, -r * 0.15, H)
  flightDeck(dw, tb.nose, r)
  // High wing on the roof.
  sliver(dw, 'wing', { x: wx, y: -r * 1.06, root: chord, tip: chord * 0.55, sweep: chord * 0.2, rise: r * 0.12, thick: r * 0.34 })
  const dia = H * 0.44
  const len = L * 0.24
  const cy = -r * 0.74
  const front = wx + len * 0.32
  const p = dw.pen()
  p.M(front, cy - dia * 0.4)
  p.C(front - len * 0.2, cy - dia * 0.62, front - len * 0.7, cy - dia * 0.55, front - len, cy - dia * 0.2)
  p.L(front - len, cy + dia * 0.05)
  p.C(front - len * 0.7, cy + dia * 0.55, front - len * 0.2, cy + dia * 0.62, front, cy + dia * 0.42)
  p.Z()
  dw.fill('nacelle', p.d)
  propeller(dw, front + dia * 0.05, cy, H * 0.78)
  if (c.gear) {
    const ground = r + H * 0.5
    const wheel = H * 0.15
    gearLeg(dw, wx - chord * 0.9, r * 0.9, ground, wheel, 1, H * 0.06)
    gearLeg(dw, L - nose * 0.75, r * 0.85, ground, wheel * 0.75, 1, H * 0.05)
  }
  return H
}

/** High-wing single with a nose propeller and fixed gear (Cessna 172 class). Its gear is always drawn. */
function lightSingle(dw: Drawing, c: Ctx): number {
  const { L } = c
  const H = 1.55
  const r = H / 2
  // Fin and dorsal fillet.
  fin(dw, { x: 0, h: H * 0.85, root: L * 0.17, tip: L * 0.09, sweep: H * 0.55, baseY: -r * 0.5, fillet: 0.35 }, r * 0.5)
  const p = dw.pen()
  p.M(0, -r * 0.55)
  p.L(L * 0.5, -r * 0.92)
  p.Q(L * 0.53, -r, L * 0.58, -r)
  p.L(L * 0.7, -r)
  // Windscreen down to the cowling.
  p.Q(L * 0.76, -r, L * 0.82, -r * 0.42)
  p.L(L * 0.93, -r * 0.32)
  p.C(L * 0.985, -r * 0.3, L, -r * 0.05, L, r * 0.05)
  p.C(L, r * 0.45, L * 0.96, r * 0.6, L * 0.9, r * 0.62)
  p.L(L * 0.72, r)
  p.L(L * 0.5, r)
  p.C(L * 0.32, r * 0.75, L * 0.12, -r * 0.08, 0, -r * 0.2)
  p.Z()
  dw.fill('fuselage', p.d)
  // Low tailplane.
  sliver(dw, 'stab', { x: L * 0.16, y: -r * 0.35, root: L * 0.13, tip: L * 0.07, sweep: L * 0.03, rise: 0, thick: r * 0.14 })
  // Side windows: door and rear window.
  dw.fill('glass', dw.pen().poly([
    [L * 0.585, -r * 0.82],
    [L * 0.69, -r * 0.82],
    [L * 0.76, -r * 0.36],
    [L * 0.585, -r * 0.3],
  ]).d)
  dw.fill('glass', dw.pen().poly([
    [L * 0.47, -r * 0.78],
    [L * 0.56, -r * 0.82],
    [L * 0.56, -r * 0.32],
    [L * 0.49, -r * 0.36],
  ]).d)
  // Strut, then the high wing on the cabin roof.
  dw.line('strut', [
    [L * 0.66, -r * 1.02],
    [L * 0.6, r * 0.55],
  ], 0.09)
  sliver(dw, 'wing', { x: L * 0.73, y: -r * 1.04, root: L * 0.19, tip: L * 0.17, sweep: L * 0.01, rise: r * 0.1, thick: r * 0.18 })
  propeller(dw, L + 0.08, -r * 0.03, 0.95)
  // Fixed tricycle gear: spring legs and the nose leg.
  const ground = r + 0.72
  const wheel = 0.27
  dw.line('gear', [
    [L * 0.56, r * 0.85],
    [L * 0.52, ground - wheel],
  ], 0.08)
  dw.fill('wheel', dw.pen().ellipse(L * 0.52, ground - wheel, wheel, wheel).d)
  gearLeg(dw, L * 0.89, r * 0.55, ground, wheel * 0.85, 1, 0.08)
  return H
}

/** Low-wing piston twin (Baron, Seneca). */
function lightTwin(dw: Drawing, c: Ctx): number {
  const { L } = c
  const H = 1.35
  const r = H / 2
  const nose = H * 1.5
  const tail = L * 0.42
  const tb = tube(dw, { L, H, nose, tipY: 0.12, sharp: 0.5, tail, tailTop: -0.55, tailBot: -0.22 })
  fin(dw, { x: 0, h: H * 0.95, root: L * 0.16, tip: L * 0.08, sweep: H * 0.6, baseY: tb.roofAt(L * 0.08), fillet: 0.3 }, r)
  dw.fill('fuselage', tb.d)
  sliver(dw, 'stab', { x: L * 0.14, y: -r * 0.3, root: L * 0.12, tip: L * 0.07, sweep: L * 0.02, rise: r * 0.1, thick: r * 0.14 })
  // Cabin windows and windscreen.
  dw.line('windows', [
    [L * 0.42, -r * 0.3],
    [L * 0.66, -r * 0.3],
  ], H * 0.2, [H * 0.14, H * 0.3], true)
  dw.fill('glass', dw.pen().poly([
    [L * 0.69, -r * 0.62],
    [L * 0.75, -r * 0.62],
    [L * 0.8, -r * 0.1],
    [L * 0.69, -r * 0.08],
  ]).d)
  const wx = L * 0.62
  const chord = L * 0.17
  sliver(dw, 'wing', { x: wx, y: r * 0.6, root: chord, tip: chord * 0.6, sweep: chord * 0.08, rise: r * 0.45, thick: r * 0.25 })
  // Engine nacelle on the wing, propeller in front.
  const dia = H * 0.48
  const len = L * 0.27
  const cy = r * 0.32
  const front = wx + len * 0.4
  const p = dw.pen()
  p.M(front, cy - dia * 0.42)
  p.C(front - len * 0.3, cy - dia * 0.6, front - len * 0.7, cy - dia * 0.5, front - len, cy)
  p.C(front - len * 0.7, cy + dia * 0.5, front - len * 0.3, cy + dia * 0.6, front, cy + dia * 0.42)
  p.Z()
  dw.fill('nacelle', p.d)
  propeller(dw, front + 0.05, cy, 0.98)
  if (c.gear) {
    const ground = r + 0.85
    gearLeg(dw, wx - chord * 0.45, r * 0.75, ground, 0.24, 1, 0.08)
    gearLeg(dw, L - nose * 0.55, r * 0.8, ground, 0.2, 1, 0.07)
  }
  return H
}

/** Light helicopter: cabin pod, tail boom, fin with tail rotor, main rotor, skids. */
function helicopter(dw: Drawing, c: Ctx, rotorD: number): number {
  const { L } = c
  const H = clamp(L * 0.19, 1.8, 3.4)
  const r = H / 2
  const pod = L * 0.5
  const p = dw.pen()
  // Boom end, along the boom's top, up over the engine cowling, the cabin roof and round the glazed nose.
  p.M(L * 0.035, -r * 0.62)
  p.L(L - pod * 1.02, -r * 0.72)
  p.C(L - pod * 0.9, -r * 1.2, L - pod * 0.75, -r * 1.28, L - pod * 0.55, -r * 1.24)
  p.L(L - pod * 0.3, -r * 1.0)
  p.C(L - pod * 0.08, -r * 0.95, L, -r * 0.35, L, r * 0.15)
  p.C(L, r * 0.75, L - pod * 0.08, r, L - pod * 0.22, r)
  p.L(L - pod * 0.78, r)
  p.C(L - pod * 0.95, r * 0.95, L - pod * 1.0, r * 0.2, L - pod * 1.04, -r * 0.12)
  p.L(L * 0.035, -r * 0.38)
  p.Z()
  // Fin at the boom end.
  const finP = dw.pen()
  finP.poly([
    [L * 0.005, -r * 0.3],
    [L * 0.08, -r * 0.42],
    [L * 0.06, -r * 1.7],
    [0, -r * 1.85],
  ])
  dw.fill('fin', finP.d)
  dw.fill('fuselage', p.d)
  // Horizontal stabiliser on the boom.
  sliver(dw, 'stab', { x: L * 0.24, y: -r * 0.5, root: L * 0.06, tip: L * 0.04, sweep: L * 0.01, rise: 0, thick: r * 0.12 })
  // Big glazed cabin.
  const g = dw.pen()
  g.M(L - pod * 0.3, -r * 0.82)
  g.C(L - pod * 0.12, -r * 0.8, L - pod * 0.02, -r * 0.35, L - pod * 0.01, r * 0.1)
  g.L(L - pod * 0.2, r * 0.1)
  g.L(L - pod * 0.32, -r * 0.1)
  g.Z()
  dw.fill('glass', g.d)
  dw.fill('glass', dw.pen().poly([
    [L - pod * 0.6, -r * 0.78],
    [L - pod * 0.36, -r * 0.82],
    [L - pod * 0.38, -r * 0.1],
    [L - pod * 0.6, -r * 0.1],
  ]).d)
  // Tail rotor: it turns in the plane we are looking at, so it shows as a full disc.
  {
    const tx = L * 0.035
    const ty = -r * 1.35
    const tr = H * 0.4
    dw.fill('prop', dw.pen().ellipse(tx, ty, tr, tr).d)
    dw.fill('blade', dw.pen().poly([
      [tx - tr * 0.95, ty - tr * 0.05],
      [tx + tr * 0.95, ty - tr * 0.05],
      [tx + tr * 0.95, ty + tr * 0.05],
      [tx - tr * 0.95, ty + tr * 0.05],
    ]).d)
    dw.fill('hub', dw.pen().ellipse(tx, ty, tr * 0.14, tr * 0.14).d)
  }
  // Skids.
  const ground = r + H * 0.42
  const sk = 0.11
  dw.line('strut', [
    [L - pod * 0.75, r * 0.9],
    [L - pod * 0.82, ground - sk],
  ], 0.12)
  dw.line('strut', [
    [L - pod * 0.32, r * 0.9],
    [L - pod * 0.28, ground - sk],
  ], 0.12)
  dw.line('skid', [
    [L - pod * 0.98, ground - sk],
    [L - pod * 0.12, ground - sk],
    [L - pod * 0.02, ground - sk - H * 0.18],
  ], sk * 1.4)
  // Main rotor: mast, hub, and the blades seen edge-on, drooping a little at the tips.
  const hx = L - pod * 0.62
  const hy = -r * 1.28 - H * 0.28
  dw.line('mast', [
    [hx, -r * 1.2],
    [hx, hy],
  ], 0.16)
  const R = rotorD / 2
  const rp = dw.pen()
  rp.M(hx - R, hy + H * 0.06)
  rp.Q(hx - R * 0.5, hy - 0.05, hx, hy - 0.07)
  rp.Q(hx + R * 0.5, hy - 0.05, hx + R, hy + H * 0.06)
  rp.L(hx + R, hy + H * 0.06 + 0.1)
  rp.Q(hx + R * 0.5, hy + 0.06, hx, hy + 0.07)
  rp.Q(hx - R * 0.5, hy + 0.06, hx - R, hy + H * 0.06 + 0.1)
  rp.Z()
  dw.fill('rotor', rp.d)
  dw.fill('hub', dw.pen().ellipse(hx, hy, 0.32, 0.16).d)
  return H
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export type SideInput = {
  shape: ShapeId
  /** ICAO type designator, for a few per-type touches (747 hump, A380 decks, fuselage widths). */
  type?: string | null
  /** The type's length, when known. */
  lengthM?: number | null
  /** Wingspan, or rotor diameter for helicopters. */
  spanM?: number | null
  /** Draw the landing gear (on the ground). Light singles and helicopters always show theirs. */
  gear?: boolean
}

const cache = new Map<string, SideProfile>()

export function sideProfile(input: SideInput): SideProfile {
  const cls = sideClassFor(input.shape)
  const [lo, hi] = LENGTH_RANGE[cls]
  const L = clamp(input.lengthM && Number.isFinite(input.lengthM) ? input.lengthM : DEFAULT_LENGTH[cls], lo, hi)
  const type = (input.type ?? '').trim().toUpperCase()
  const gear = !!input.gear
  const key = `${cls}|${type}|${L}|${input.spanM ?? ''}|${gear}`
  const hit = cache.get(key)
  if (hit) return hit

  const dw = new Drawing()
  const c: Ctx = { L, type, gear }
  let H: number
  switch (cls) {
    case 'regional':
    case 'bizjet':
      H = rearJet(dw, cls, c)
      break
    case 'turboprop':
      H = turbopropAirliner(dw, c)
      break
    case 'light':
      H = lightSingle(dw, c)
      break
    case 'lighttwin':
      H = lightTwin(dw, c)
      break
    case 'heli':
      H = helicopter(dw, c, clamp(input.spanM ?? L * 0.86, L * 0.6, L * 1.2))
      break
    default:
      H = underwingJet(dw, cls, c)
  }
  const pad = L * 0.015
  const { x0, y0, x1, y1 } = dw.b
  const profile: SideProfile = {
    cls,
    length: L,
    height: H,
    box: [x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2],
    bellyY: (H / 2) * (cls === 'light' || cls === 'heli' ? 0.5 : 0.42),
    parts: dw.parts,
  }
  cache.set(key, profile)
  return profile
}
