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
 * `strut`, `skid`, `mast` and `pillar` are strokes (see `Part.stroke`); the rest are fills.
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
  | 'core'
  | 'lip'
  | 'door'
  | 'pillar'
  | 'wheelhub'

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
  /** Top and bottom of the fuselage (y, metres), for its shading. */
  body: [number, number]
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
const n = (v: number) => String(Math.round(v * 1000) / 1000)

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

// ---------------------------------------------------------------------------
// Airliners, regional and business jets, turboprops: one parametric drawing,
// set per family from published general-arrangement dimensions.
// ---------------------------------------------------------------------------

type Ctx = { L: number; type: string; gear: boolean; span?: number | null }

/** What sits at the wing tip. */
type Winglet = 'none' | 'blended' | 'sharklet' | 'canted' | 'tall' | 'fence' | 'curved' | 'small'

type Family = {
  /** Fuselage length and wingspan when the type's own aren't known; fuselage height. Metres. */
  len: number
  span: number
  D: number
  /** Nose: length of its top and bottom curves (× D), tip height (× radius, + is below the centre line), 0 pointed to 1 round. */
  nose: number
  chin: number
  tipY: number
  bluff: number
  /** Tail cone: length of the roof's and the belly's taper (× L), and where its end sits (× radius, - is above). */
  tail: number
  up: number
  endTop: number
  endBot: number
  /** 747 upper deck: where its rise begins (× L from the tail) and how high it stands (× D). */
  hump?: { x: number; h: number }
  /** Full-length upper deck (A380): two window rows. */
  decks?: 2
  /** Fin: height (× D), root chord (× height), tip chord (× root), leading-edge sweep (°), dorsal fillet (× root), trailing edge (× L). */
  fin: { h: number; root: number; tip: number; sweep: number; dorsal: number; x: number }
  tTail?: boolean
  /** Tailplane: semi-span (× fin height), root chord (× fin root), tip chord (× root), sweep and dihedral (°). */
  stab: { semi: number; root: number; tip: number; sweep: number; dih: number }
  /** Wing: high or low, root leading edge (× L from the tail), root chord (× L), tip chord (× root), sweep and dihedral (°). */
  wing: { high?: boolean; x: number; root: number; tip: number; sweep: number; dih: number; winglet: Winglet }
  /**
   * Engines: under the wing (`fan`, stations as fractions of the semi-span), on the rear fuselage (`rear`, nacelle
   * centre × L), or turboprops on the wing (`prop`). Nacelle diameter in metres, length × diameter.
   */
  eng: { kind: 'fan' | 'rear' | 'prop'; at: number[]; dia: number; len: number; prop?: number; ahead?: number }
  /** Main-gear wheels seen from the side, per leg. */
  bogie: number
  /** Window row height (× radius), window size and pitch (m). */
  win: { y: number; d: number; pitch: number }
  /** High-wing turboprop with its main gear in a fuselage sponson (ATR), not in the nacelles (Dash 8). */
  sponson?: boolean
  /** Cockpit side windows, × the usual size (A350's dark mask is bigger). */
  cockpit?: number
}

const NARROW: Family = {
  len: 37.6, span: 35.8, D: 4.14, nose: 1.25, chin: 1.05, tipY: 0.12, bluff: 0.62, tail: 0.21, up: 0.31, endTop: -0.5, endBot: -0.22,
  fin: { h: 1.5, root: 1.1, tip: 0.38, sweep: 36, dorsal: 0.45, x: 0.008 },
  stab: { semi: 1.0, root: 0.72, tip: 0.33, sweep: 32, dih: 6 },
  wing: { x: 0.565, root: 0.17, tip: 0.24, sweep: 27, dih: 5.5, winglet: 'sharklet' },
  eng: { kind: 'fan', at: [0.34], dia: 2.25, len: 1.95 },
  bogie: 1,
  win: { y: -0.14, d: 0.34, pitch: 0.53 },
}

const WIDE: Family = {
  ...NARROW, len: 63.7, span: 60.3, D: 5.64, nose: 1.25, chin: 1.0, tail: 0.22, up: 0.3,
  fin: { h: 1.55, root: 1.1, tip: 0.38, sweep: 40, dorsal: 0.35, x: 0.01 },
  stab: { semi: 1.0, root: 0.72, tip: 0.33, sweep: 33, dih: 6 },
  wing: { x: 0.585, root: 0.165, tip: 0.22, sweep: 31.5, dih: 5.5, winglet: 'tall' },
  eng: { kind: 'fan', at: [0.33], dia: 3.1, len: 1.9 },
  bogie: 2,
  win: { y: -0.16, d: 0.4, pitch: 0.53 },
}

const REAR: Family = {
  ...NARROW, len: 36.2, span: 24.9, D: 2.69, nose: 1.6, chin: 1.25, tipY: 0.12, bluff: 0.42, tail: 0.27, up: 0.33, endTop: -0.45, endBot: -0.2,
  tTail: true,
  fin: { h: 1.4, root: 1.25, tip: 0.66, sweep: 42, dorsal: 0.25, x: 0.012 },
  stab: { semi: 1.05, root: 0.55, tip: 0.45, sweep: 33, dih: -2 },
  wing: { x: 0.56, root: 0.15, tip: 0.3, sweep: 26, dih: 3, winglet: 'small' },
  eng: { kind: 'rear', at: [0.235], dia: 1.4, len: 2.6 },
  bogie: 1,
  win: { y: -0.12, d: 0.3, pitch: 0.58 },
}

