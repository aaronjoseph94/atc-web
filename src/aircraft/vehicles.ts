/**
 * Airside vehicles, seen from above: a follow-me / operations car, a pushback
 * tug, a fuel or service truck and an airport fire engine.
 *
 * Unlike the aircraft (which are shaded from traced outlines, `render.ts`),
 * these are small enough to be drawn directly: a few rounded boxes in the
 * colours such vehicles really wear, with dark glass, wheels and one feature
 * that tells them apart at a glance (the car's roof light bar, the tug's flat
 * deck and big wheels, the tanker's silver barrel, the fire engine's red body
 * and roof monitor). Drawn for this project; see CREDITS.md.
 *
 * Units are metres, nose toward -y, like the aircraft outlines.
 */

export type VehicleKind = 'car' | 'tug' | 'truck' | 'fire'

export const VEHICLE_KINDS: VehicleKind[] = ['car', 'tug', 'truck', 'fire']

/** Overall size, metres (width across, length nose to tail). */
export const VEHICLE_SIZE: Record<VehicleKind, { width: number; length: number }> = {
  car: { width: 2.0, length: 4.9 },
  tug: { width: 3.0, length: 7.2 },
  truck: { width: 2.6, length: 10.4 },
  fire: { width: 3.0, length: 11.6 },
}

/** The longest vehicle drawn, metres: the map icon's box is sized for it. */
export const VEHICLE_MAX_LENGTH = Math.max(...VEHICLE_KINDS.map((k) => VEHICLE_SIZE[k].length))

/**
 * Which vehicle to draw. The transponder only says "emergency vehicle" (C1) or
 * "service vehicle" (C2); the callsign airports give their vehicles usually
 * says the rest (`TUG 12`, `FUEL 3`, `OPS 1`). Anything unrecognised is the
 * operations car.
 */
export function vehicleKind(a: { category?: string | null; callsign?: string | null }): VehicleKind {
  const cs = (a.callsign ?? '').toUpperCase()
  if ((a.category ?? '').toUpperCase() === 'C1' || /FIRE|ARFF|RESCUE|CRASH|RFF/.test(cs)) return 'fire'
  if (/TUG|TOW|PUSH|TRACTOR/.test(cs)) return 'tug'
  if (/FUEL|TANK|TRUCK|SWEEP|PLOW|PLOUGH|SNOW|DEICE|DE-ICE|BUS|CATER|LIFT|CARGO/.test(cs)) return 'truck'
  return 'car'
}

/**
 * How big each kind is drawn relative to the longest: real proportions,
 * compressed (the same power the aircraft icons use) so that a car is still
 * a readable shape next to a fire engine rather than a speck.
 */
export function vehicleDrawScale(kind: VehicleKind): number {
  return Math.max(0.62, (VEHICLE_SIZE[kind].length / VEHICLE_MAX_LENGTH) ** 0.62)
}

type Ctx = CanvasRenderingContext2D

function box(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2))
}

/** The outline of a vehicle as a path (for the silhouette that casts its shadow). */
export function vehicleOutline(ctx: Ctx, kind: VehicleKind) {
  const { width: w, length: l } = VEHICLE_SIZE[kind]
  box(ctx, -w / 2, -l / 2, w, l, kind === 'car' ? 0.75 : 0.45)
}

const GLASS = '#1D2A3E'
const TYRE = '#14171D'

function wheels(ctx: Ctx, w: number, ys: number[], tw: number, tl: number) {
  ctx.fillStyle = TYRE
  for (const y of ys) {
    for (const side of [-1, 1]) {
      box(ctx, side * (w / 2) - tw / 2, y - tl / 2, tw, tl, tw * 0.3)
      ctx.fill()
    }
  }
}

/** A body panel with a soft top-light: lighter along the middle, darker toward the sides. */
function panel(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, base: string, edge: string) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0)
  g.addColorStop(0, edge)
  g.addColorStop(0.28, base)
  g.addColorStop(0.72, base)
  g.addColorStop(1, edge)
  ctx.fillStyle = g
  box(ctx, x, y, w, h, r)
  ctx.fill()
}

/**
 * Draw a vehicle, centred on the origin, nose toward -y, in metres (the
 * caller sets the scale). `selected` adds the yellow of a highlighted
 * aircraft as a rim, so the vehicle keeps its own colours.
 */
