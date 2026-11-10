/**
 * Per-frame aircraft effects: lights, banking, landing lights, takeoff
 * exhaust, livery colour, contrails, soft high shadows, scale-in on arrival,
 * greyer parked aircraft and tags that fade toward the screen edges.
 *
 * Cost model: nothing here adds a GeoJSON source or a `setData`. Each effect
 * is a few extra properties on the aircraft (and shadow, and trail) features
 * the aircraft layer already sends every frame, drawn by layers declared in
 * `mapStyle.ts` with sprites from `sprites.ts`. Blinking is part of that
 * per-frame data (which sprite is lit), so it costs no paint updates either.
 */
import type { Feature, LineString } from 'geojson'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { LiveAircraft } from '../livePositions'
import { bankedImage, type AircraftIcon } from '../mapImages'
import { TurnTracker } from './bank'
import { beaconOn, phaseOf, strobeOn } from './blink'
import { brandColour } from './brand'
import { anchorsFor } from './geometry'
import { NightLevel } from './nightLevel'
import { exhaustImage, lightImage, type LightBits } from './sprites'

/** Contrails form above about FL250, fading in over the band below. */
export const CONTRAIL_FT = 25_000
const CONTRAIL_FADE_FT = 2500
/** Length of track a contrail covers, metres. */
const CONTRAIL_M = 4500
/** Landing lights are on below this height on approach and departure. */
const LANDING_LIGHT_FT = 3000
/** Ground speed above which an aircraft on the ground is on its takeoff (or landing) roll. */
const ROLL_KT = 40
/** Exhaust shimmer frames alternate at this interval. */
const SHIMMER_MS = 110
/** Livery colour shows from this zoom (the fin is a pixel or two wide below it). */
export const LIVERY_MIN_ZOOM = 12.5
/** Tags fade over this many pixels from the screen edge. */
const EDGE_FADE_PX = 110
const EDGE_MIN_OPACITY = 0.45

/** What the effects add to one aircraft this frame. */
export type AircraftFxResult = {
  /** Image to draw for the aircraft (a banked or parked variant, or the one passed in). */
  image: string
  /** Image the shadow should use (never the parked variant, which has no distance field). */
  shadowImage: string
  /** Multiplier for the drawn size (scale-in on arrival, scale-out on departure). */
  scale: number
  /** Extra properties for the aircraft feature. */
  props: { sh: string; lt: string; lo: number; ll: number; ex: string; exo: number; lv: string; eo: number }
  /** How blurred the shadow is (0 crisp … 1 soft), and an extra fade for it. */
  shadowBlur: number
  shadowFade: number
}

export type FrameInfo = {
  t: number
  zoom: number
  reduceMotion: boolean
  width: number
  height: number
}

/** Smoothstep. */
const ease = (x: number) => {
  const c = Math.max(0, Math.min(1, x))
  return c * c * (3 - 2 * c)
}

/** Tag opacity for a point `x`,`y` px into a `w`×`h` view: full in the middle, fainter near the edges. */
export function edgeOpacity(x: number, y: number, w: number, h: number, fadePx = EDGE_FADE_PX): number {
  const d = Math.min(x, y, w - x, h - y)
  const margin = Math.max(24, Math.min(fadePx, 0.22 * Math.min(w, h)))
  return EDGE_MIN_OPACITY + (1 - EDGE_MIN_OPACITY) * ease(d / margin)
}

/** Size multiplier while an aircraft fades in or out: from 85% to full size, eased. */
export function arrivalScale(opacity: number): number {
  return 0.85 + 0.15 * ease(opacity)
}

/**
 * Which lights are lit right now, given the aircraft's phase of flight.
 * At night: navigation lights whenever powered, the beacon from pushback on,
 * strobes on the runway and in the air (they're switched off taxiing so as
 * not to dazzle). By day only the strobes are worth drawing, faintly.
 * With reduced motion nothing blinks: steady navigation lights and beacon.
 */