const TPROP: Family = {
  ...NARROW, len: 27.2, span: 27.05, D: 2.6, nose: 1.4, chin: 1.0, tipY: 0.15, bluff: 0.45, tail: 0.28, up: 0.32, endTop: -0.5, endBot: -0.1,
  tTail: true,
  fin: { h: 1.7, root: 1.15, tip: 0.55, sweep: 33, dorsal: 1.1, x: 0.012 },
  stab: { semi: 1.0, root: 0.6, tip: 0.55, sweep: 8, dih: 0 },
  wing: { high: true, x: 0.56, root: 0.093, tip: 0.6, sweep: 3, dih: 2.5, winglet: 'none' },
  eng: { kind: 'prop', at: [0.3], dia: 1.05, len: 4.3, prop: 3.93, ahead: 1.9 },
  sponson: true,
  bogie: 1,
  win: { y: -0.12, d: 0.32, pitch: 0.76 },
}

const BIZ: Family = {
  ...REAR, len: 30.4, span: 30.4, D: 2.6, nose: 2.25, chin: 1.65, tipY: 0.04, bluff: 0.22, tail: 0.3, up: 0.36, endTop: -0.42, endBot: -0.18,
  fin: { h: 1.5, root: 1.35, tip: 0.6, sweep: 48, dorsal: 0.3, x: 0.008 },
  stab: { semi: 1.05, root: 0.55, tip: 0.45, sweep: 35, dih: 2 },
  wing: { x: 0.575, root: 0.19, tip: 0.27, sweep: 34, dih: 3, winglet: 'blended' },
  eng: { kind: 'rear', at: [0.24], dia: 1.6, len: 3.0 },
  win: { y: -0.1, d: 0.5, pitch: 1.25 },
}