export function drawVehicle(ctx: Ctx, kind: VehicleKind, selected = false) {
  const { width: w, length: l } = VEHICLE_SIZE[kind]
  const top = -l / 2
  // A dark rim so the shape holds on any map colour (or the selection yellow).
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineWidth = selected ? 0.7 : 0.36
  ctx.strokeStyle = selected ? '#F6C252' : 'rgba(10,14,28,0.55)'
  vehicleOutline(ctx, kind)
  ctx.stroke()
  ctx.restore()

  if (kind === 'car') {
    wheels(ctx, w, [top + 0.95, top + l - 1.0], 0.34, 0.8)
    panel(ctx, -w / 2 + 0.06, top, w - 0.12, l, 0.75, '#F4CB45', '#B98D1E')
    // Windscreen, roof, rear window.
    ctx.fillStyle = GLASS
    ctx.beginPath()
    ctx.moveTo(-0.78, top + 1.55)
    ctx.lineTo(0.78, top + 1.55)
    ctx.lineTo(0.68, top + 2.15)
    ctx.lineTo(-0.68, top + 2.15)
    ctx.closePath()
    ctx.fill()
    box(ctx, -0.66, top + 3.5, 1.32, 0.42, 0.12)
    ctx.fill()
    // The follow-me light bar across the roof.
    ctx.fillStyle = '#20242C'
    box(ctx, -0.74, top + 2.55, 1.48, 0.5, 0.1)
    ctx.fill()
    ctx.fillStyle = '#FF8A1F'
    box(ctx, -0.64, top + 2.63, 0.52, 0.34, 0.08)
    ctx.fill()
    box(ctx, 0.12, top + 2.63, 0.52, 0.34, 0.08)
    ctx.fill()
    return
  }

  if (kind === 'tug') {
    // Big wheels standing proud of a low, flat deck.
    wheels(ctx, w - 0.1, [top + 1.5, top + l - 1.5], 0.62, 1.7)
    panel(ctx, -w / 2 + 0.3, top, w - 0.6, l, 0.45, '#ECEEF2', '#9CA3B0')
    // Hazard stripe across the back.
    ctx.fillStyle = '#F2B632'
    box(ctx, -w / 2 + 0.36, top + l - 0.62, w - 0.72, 0.42, 0.1)
    ctx.fill()
    ctx.fillStyle = TYRE
    for (let k = 0; k < 4; k++) {
      box(ctx, -w / 2 + 0.5 + k * 0.56, top + l - 0.62, 0.24, 0.42, 0.02)
      ctx.fill()
    }
    // A small cab, glass all round, set toward the front.
    ctx.fillStyle = '#C9CED8'
    box(ctx, -0.8, top + 1.0, 1.6, 1.9, 0.25)
    ctx.fill()
    ctx.fillStyle = GLASS
    box(ctx, -0.62, top + 1.15, 1.24, 1.05, 0.16)
    ctx.fill()
    // The tow hitch at the nose.
    ctx.fillStyle = '#3A4150'
    box(ctx, -0.22, top - 0.02, 0.44, 0.5, 0.08)
    ctx.fill()
    // Deck plate lines.
    ctx.strokeStyle = 'rgba(40,48,64,0.35)'
    ctx.lineWidth = 0.07
    ctx.beginPath()
    ctx.moveTo(-w / 2 + 0.5, top + 3.6)
    ctx.lineTo(w / 2 - 0.5, top + 3.6)
    ctx.moveTo(-w / 2 + 0.5, top + 5.2)
    ctx.lineTo(w / 2 - 0.5, top + 5.2)
    ctx.stroke()
    return
  }

  if (kind === 'truck') {
    wheels(ctx, w, [top + 1.5, top + l - 3.0, top + l - 1.5], 0.36, 1.0)
    // Cab.
    panel(ctx, -w / 2 + 0.08, top, w - 0.16, 2.5, 0.4, '#F1F3F6', '#A9B0BC')
    ctx.fillStyle = GLASS
    box(ctx, -w / 2 + 0.3, top + 0.5, w - 0.6, 0.8, 0.14)
    ctx.fill()
    // The tank: a silver barrel, lit along its top, with a filler hatch and a catwalk line.
    const ty = top + 2.9
    const th = l - 3.0
    const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0)
    g.addColorStop(0, '#6F7887')
    g.addColorStop(0.22, '#BFC6D1')
    g.addColorStop(0.42, '#F7F9FC')
    g.addColorStop(0.62, '#C5CCD7')
    g.addColorStop(1, '#69717F')
    ctx.fillStyle = g
    box(ctx, -w / 2 + 0.1, ty, w - 0.2, th, 0.9)
    ctx.fill()
    ctx.strokeStyle = 'rgba(40,48,64,0.4)'
    ctx.lineWidth = 0.08
    for (const f of [0.34, 0.67]) {
      ctx.beginPath()
      ctx.moveTo(-w / 2 + 0.2, ty + th * f)
      ctx.lineTo(w / 2 - 0.2, ty + th * f)
      ctx.stroke()
    }
    ctx.fillStyle = '#4A5262'
    for (const f of [0.17, 0.5, 0.83]) {
      ctx.beginPath()
      ctx.arc(0, ty + th * f, 0.3, 0, Math.PI * 2)
      ctx.fill()
    }
    return
  }

  // Fire engine.
  wheels(ctx, w, [top + 1.6, top + l - 4.4, top + l - 2.6, top + l - 1.3], 0.44, 1.15)
  panel(ctx, -w / 2 + 0.08, top, w - 0.16, l, 0.45, '#E2463B', '#9E2A22')
  // Wide cab glass, then a white roof walkway down the body.
  ctx.fillStyle = GLASS
  box(ctx, -w / 2 + 0.32, top + 0.45, w - 0.64, 1.0, 0.18)
  ctx.fill()
  ctx.fillStyle = '#F4F5F7'
  box(ctx, -0.5, top + 3.4, 1.0, l - 5.0, 0.12)
  ctx.fill()
  // Blue light bar over the cab.
  ctx.fillStyle = '#20242C'
  box(ctx, -1.0, top + 1.75, 2.0, 0.46, 0.1)
  ctx.fill()
  ctx.fillStyle = '#5AB0FF'
  box(ctx, -0.9, top + 1.83, 0.7, 0.3, 0.07)
  ctx.fill()
  box(ctx, 0.2, top + 1.83, 0.7, 0.3, 0.07)
  ctx.fill()
  // The roof monitor (water cannon): a turret and its barrel pointing forward.
  ctx.fillStyle = '#C7CBD3'
  ctx.beginPath()
  ctx.arc(0, top + 2.95, 0.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#3A4150'
  box(ctx, -0.13, top + 2.05, 0.26, 0.95, 0.06)
  ctx.fill()
  // High-visibility chevrons across the back.
  ctx.fillStyle = '#F4D23C'
  box(ctx, -w / 2 + 0.3, top + l - 0.75, w - 0.6, 0.5, 0.1)
  ctx.fill()
}