export function litBits(o: { night: number; parked: boolean; onGround: boolean; rolling: boolean; tMs: number; phase: number; reduceMotion: boolean }): LightBits | '' {
  const strobes = !o.onGround || o.rolling
  if (o.night < 0.15) {
    if (!strobes || o.reduceMotion) return ''
    return strobeOn(o.tMs, o.phase) ? 'S' : ''
  }
  if (o.reduceMotion) return o.parked ? 'N' : 'NB'
  const s = strobes && strobeOn(o.tMs, o.phase)
  const b = !o.parked && beaconOn(o.tMs, o.phase)
  return `N${s ? 'S' : ''}${b ? 'B' : ''}` as LightBits
}

export class AircraftFx {
  private readonly map: MapLibreMap
  private readonly turns = new TurnTracker()
  private readonly nightLevel = new NightLevel()
  private night = 0
  private frame: FrameInfo = { t: 0, zoom: 0, reduceMotion: false, width: 1, height: 1 }
  private readonly phases = new Map<string, number>()
  private readonly contrailIds = new Set<string>()

  constructor(map: MapLibreMap) {
    this.map = map
  }

  /** Call once per frame before `aircraft`. Returns the night level (0 day … 1 night). */
  begin(f: FrameInfo): number {
    this.frame = f
    const c = this.map.getCenter()
    this.night = this.nightLevel.value(f.t, c.lng, c.lat)
    this.turns.sweep(f.t)
    if (this.phases.size > 2000) this.phases.clear()
    return this.night
  }

  private phase(id: string): number {
    let p = this.phases.get(id)
    if (p === undefined) {
      p = phaseOf(id)
      this.phases.set(id, p)
    }
    return p
  }

  /** Effects for one aircraft. `image` is the artwork id the layer would draw (rotor frame included). */
  aircraft(a: LiveAircraft, icon: AircraftIcon, image: string, aglFt: number, parked: boolean, hi: boolean, labelled: boolean): AircraftFxResult {
    const { t, zoom, reduceMotion } = this.frame
    const anchors = anchorsFor(icon)
    const speed = a.speedKt ?? 0
    const rolling = a.onGround && speed >= ROLL_KT
    const airborne = !a.onGround

    // Banking: only airborne aircraft with a known heading lean.
    const level = icon === 'ac-dot' ? 0 : this.turns.update(a.icao24, a.heading, speed, airborne && a.headingKnown !== false, t)
    let drawn = bankedImage(this.map, image, level)
    const shadowImage = drawn
    // Parked aircraft use the greyer drawing (the highlighted one keeps its yellow).
    if (parked && !hi && drawn === icon && this.map.hasImage(`${icon}-pk`)) drawn = `${icon}-pk`

    // Lights.
    let lt = ''
    let lo = 0
    if (anchors.lit) {
      const bits = litBits({ night: this.night, parked, onGround: a.onGround, rolling, tMs: t, phase: this.phase(a.icao24), reduceMotion })
      if (bits) {
        lt = lightImage(icon, bits, /-(b[LR][12])$/.exec(shadowImage)?.[1] ?? '')
        // By day the strobes are a faint glint; at night lights are full strength, a parked aircraft's dimmer.
        lo = this.night < 0.15 ? 0.4 : Math.min(1, 0.3 + this.night) * (parked ? 0.6 : 1)
      }
    }

    // Landing lights: on final or departing below ~3,000 ft, and on the runway roll.
    const vr = a.verticalRateFpm ?? 0
    const lowAndGoing = airborne && aglFt < LANDING_LIGHT_FT && (vr < -250 || vr > 250 || aglFt < 1000)
    const landing = anchors.lit && (lowAndGoing || rolling) ? this.night * (airborne ? 1 - ease((aglFt - (LANDING_LIGHT_FT - 600)) / 600) : 1) : 0

    // Exhaust shimmer on the takeoff roll (a faint smudge, mostly a daytime thing).
    const engines = anchors.engines.length > 0 && rolling
    const frame = reduceMotion ? 0 : (Math.floor((t + this.phase(a.icao24) * 1000) / SHIMMER_MS) % 2 as 0 | 1)
    const ex = engines ? exhaustImage(icon, frame) : ''
    const exo = engines ? (0.6 - 0.3 * this.night) * ease((speed - ROLL_KT) / 25) : 0

    // Airline colour on the fin, once zoomed in far enough to see it.
    const lv = anchors.fin && zoom >= LIVERY_MIN_ZOOM - 0.5 && !hi ? brandColour(a.callsign, a.icao24) : ''

    // Tags fade toward the screen edges (the selected one stays solid).
    let eo = 1
    if (labelled && !hi) {
      const p = this.map.project([a.lon, a.lat])
      eo = edgeOpacity(p.x, p.y, this.frame.width, this.frame.height)
    }

    // Shadows soften and fade with height: crisp on the ground, a soft smudge at a few thousand feet.
    const shadowBlur = ease(aglFt / 4500)
    const shadowFade = 1 - 0.45 * ease(aglFt / 12000)

    return {
      image: drawn,
      shadowImage,
      scale: reduceMotion ? 1 : arrivalScale(a.opacity),
      props: { sh: icon, lt, lo: Math.round(lo * 100) / 100, ll: Math.round(landing * 100) / 100, ex, exo: Math.round(exo * 100) / 100, lv, eo: Math.round(eo * 100) / 100 },
      shadowBlur: Math.round(shadowBlur * 100) / 100,
      shadowFade,
    }
  }