/** Families, from the type designator; `null` falls back to the drawing class. */
const FAMILIES: [RegExp, Family][] = [
  // Boeing 747: the hump. The -8 has a longer upper deck.
  [/^(B748|B74S)/, { ...WIDE, len: 76.3, span: 68.4, D: 6.5, nose: 1.55, chin: 1.2, tipY: 0.24, bluff: 0.6, tail: 0.21, hump: { x: 0.56, h: 0.27 }, fin: { h: 1.6, root: 1.05, tip: 0.34, sweep: 47, dorsal: 0.3, x: 0.02 }, wing: { x: 0.585, root: 0.2, tip: 0.24, sweep: 39, dih: 7, winglet: 'none' }, eng: { kind: 'fan', at: [0.37, 0.66], dia: 3.2, len: 1.8 }, bogie: 2 }],
  [/^(B74|BLCF)/, { ...WIDE, len: 70.6, span: 64.4, D: 6.5, nose: 1.55, chin: 1.2, tipY: 0.24, bluff: 0.6, tail: 0.21, hump: { x: 0.585, h: 0.27 }, fin: { h: 1.6, root: 1.05, tip: 0.34, sweep: 47, dorsal: 0.3, x: 0.02 }, wing: { x: 0.585, root: 0.2, tip: 0.24, sweep: 39, dih: 7, winglet: 'canted' }, eng: { kind: 'fan', at: [0.37, 0.66], dia: 2.85, len: 1.9 }, bogie: 2 }],
  // A380: a full-length upper deck, a very round nose, four big fans.
  [/^A38/, { ...WIDE, len: 72.7, span: 79.8, D: 8.4, nose: 1.0, chin: 0.72, tipY: 0.2, bluff: 0.9, tail: 0.25, up: 0.32, endTop: -0.45, endBot: -0.18, decks: 2, fin: { h: 1.5, root: 1.3, tip: 0.36, sweep: 42, dorsal: 0.3, x: 0.012 }, stab: { semi: 1.1, root: 0.72, tip: 0.3, sweep: 35, dih: 6 }, wing: { x: 0.6, root: 0.24, tip: 0.22, sweep: 33.5, dih: 5.5, winglet: 'fence' }, eng: { kind: 'fan', at: [0.36, 0.63], dia: 3.5, len: 1.75 }, bogie: 3, cockpit: 0.75 }],
  // Boeing twins.
  [/^B77/, { ...WIDE, len: 73.9, span: 64.8, D: 6.2, nose: 1.3, chin: 1.05, tipY: 0.15, bluff: 0.55, tail: 0.21, endTop: -0.62, endBot: -0.02, fin: { h: 1.55, root: 1.12, tip: 0.36, sweep: 41, dorsal: 0.3, x: 0.008 }, wing: { x: 0.57, root: 0.17, tip: 0.17, sweep: 31.6, dih: 6, winglet: 'none' }, eng: { kind: 'fan', at: [0.31], dia: 4.0, len: 1.75 }, bogie: 3 }],
  [/^B78/, { ...WIDE, len: 62.8, span: 60.1, D: 5.9, nose: 1.5, chin: 1.15, tipY: 0.06, bluff: 0.35, tail: 0.22, endTop: -0.5, endBot: -0.15, fin: { h: 1.5, root: 1.05, tip: 0.34, sweep: 43, dorsal: 0.3, x: 0.01 }, wing: { x: 0.565, root: 0.16, tip: 0.17, sweep: 32, dih: 7, winglet: 'none' }, eng: { kind: 'fan', at: [0.31], dia: 3.3, len: 1.8 }, bogie: 2 }],
  [/^(B76|E767|KC46)/, { ...WIDE, len: 54.9, span: 47.6, D: 5.41, nose: 1.3, chin: 1.05, tipY: 0.16, fin: { h: 1.6, root: 1.05, tip: 0.36, sweep: 39, dorsal: 0.35, x: 0.01 }, wing: { x: 0.565, root: 0.17, tip: 0.24, sweep: 31.5, dih: 6, winglet: 'none' }, eng: { kind: 'fan', at: [0.32], dia: 2.9, len: 1.85 }, bogie: 2 }],
  [/^B75/, { ...NARROW, len: 47.3, span: 38.0, D: 4.1, nose: 1.35, chin: 1.1, tipY: 0.24, bluff: 0.5, fin: { h: 1.85, root: 1.0, tip: 0.34, sweep: 38, dorsal: 0.45, x: 0.008 }, wing: { x: 0.565, root: 0.165, tip: 0.24, sweep: 27, dih: 5, winglet: 'none' }, eng: { kind: 'fan', at: [0.33], dia: 2.6, len: 1.9 }, bogie: 2 }],
  [/^(B73|B3.M)/, { ...NARROW, len: 39.5, span: 35.9, D: 4.01, nose: 1.15, chin: 0.95, tipY: 0.16, bluff: 0.5, tail: 0.2, up: 0.3, endTop: -0.5, endBot: -0.25, fin: { h: 1.85, root: 0.95, tip: 0.32, sweep: 37, dorsal: 0.65, x: 0.006 }, wing: { x: 0.575, root: 0.185, tip: 0.22, sweep: 27, dih: 6, winglet: 'blended' }, eng: { kind: 'fan', at: [0.32], dia: 2.05, len: 2.0 } }],
  // Airbus.
  [/^A35/, { ...WIDE, len: 66.8, span: 64.8, D: 6.1, nose: 1.4, chin: 1.1, tipY: 0.1, bluff: 0.55, fin: { h: 1.45, root: 1.15, tip: 0.36, sweep: 42, dorsal: 0.3, x: 0.01 }, wing: { x: 0.575, root: 0.17, tip: 0.2, sweep: 31.9, dih: 6, winglet: 'curved' }, eng: { kind: 'fan', at: [0.32], dia: 3.55, len: 1.8 }, bogie: 2, cockpit: 1.35 }],
  [/^A34/, { ...WIDE, eng: { kind: 'fan', at: [0.36, 0.64], dia: 2.3, len: 2.15 } }],
  [/^A33/, WIDE],
  [/^(A30|A310)/, { ...WIDE, len: 54.1, span: 44.8, wing: { ...WIDE.wing, winglet: 'fence' }, eng: { kind: 'fan', at: [0.35], dia: 2.8, len: 1.9 } }],
  [/^(A31[89]|A32|A2[01]N|C919)/, NARROW],
  [/^BCS/, { ...NARROW, len: 38.7, span: 35.1, D: 3.7, nose: 1.35, chin: 1.05, fin: { h: 1.85, root: 1.0, tip: 0.36, sweep: 38, dorsal: 0.45, x: 0.008 }, wing: { ...NARROW.wing, winglet: 'none' }, eng: { kind: 'fan', at: [0.33], dia: 2.3, len: 1.9 } }],
  // Embraer E-jets: underwing twins with a tall fin.
  [/^(E17|E19|E29|E75|E27)/, { ...NARROW, len: 31.7, span: 26.0, D: 3.35, nose: 1.35, chin: 1.05, tipY: 0.12, bluff: 0.5, fin: { h: 1.7, root: 1.05, tip: 0.4, sweep: 38, dorsal: 0.4, x: 0.008 }, wing: { x: 0.565, root: 0.17, tip: 0.26, sweep: 25, dih: 5, winglet: 'blended' }, eng: { kind: 'fan', at: [0.34], dia: 1.75, len: 2.0 } }],
  // Rear-engined jets.
  [/^(E13|E14|E45)/, { ...REAR, len: 29.9, span: 20.0, D: 2.28, nose: 2.0, chin: 1.4, tipY: 0.1, bluff: 0.3, fin: { h: 1.55, root: 1.3, tip: 0.6, sweep: 40, dorsal: 0.3, x: 0.012 }, wing: { x: 0.53, root: 0.14, tip: 0.3, sweep: 22, dih: 5, winglet: 'small' }, eng: { kind: 'rear', at: [0.225], dia: 1.25, len: 3.0 } }],
  [/^(MD8|MD9|DC9|B712|F100|F70|F28|TU54)/, { ...REAR, len: 45.1, span: 32.9, D: 3.61, nose: 1.45, chin: 1.1, tipY: 0.15, bluff: 0.45, fin: { h: 1.35, root: 1.45, tip: 0.62, sweep: 45, dorsal: 0.25, x: 0.01 }, wing: { x: 0.5, root: 0.17, tip: 0.24, sweep: 24.5, dih: 3, winglet: 'none' }, eng: { kind: 'rear', at: [0.215], dia: 1.75, len: 3.4 } }],
  [/^CRJ/, REAR],
  // Turboprops: high-wing airliners, and the low-wing twins (King Air, Saab 340, Jetstream).
  [/^DH8/, { ...TPROP, len: 32.8, span: 28.4, D: 2.69, nose: 1.5, fin: { h: 1.85, root: 1.0, tip: 0.6, sweep: 32, dorsal: 0.9, x: 0.012 }, eng: { kind: 'prop', at: [0.29], dia: 1.15, len: 7.0, prop: 4.11, ahead: 2.2 }, sponson: false }],
  [/^(BE20|B350|BE30|BE9L|BE9T|BE99|BE10|SF34|SB20|JS3|JS41|E120|B190|PAY)/, { ...TPROP, len: 14.2, span: 17.6, D: 1.85, nose: 1.8, chin: 1.3, tipY: 0.1, bluff: 0.35, fin: { h: 1.45, root: 1.2, tip: 0.55, sweep: 38, dorsal: 0.7, x: 0.01 }, wing: { x: 0.56, root: 0.14, tip: 0.5, sweep: 3, dih: 6, winglet: 'none' }, eng: { kind: 'prop', at: [0.3], dia: 0.85, len: 4.0, prop: 2.5, ahead: 1.6 }, win: { y: -0.12, d: 0.36, pitch: 0.9 }, sponson: false }],
  [/^AT[4-7]/, TPROP],
]

/** The class's family when the type isn't one of the above. */
const CLASS_FAMILY: Partial<Record<SideClass, Family>> = {
  narrow: NARROW,
  wide: WIDE,
  quad: { ...WIDE, eng: { kind: 'fan', at: [0.36, 0.64], dia: 2.6, len: 2.0 } },
  regional: REAR,
  smalljet: FAMILIES.find(([re]) => re.test('E175'))![1],
  turboprop: TPROP,
  bizjet: BIZ,
  generic: NARROW,
}

function familyFor(cls: SideClass, type: string): Family {
  for (const [re, f] of FAMILIES) if (re.test(type)) return f
  return CLASS_FAMILY[cls] ?? NARROW
}

/** A path traced as SVG and as sample points, so its top and bottom edges can be looked up by x. */
class Outline {
  d = ''
  pts: Pt[] = []
  private b: Bounds
  private at: Pt = [0, 0]
  constructor(b: Bounds) {
    this.b = b
  }
  private put(x: number, y: number) {
    this.pts.push([x, y])
    this.b.add(x, y)
  }
  M(x: number, y: number) {
    this.d += `M${n(x)} ${n(y)}`
    this.put(x, y)
    this.at = [x, y]
    return this
  }
  L(x: number, y: number) {
    this.d += `L${n(x)} ${n(y)}`
    this.put(x, y)
    this.at = [x, y]
    return this
  }
  C(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    const p0 = this.at
    for (let i = 1; i <= 20; i++) {
      const q = bez(p0, [x1, y1], [x2, y2], [x, y], i / 20)
      this.put(q[0], q[1])
    }
    this.d += `C${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(x)} ${n(y)}`
    this.at = [x, y]
    return this
  }
  Q(x1: number, y1: number, x: number, y: number) {
    const [x0, y0] = this.at
    return this.C(x0 + ((x1 - x0) * 2) / 3, y0 + ((y1 - y0) * 2) / 3, x + ((x1 - x) * 2) / 3, y + ((y1 - y) * 2) / 3, x, y)
  }
  Z() {
    this.d += 'Z'
    return this
  }
}

/** y along a polyline at x (linear between samples, held at the ends). */
function sampler(pts: Pt[]): (x: number) => number {
  const s = [...pts].sort((a, b) => a[0] - b[0])
  return (x: number) => {
    if (x <= s[0][0]) return s[0][1]
    for (let i = 1; i < s.length; i++) {
      if (s[i][0] >= x) {
        const [x0, y0] = s[i - 1]
        const [x1, y1] = s[i]
        return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
      }
    }
    return s[s.length - 1][1]
  }
}

const rad = (deg: number) => (deg * Math.PI) / 180
const lerp = (a: number, b: number, k: number) => a + (b - a) * k

type Body = { d: string; top: (x: number) => number; bot: (x: number) => number; y0: number; y1: number }

/** The fuselage: tail cone, roof (with the 747's upper deck), nose, keel and the belly's upsweep. */
function fuselage(dw: Drawing, f: Family, L: number): Body {
  const { D } = f
  const r = D / 2
  const hump = f.hump ? f.hump.h * D : 0
  const roof = -r - hump
  const tl = f.tail * L
  const ul = f.up * L
  const nl = f.nose * D
  const cl = f.chin * D
  const tipY = f.tipY * r
  const o = new Outline(dw.b)
  o.M(0, f.endTop * r)
  o.C(tl * 0.35, lerp(f.endTop * r, -r, 0.75), tl * 0.68, -r, tl, -r)
  if (f.hump) {
    const hx = f.hump.x * L
    const hl = D * 1.35
    o.L(hx, -r)
    o.C(hx + hl * 0.5, -r, hx + hl * 0.42, roof, hx + hl, roof)
  }
  o.L(L - nl, roof)
  const drop = tipY - roof
  o.C(L - nl * (0.56 - 0.18 * f.bluff), roof, L, tipY - drop * (0.22 + 0.36 * f.bluff), L, tipY)
  const tipIndex = o.pts.length
  o.C(L, tipY + (r - tipY) * (0.3 + 0.4 * f.bluff), L - cl * (0.55 - 0.15 * f.bluff), r, L - cl, r)
  o.L(ul, r)
  o.C(ul * 0.55, r, ul * 0.18, lerp(f.endBot * r, r, 0.4), 0, f.endBot * r)
  o.Z()
  return { d: o.d, top: sampler(o.pts.slice(0, tipIndex)), bot: sampler(o.pts.slice(tipIndex - 1)), y0: roof, y1: r }
}