  /**
   * Contrails behind aircraft cruising high overhead: the last few
   * kilometres of track, as a line the style draws white, fading with age
   * and spreading. `trail` gives an aircraft's recent track, oldest first,
   * ending at the aircraft.
   */
  contrails(list: LiveAircraft[], trail: (icao24: string) => [number, number][]): Feature<LineString>[] {
    const out: Feature<LineString>[] = []
    this.contrailIds.clear()
    for (const a of list) {
      if (a.onGround || a.altitudeFt == null || a.altitudeFt < CONTRAIL_FT - CONTRAIL_FADE_FT) continue
      const coords = clipToLength(trail(a.icao24), CONTRAIL_M)
      if (coords.length < 2) continue
      const co = ease((a.altitudeFt - (CONTRAIL_FT - CONTRAIL_FADE_FT)) / CONTRAIL_FADE_FT) * a.opacity
      this.contrailIds.add(a.icao24)
      out.push({ type: 'Feature', properties: { sel: 2, co: Math.round(co * 100) / 100 }, geometry: { type: 'LineString', coordinates: coords } })
    }
    return out
  }

  /** Whether the aircraft drew a contrail last frame (its plain wake is then left out). */
  hasContrail(icao24: string): boolean {
    return this.contrailIds.has(icao24)
  }

  clear() {
    this.turns.clear()
    this.contrailIds.clear()
  }
}

/** The newest `maxM` metres of a track (oldest first), cutting the oldest segment part-way. */
export function clipToLength(coords: [number, number][], maxM: number): [number, number][] {
  if (coords.length < 2) return coords
  const out: [number, number][] = [coords[coords.length - 1]]
  let left = maxM
  for (let i = coords.length - 1; i > 0; i--) {
    const [x1, y1] = coords[i]
    const [x0, y0] = coords[i - 1]
    const mPerLon = 111_320 * Math.cos((y1 * Math.PI) / 180)
    const seg = Math.hypot((x1 - x0) * mPerLon, (y1 - y0) * 110_540)
    if (seg >= left) {
      const u = seg > 0 ? left / seg : 0
      out.push([x1 + (x0 - x1) * u, y1 + (y0 - y1) * u])
      break
    }
    out.push([x0, y0])
    left -= seg
  }
  return out.reverse()
}