/** Rounded rectangle outline (a door). */
function doorPath(dw: Drawing, x: number, y: number, w: number, h: number): string {
  const k = w * 0.32
  const p = dw.pen()
  p.M(x - w / 2 + k, y)
  p.L(x + w / 2 - k, y)
  p.Q(x + w / 2, y, x + w / 2, y + k)
  p.L(x + w / 2, y + h - k)
  p.Q(x + w / 2, y + h, x + w / 2 - k, y + h)
  p.L(x - w / 2 + k, y + h)
  p.Q(x - w / 2, y + h, x - w / 2, y + h - k)
  p.L(x - w / 2, y + k)
  p.Q(x - w / 2, y, x - w / 2 + k, y)
  return p.Z().d
}

/** A row of round windows between x1 and x2. */
function windows(dw: Drawing, x1: number, x2: number, y: number, d: number, pitch: number) {
  if (x2 - x1 < pitch * 2) return
  dw.line('windows', [
    [x1, y],
    [x2, y],
  ], d, [0.001, pitch], true)
}

/** A wing or tailplane seen from the side: the near half, edge-on, running back and up from its root. */
function planform(dw: Drawing, role: PartRole, o: { x: number; y: number; semi: number; root: number; tip: number; sweep: number; dih: number; thick: number }) {
  const tx = o.x - o.semi * Math.tan(rad(o.sweep))
  const ty = o.y - o.semi * Math.tan(rad(o.dih))
  const t = o.thick
  const p = dw.pen()
  p.M(o.x, o.y - t * 0.5)
  p.L(tx, ty - t * 0.22)
  p.Q(tx - o.tip * 0.08, ty - t * 0.3, tx - o.tip * 0.2, ty - t * 0.22)
  p.L(tx - o.tip, ty)
  p.L(o.x - o.root, o.y + t * 0.18)
  p.L(o.x - o.root * 0.12, o.y + t * 0.5)
  p.Q(o.x + t * 0.45, o.y + t * 0.4, o.x, o.y - t * 0.5)
  p.Z()
  dw.fill(role, p.d)
  return { tx, ty }
}

/** Wingtip device standing on the tip chord. */
function winglet(dw: Drawing, kind: Winglet, tx: number, ty: number, tc: number, span: number) {
  if (kind === 'none') return
  if (kind === 'fence') {
    const h = Math.max(0.5, span * 0.012)
    dw.fill('wing', dw.pen().poly([
      [tx + tc * 0.05, ty],
      [tx - tc * 0.55, ty - h],
      [tx - tc * 0.85, ty - h],
      [tx - tc * 0.95, ty],
      [tx - tc * 0.85, ty + h * 0.7],
      [tx - tc * 0.6, ty + h * 0.7],
    ]).d)
    return
  }
  const H = { blended: 0.07, sharklet: 0.067, canted: 0.03, tall: 0.045, curved: 0.032, small: 0.05 }[kind] * span
  const sweep = Math.tan(rad(kind === 'canted' ? 45 : kind === 'curved' ? 55 : 38))
  const topC = tc * (kind === 'tall' ? 0.42 : kind === 'curved' ? 0.25 : 0.32)
  const leTop: Pt = [tx - tc * 0.12 - H * sweep, ty - H]
  const p = dw.pen()
  p.M(tx + tc * 0.02, ty + H * 0.02)
  if (kind === 'canted' || kind === 'tall') p.L(tx - tc * 0.1, ty - H * 0.12)
  else p.Q(tx - tc * 0.02, ty - H * (kind === 'curved' ? 0.15 : 0.45), leTop[0] + H * sweep * 0.25, ty - H * 0.82)
  p.L(leTop[0], leTop[1])
  p.L(leTop[0] - topC, leTop[1] + H * 0.03)
  p.Q(tx - tc * 0.95, ty - H * 0.3, tx - tc, ty)
  p.Z()
  dw.fill('wing', p.d)
}

/** Turbofan nacelle, intake to the right: fan cowl, core cowl and exhaust plug. */
function nacelle(dw: Drawing, fx: number, cy: number, len: number, dia: number) {
  const R = dia / 2
  const fan = len * 0.66
  // Core cowl and plug first, so the fan cowl overlaps them.
  {
    const p = dw.pen()
    p.M(fx - fan + len * 0.04, cy - R * 0.62)
    p.C(fx - len * 0.8, cy - R * 0.58, fx - len * 0.9, cy - R * 0.46, fx - len * 0.94, cy - R * 0.38)
    p.L(fx - len * 0.94, cy + R * 0.38)
    p.C(fx - len * 0.9, cy + R * 0.46, fx - len * 0.8, cy + R * 0.58, fx - fan + len * 0.04, cy + R * 0.62)
    p.Z()
    dw.fill('core', p.d)
    const q = dw.pen()
    q.M(fx - len * 0.935, cy - R * 0.3)
    q.Q(fx - len * 1.02, cy - R * 0.12, fx - len * 1.06, cy)
    q.Q(fx - len * 1.02, cy + R * 0.12, fx - len * 0.935, cy + R * 0.3)
    q.Z()
    dw.fill('exhaust', q.d)
  }
  const p = dw.pen()
  p.M(fx, cy - R * 0.9)
  p.C(fx - fan * 0.15, cy - R * 1.02, fx - fan * 0.5, cy - R * 1.01, fx - fan, cy - R * 0.8)
  p.L(fx - fan, cy + R * 0.8)
  p.C(fx - fan * 0.5, cy + R * 1.01, fx - fan * 0.15, cy + R * 1.02, fx, cy + R * 0.9)
  p.Q(fx + R * 0.1, cy, fx, cy - R * 0.9)
  p.Z()
  dw.fill('nacelle', p.d)
  // The intake lip catching the light, and the dark of the fan face just inside it.
  dw.fill('intake', dw.pen().ellipse(fx + R * 0.015, cy, R * 0.07, R * 0.84).d)
  dw.fill('lip', dw.pen().ellipse(fx - R * 0.05, cy, R * 0.07, R * 0.88).d)
}

/** Turboprop nacelle with its propeller: the disc edge-on, two blades and the spinner. */
function propNacelle(dw: Drawing, fx: number, cy: number, len: number, dia: number, prop: number) {
  const R = dia / 2
  const p = dw.pen()
  p.M(fx, cy - R * 0.62)
  p.C(fx - len * 0.08, cy - R * 1.02, fx - len * 0.35, cy - R * 1.02, fx - len * 0.55, cy - R * 0.92)
  p.C(fx - len * 0.8, cy - R * 0.8, fx - len * 0.95, cy - R * 0.4, fx - len, cy - R * 0.1)
  p.L(fx - len, cy + R * 0.25)
  p.C(fx - len * 0.8, cy + R * 0.9, fx - len * 0.4, cy + R * 1.08, fx - len * 0.15, cy + R * 1.0)
  p.C(fx - len * 0.04, cy + R * 0.95, fx, cy + R * 0.8, fx, cy + R * 0.62)
  p.Z()
  dw.fill('nacelle', p.d)
  const pr = prop / 2
  const px = fx + R * 0.35
  dw.fill('prop', dw.pen().ellipse(px, cy, pr * 0.1, pr).d)
  for (const s of [-1, 1]) {
    const p2 = dw.pen()
    p2.M(px - R * 0.05, cy + s * R * 0.3)
    p2.C(px + pr * 0.1, cy + s * pr * 0.35, px + pr * 0.08, cy + s * pr * 0.8, px + pr * 0.02, cy + s * pr * 0.98)
    p2.L(px - pr * 0.035, cy + s * pr * 0.97)
    p2.C(px - pr * 0.04, cy + s * pr * 0.6, px - pr * 0.07, cy + s * pr * 0.35, px - R * 0.15, cy + s * R * 0.3)
    p2.Z()
    dw.fill('blade', p2.d)
  }
  const s = R * 0.62
  const q = dw.pen()
  q.M(fx - s * 0.05, cy - s)
  q.C(fx + s * 0.9, cy - s * 0.95, fx + s * 1.5, cy - s * 0.35, fx + s * 1.6, cy)
  q.C(fx + s * 1.5, cy + s * 0.35, fx + s * 0.9, cy + s * 0.95, fx - s * 0.05, cy + s)
  q.Z()
  dw.fill('spinner', q.d)
}

/** A gear leg with its wheels on the ground line. */
function leg(dw: Drawing, x: number, top: number, ground: number, wr: number, wheels: number, w: number) {
  const cy = ground - wr
  const spread = wr * 2.25
  dw.line('gear', [
    [x, top],
    [x, cy],
  ], w)
  if (wheels > 1)
    dw.line('gear', [
      [x - ((wheels - 1) / 2) * spread, cy],
      [x + ((wheels - 1) / 2) * spread, cy],
    ], w * 0.8)
  for (let i = 0; i < wheels; i++) {
    const wx = x + (i - (wheels - 1) / 2) * spread
    dw.fill('wheel', dw.pen().ellipse(wx, cy, wr, wr).d)
    dw.fill('wheelhub', dw.pen().ellipse(wx, cy, wr * 0.42, wr * 0.42).d)
  }
}

/** Every jet and turboprop airliner, regional and business jet. Returns the fuselage height. */
function airliner(dw: Drawing, cls: SideClass, c: Ctx, out: { body?: [number, number] }): number {
  const { L } = c
  let f = familyFor(cls, c.type)
  // Business jets come in all sizes; their fuselage follows the length.
  if (f === BIZ) {
    const D = clamp(L * 0.086, 1.6, 2.7)
    f = { ...BIZ, D, eng: { ...BIZ.eng, dia: clamp(L * 0.05, 0.9, 1.65) }, win: { y: -0.1, d: D * 0.17, pitch: D * 0.46 } }
  }
  const { D } = f
  const r = D / 2
  const span = clamp(c.span ?? f.span, L * 0.55, L * 1.35)
  const body = fuselage(dw, f, L)
  out.body = [body.y0, body.y1]
  const nl = f.nose * D

  // Fin, drawn first so the fuselage covers its root.
  const fh = f.fin.h * D
  const froot = f.fin.root * fh
  const fx = f.fin.x * L
  const rootLE: Pt = [fx + froot, body.top(fx + froot)]
  const fyb = body.top(fx + froot * 0.5)
  const tipLE: Pt = [rootLE[0] - fh * Math.tan(rad(f.fin.sweep)), fyb - fh]
  const ftip = f.fin.tip * froot
  {
    const p = dw.pen()
    p.M(fx, body.top(fx) + r * 0.5)
    p.L(tipLE[0] - ftip, tipLE[1] + fh * 0.012)
    p.Q(tipLE[0] - ftip * 0.25, tipLE[1] - fh * 0.012, tipLE[0], tipLE[1])
    const on: Pt = [lerp(tipLE[0], rootLE[0], 0.78), lerp(tipLE[1], rootLE[1], 0.78)]
    p.L(on[0], on[1])
    const dx = rootLE[0] + froot * f.fin.dorsal
    p.Q(rootLE[0], rootLE[1], dx, body.top(dx) + D * 0.004)
    p.L(dx, body.top(dx) + r * 0.5)
    p.Z()
    dw.fill('fin', p.d)
  }
  const stabSemi = f.stab.semi * fh
  const stabRoot = f.stab.root * froot
  if (f.tTail) {
    planform(dw, 'stab', { x: tipLE[0] + ftip * 0.05, y: tipLE[1] + fh * 0.04, semi: stabSemi, root: stabRoot, tip: stabRoot * f.stab.tip, sweep: f.stab.sweep, dih: f.stab.dih, thick: D * 0.1 })
  }

  // Belly fairing (or a turboprop's gear sponson), shaded with the fuselage.
  const wx = f.wing.x * L
  const rc = f.wing.root * L
  if (!f.wing.high || f.sponson) {
    const x1 = wx + rc * (f.wing.high ? 0.1 : 0.22)
    const x2 = wx - rc * (f.wing.high ? 1.9 : 1.2)
    const bulge = D * (f.wing.high ? 0.1 : 0.065)
    const p = dw.pen()
    p.M(x1, r - D * 0.08)
    p.C(x1 - (x1 - x2) * 0.15, r + bulge, x2 + (x1 - x2) * 0.25, r + bulge, x2, r - D * 0.08)
    p.Z()
    dw.fill('fairing', p.d)
  }
  dw.fill('fuselage', body.d)

  // Doors, and the windows between them.
  const doorW = D < 3 ? 0.78 : D < 5 ? 0.86 : 1.07
  const doorH = Math.min(1.9, D * (D < 3 ? 0.62 : 0.45))
  const winY = f.win.y * r
  const front = L - nl - doorW * 1.1
  const rear = f.tail * L * (f.eng.kind === 'rear' ? 1.25 : 0.95) + doorW
  const doors = cls === 'bizjet' || f === BIZ ? [front] : D > 5 && !f.decks ? [rear, wx + rc * 0.25 + doorW, front] : [rear, front]
  const lowDeck = f.decks ? r * 0.2 : winY
  for (const x of doors) dw.fill('door', doorPath(dw, x, lowDeck - doorH * 0.32, doorW, doorH))
  const edges = [...doors].sort((a, b) => a - b)
  const runs: [number, number][] = []
  let from = Math.max(edges[0] === rear ? rear + doorW : f.tail * L * 0.9, f.eng.kind === 'rear' ? f.eng.at[0] * L + f.eng.len * f.eng.dia * 0.6 : 0)
  for (const x of edges) {
    if (x > from) runs.push([from, x - doorW * 0.9])
    from = x + doorW * 0.9
  }
  if (f.decks) {
    for (const [a, b] of runs) windows(dw, a, b, lowDeck, f.win.d, f.win.pitch)
    windows(dw, f.tail * L * 1.05, L - nl * 0.95, -r * 0.5, f.win.d, f.win.pitch)
  } else for (const [a, b] of runs) windows(dw, a, b, winY, f.win.d, f.win.pitch)
  if (f.hump) windows(dw, f.hump.x * L + D * 1.35, L - nl * 0.98, -r - f.hump.h * D * 0.45, f.win.d, f.win.pitch)

  // Flight-deck side windows, following the slope of the nose.
  {
    const k = f.cockpit ?? 1
    const xa = L - nl * (0.62 + 0.12 * (k - 1))
    const xb = L - nl * 0.17
    const off = D * 0.075
    const h = D * 0.12 * k
    const p = dw.pen()
    const steps = 8
    for (let i = 0; i <= steps; i++) {
      const x = lerp(xa, xb, i / steps)
      if (i) p.L(x, body.top(x) + off)
      else p.M(x, body.top(x) + off)
    }
    const yb = body.top(xa) + off + h
    p.L(Math.min(xb, xb - (body.top(xb) + off - yb) * -0.25), Math.max(body.top(xb) + off + h * 0.35, yb - h * 0.15))
    p.L(xa, yb)
    p.Z()
    dw.fill('glass', p.d)
    const px = lerp(xa, xb, 0.42)
    dw.line('pillar', [
      [px, body.top(px) + off * 0.9],
      [px - h * 0.08, yb + h * 0.05],
    ], D * 0.018)
  }

  if (!f.tTail) {
    const sx = fx + froot * 0.92
    const sy = lerp(body.top(sx), body.bot(sx), 0.42)
    planform(dw, 'stab', { x: sx, y: sy, semi: stabSemi, root: stabRoot, tip: stabRoot * f.stab.tip, sweep: f.stab.sweep, dih: f.stab.dih, thick: D * 0.06 })
  }

  // Wing and engines.
  const semi = span / 2 - r
  const tcw = rc * f.wing.tip
  const wy = f.wing.high ? body.top(wx) + D * 0.07 : body.bot(wx) - D * 0.19
  const wingThick = D * (f.wing.high ? 0.13 : 0.1)
  // Dihedral is drawn at a little over half its true angle: seen exactly side-on the near tip climbs above the
  // cabin and reads as a second fin; a touch of perspective from below (as in most profile art) keeps it low.
  const dih = f.wing.dih * 0.55
  const at = (s: number) => {
    const e = Math.max(0, s * (span / 2) - r)
    return { x: wx - e * Math.tan(rad(f.wing.sweep)), y: wy - e * Math.tan(rad(dih)), chord: lerp(rc, tcw, e / semi) }
  }

  // Landing gear goes behind the near engines and the wing.
  let lowest = r
  const engines: (() => void)[] = []
  if (f.eng.kind === 'fan') {
    for (const s of f.eng.at) {
      const w = at(s)
      const len = f.eng.len * f.eng.dia
      const R = f.eng.dia / 2
      const fxn = w.x + len * 0.55
      const cy = w.y + wingThick * 0.25 + R * 0.92
      lowest = Math.max(lowest, cy + R)
      engines.push(() => {
        dw.fill('pylon', dw.pen().poly([
          [fxn - len * 0.32, cy - R * 0.85],
          [w.x + w.chord * 0.02, w.y + wingThick * 0.1],
          [w.x - w.chord * 0.55, w.y + wingThick * 0.2],
          [fxn - len * 1.08, cy - R * 0.25],
        ]).d)
        nacelle(dw, fxn, cy, len, f.eng.dia)
      })
    }
  } else if (f.eng.kind === 'rear') {
    const len = f.eng.len * f.eng.dia
    const cx = f.eng.at[0] * L
    const cy = -r * 0.28
    engines.push(() => {
      dw.fill('pylon', dw.pen().poly([
        [cx + len * 0.2, cy + f.eng.dia * 0.2],
        [cx - len * 0.35, cy + f.eng.dia * 0.2],
        [cx - len * 0.3, cy + f.eng.dia * 0.62],
        [cx + len * 0.12, cy + f.eng.dia * 0.62],
      ]).d)
      nacelle(dw, cx + len / 2, cy, len, f.eng.dia)
    })
  } else {
    const w = at(f.eng.at[0])
    const len = f.eng.len
    const R = f.eng.dia / 2
    const fxn = w.x + (f.eng.ahead ?? 1.5)
    const cy = f.wing.high ? w.y + R * 1.05 : w.y - R * 0.15
    lowest = Math.max(lowest, cy + R)
    engines.push(() => propNacelle(dw, fxn, cy, len, f.eng.dia, f.eng.prop ?? f.eng.dia * 3.5))
  }

  if (c.gear) {
    const wr = clamp(D * 0.13, 0.28, 0.68)
    const ground = Math.max(r + D * (cls === 'bizjet' ? 0.36 : 0.3), lowest + Math.max(0.35, D * 0.08))
    const sw = clamp(D * 0.055, 0.11, 0.4)
    const inNacelle = f.eng.kind === 'prop' && !f.sponson
    const gx = f.wing.high && f.sponson ? wx - rc * 0.55 : inNacelle ? wx - rc * 0.35 : wx - rc * 0.72
    const top = inNacelle ? lowest - D * 0.05 : body.bot(gx) - D * 0.1
    dw.line('gear', [
      [gx, lerp(top, ground - wr, 0.45)],
      [gx + D * 0.35, top],
    ], sw * 0.7)
    leg(dw, gx, top, ground, wr, f.bogie, sw)
    if (f.decks) leg(dw, gx + wr * 7.5, top, ground, wr, 2, sw)
    const nx = L - f.chin * D * 0.78
    leg(dw, nx, body.bot(nx) - D * 0.08, ground, wr * 0.72, 1, sw * 0.8)
  }

  if (f.wing.high) {
    for (const e of engines) e()
    const t = planform(dw, 'wing', { x: wx, y: wy, semi, root: rc, tip: tcw, sweep: f.wing.sweep, dih, thick: wingThick })
    winglet(dw, f.wing.winglet, t.tx, t.ty, tcw, span)
  } else {
    const t = planform(dw, 'wing', { x: wx, y: wy, semi, root: rc, tip: tcw, sweep: f.wing.sweep, dih, thick: wingThick })
    winglet(dw, f.wing.winglet, t.tx, t.ty, tcw, span)
    for (const e of engines) e()
  }
  return D
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
  if (/^(C1[5-9]|C2[0-9]|C82|PA18|PA20|PA22|KODI|PC6)/.test(c.type) || !c.type) {
    // Strut, then the high wing on the cabin roof.
    dw.line('strut', [
      [L * 0.66, -r * 1.02],
      [L * 0.6, r * 0.55],
    ], 0.09)
    sliver(dw, 'wing', { x: L * 0.73, y: -r * 1.04, root: L * 0.19, tip: L * 0.17, sweep: L * 0.01, rise: r * 0.1, thick: r * 0.18 })
  } else {
    // Low wing (Piper, Cirrus, Diamond, Beech), with a little dihedral.
    sliver(dw, 'wing', { x: L * 0.72, y: r * 0.6, root: L * 0.2, tip: L * 0.14, sweep: L * 0.02, rise: r * 0.45, thick: r * 0.2 })
  }
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
  /** ICAO type designator, which picks the family (747 hump, A380 decks, A340 quad, CRJ tail engines...). */
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
  const span = input.spanM && Number.isFinite(input.spanM) ? input.spanM : null
  const key = `${cls}|${type}|${L}|${span ?? ''}|${gear}`
  const hit = cache.get(key)
  if (hit) return hit

  const dw = new Drawing()
  const c: Ctx = { L, type, gear, span }
  const out: { body?: [number, number] } = {}
  let H: number
  switch (cls) {
    case 'light':
      H = lightSingle(dw, c)
      break
    case 'lighttwin':
      H = lightTwin(dw, c)
      break
    case 'heli':
      H = helicopter(dw, c, clamp(span ?? L * 0.86, L * 0.6, L * 1.2))
      break
    default:
      H = airliner(dw, cls, c, out)
  }
  const pad = L * 0.015
  const { x0, y0, x1, y1 } = dw.b
  const profile: SideProfile = {
    cls,
    length: L,
    height: H,
    box: [x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2],
    body: out.body ?? [-H * 0.65, H * 0.5],
    parts: dw.parts,
  }
  cache.set(key, profile)
  return profile
}
