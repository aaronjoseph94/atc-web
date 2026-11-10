/**
 * The animated part of the atmosphere, drawn on two canvases laid over the
 * map (under the app's chrome, and never catching a tap):
 *
 *  - a quarter-resolution canvas for cloud shadows, which are nothing but
 *    soft blurs, so drawing them small and letting the browser scale them up
 *    costs a sixteenth of the pixels;
 *  - a full-resolution canvas for rain, snow, the wind lines and windsocks.
 *
 * One loop draws both at no more than 30 frames a second, and only while
 * something on screen moves by itself: it stops on a clear, calm day, while
 * the tab is hidden, and under reduced motion (then each camera move draws a
 * single still frame instead).
 */
import type { Map as MapLibreMap } from 'maplibre-gl'
import { metersPerPixel, toLocal, type LngLat } from '../geo'
import { blobSprite, mulberry32 } from './textures'
import { CALM, downwindScreenAngle, gustiness, sockExtension, type WeatherFx } from './weatherFx'
import { drawWindsock } from './windsocks'

const FRAME_MS = 1000 / 30
/** Cloud shadows: the repeating field they are scattered over (metres), and how many there are in it. */
const CLOUD_FIELD_M = 26_000
const CLOUDS = 26
/** Cloud canvas resolution relative to CSS pixels. */
const CLOUD_SCALE = 0.25
/** Kept below 1.5 device pixels per CSS pixel: thin streaks don't need more, and fill rate is what costs. */
const MAX_DPR = 1.5
const KT = 0.5144

export type OverlayState = {
  fx: WeatherFx
  /** 0 day … 1 night. */
  night: number
  streamlines: boolean
  reduceMotion: boolean
  /** Draw cloud shadows (not on the paper chart). */
  shadows: boolean
  /** The airport the cloud field and windsocks belong to. */
  center: LngLat
  sites: LngLat[]
}

type Cloud = { x: number; y: number; blobs: { dx: number; dy: number; r: number; a: number }[] }
type Drop = { x: number; y: number; len: number; speed: number; jitter: number }
type Flake = { x: number; y: number; r: number; speed: number; phase: number; a: number }
type Streak = { x: number; y: number; age: number; life: number; len: number; speed: number }

export class AtmosphereOverlay {
  state: OverlayState = { fx: CALM, night: 0, streamlines: true, reduceMotion: false, shadows: true, center: [0, 0], sites: [] }
  private readonly map: MapLibreMap
  private readonly cloudCanvas: HTMLCanvasElement
  private readonly fxCanvas: HTMLCanvasElement
  private readonly blob = blobSprite()
  private clouds: Cloud[] = []
  private drops: Drop[] = []
  private flakes: Flake[] = []
  private streaks: Streak[] = []
  private raf = 0
  private pending = 0
  private lastDraw = 0
  private lastCloudDraw = 0
  private lastCamera = ''
  private lastAnchor: { x: number; y: number; zoom: number } | null = null
  /** A windsock was on screen in the last frame drawn. */
  private socksInView = false
  private w = 0
  private h = 0
  private dpr = 1
  private rand = mulberry32(11)
  /** Seconds of animation time; frozen under reduced motion. */
  private t = 0
  private readonly ro: ResizeObserver
  private readonly onMove = () => this.kick()
  private readonly onVisibility = () => (document.hidden ? this.stop() : this.kick())

  constructor(map: MapLibreMap, cloudCanvas: HTMLCanvasElement, fxCanvas: HTMLCanvasElement) {
    this.map = map
    this.cloudCanvas = cloudCanvas
    this.fxCanvas = fxCanvas
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(fxCanvas)
    this.resize()
    map.on('move', this.onMove)
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  destroy() {
    this.stop()
    cancelAnimationFrame(this.pending)
    this.ro.disconnect()
    this.map.off('move', this.onMove)
    document.removeEventListener('visibilitychange', this.onVisibility)
  }

  /** New weather, settings or airport: rebuild what depends on them and draw. */
  update(next: OverlayState) {
    const airportChanged = next.center[0] !== this.state.center[0] || next.center[1] !== this.state.center[1]
    this.state = next
    if (airportChanged || !this.clouds.length) this.seedClouds()
    this.seedParticles()
    this.kick()
  }

  private resize() {
    const r = this.fxCanvas.getBoundingClientRect()
    this.w = Math.max(1, Math.round(r.width))
    this.h = Math.max(1, Math.round(r.height))
    this.dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
    this.fxCanvas.width = Math.round(this.w * this.dpr)
    this.fxCanvas.height = Math.round(this.h * this.dpr)
    this.cloudCanvas.width = Math.max(1, Math.round(this.w * CLOUD_SCALE))
    this.cloudCanvas.height = Math.max(1, Math.round(this.h * CLOUD_SCALE))
    this.seedParticles()
    this.lastCloudDraw = 0
    this.kick()
  }

  /** The cloud field for this airport: the same clouds on every visit, made of a few overlapping blobs each. */
  private seedClouds() {
    const rand = mulberry32(Math.round(this.state.center[0] * 1000) ^ Math.round(this.state.center[1] * 1000))
    this.clouds = Array.from({ length: CLOUDS }, () => {
      const r = 900 + rand() * 1700
      const n = 3 + Math.floor(rand() * 3)
      return {
        x: rand() * CLOUD_FIELD_M,
        y: rand() * CLOUD_FIELD_M,
        blobs: Array.from({ length: n }, (_, i) => ({ dx: i ? (rand() - 0.5) * r * 1.6 : 0, dy: i ? (rand() - 0.5) * r * 0.9 : 0, r: r * (0.55 + rand() * 0.5), a: 0.7 + rand() * 0.3 })),
      }
    })
  }

  /** Particle pools sized to the screen and the weather. */
  private seedParticles() {
    const { fx, streamlines } = this.state
    const area = this.w * this.h
    const rand = this.rand
    const nDrops = Math.round((area / 2600) * fx.rain)
    this.drops = Array.from({ length: nDrops }, () => ({ x: rand() * this.w, y: rand() * this.h, len: 9 + rand() * 14, speed: 0.75 + rand() * 0.5, jitter: (rand() - 0.5) * 0.12 }))
    const nFlakes = Math.round((area / 3200) * fx.snow)
    this.flakes = Array.from({ length: nFlakes }, () => ({ x: rand() * this.w, y: rand() * this.h, r: 0.9 + rand() * 1.6, speed: 0.6 + rand() * 0.8, phase: rand() * Math.PI * 2, a: 0.45 + rand() * 0.4 }))
    const nStreaks = streamlines && fx.windKt >= 3 ? Math.round(area / 15000) : 0
    if (this.streaks.length !== nStreaks) this.streaks = Array.from({ length: nStreaks }, () => this.newStreak(true))
  }

  private newStreak(anyAge: boolean): Streak {
    const rand = this.rand
    const life = 2.6 + rand() * 2.6
    return { x: rand() * this.w, y: rand() * this.h, age: anyAge ? rand() * life : 0, life, len: 0.7 + rand() * 0.6, speed: 0.8 + rand() * 0.4 }
  }

  /** Is anything on screen moving by itself right now? */
  private animating(zoom: number): boolean {
    const { fx, reduceMotion, streamlines, shadows, night } = this.state
    if (reduceMotion || document.hidden) return false
    if (fx.rain > 0 || fx.snow > 0) return true
    if (shadows && fx.cloud > 0.3 && night < 0.95 && zoom >= 9) return true
    if (streamlines && fx.windKt >= 3 && zoom >= 11) return true
    // Windsocks only move in a wind, and only matter when one is on screen.
    return this.socksInView && zoom >= 13.8 && this.state.fx.windKt > 0
  }

  /** Draw now (on the next frame) and keep going if anything moves. */
  kick() {
    if (this.raf || this.pending) return
    this.pending = requestAnimationFrame((now) => {
      this.pending = 0
      this.frame(now, true)
    })
  }

  stop() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private frame(now: number, forced = false) {
    this.raf = 0
    const zoom = this.map.getZoom()
    const live = this.animating(zoom)
    if (forced || now - this.lastDraw >= FRAME_MS - 2) {
      const dt = this.lastDraw ? Math.min(0.1, (now - this.lastDraw) / 1000) : 0
      this.lastDraw = now
      if (live) this.t += dt
      this.draw(now, live ? dt : 0, zoom)
    }
    // Look again after drawing: the camera may have just brought a windsock into view.
    if (live || this.animating(zoom)) this.raf = requestAnimationFrame((n) => this.frame(n))
    else this.lastDraw = 0
  }

  private draw(now: number, dt: number, zoom: number) {
    const map = this.map
    const { fx, night } = this.state
    const bearing = map.getBearing()
    // Ground-fixed things (wind lines) follow the map when it pans.
    const anchor = map.project(this.state.center)
    if (this.lastAnchor && Math.abs(this.lastAnchor.zoom - zoom) < 1e-3) {
      const dx = anchor.x - this.lastAnchor.x
      const dy = anchor.y - this.lastAnchor.y
      if (dx || dy) for (const s of this.streaks) {
        s.x += dx
        s.y += dy
      }
    }
    this.lastAnchor = { x: anchor.x, y: anchor.y, zoom }

    // Clouds move slowly: a dozen redraws a second is plenty, unless the camera moved.
    const camera = `${anchor.x.toFixed(1)},${anchor.y.toFixed(1)},${zoom.toFixed(3)},${bearing.toFixed(1)}`
    if (now - this.lastCloudDraw > 80 || dt === 0 || camera !== this.lastCamera) {
      this.lastCamera = camera
      this.lastCloudDraw = now
      this.drawClouds(zoom, bearing)
    }

    const ctx = this.fxCanvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.w, this.h)
    const down = downwindScreenAngle(fx, bearing)
    this.drawStreamlines(ctx, dt, zoom, down)
    this.drawSocks(ctx, zoom, down, night)
    this.drawRain(ctx, dt, down, night)
    this.drawSnow(ctx, dt, down)
  }

  private drawClouds(zoom: number, bearing: number) {
    const ctx = this.cloudCanvas.getContext('2d')
    if (!ctx) return
    const W = this.cloudCanvas.width
    const H = this.cloudCanvas.height
    ctx.clearRect(0, 0, W, H)
    const { fx, night, shadows, center } = this.state
    // No sun, no shadows: they fade out through dusk.
    const strength = fx.cloud * (1 - night) * Math.min(1, Math.max(0, (zoom - 9) / 1.5))
    if (!shadows || fx.cloud <= 0.3 || strength <= 0.01) return
    const map = this.map
    const c = map.getCenter()
    const mid = map.project(c)
    const mpp = metersPerPixel(c.lat, zoom)
    const [vx, vy] = toLocal(center, [c.lng, c.lat])
    // Cloud drift: faster than the surface wind, as winds are aloft; a westerly when calm.
    const from = fx.windFrom ?? 270
    const speed = Math.max(3, fx.windKt) * KT * 1.6
    const dir = ((from + 180) * Math.PI) / 180
    const ox = Math.sin(dir) * speed * this.t
    const oy = Math.cos(dir) * speed * this.t
    const b = (bearing * Math.PI) / 180
    const cos = Math.cos(b)
    const sin = Math.sin(b)
    const F = CLOUD_FIELD_M
    // Each layer of cloud is a touch denser with more cover.
    ctx.globalAlpha = 1
    const alpha = 0.075 + 0.07 * strength
    for (const cl of this.clouds) {
      // Position relative to the view centre, wrapped so the field always covers the screen.
      const ex = ((((cl.x + ox - vx) % F) + F * 1.5) % F) - F / 2
      const ny = ((((cl.y + oy - vy) % F) + F * 1.5) % F) - F / 2
      for (const bl of cl.blobs) {
        const e = ex + bl.dx
        const n = ny + bl.dy
        const x = (mid.x + (e * cos - n * sin) / mpp) * CLOUD_SCALE
        const y = (mid.y - (e * sin + n * cos) / mpp) * CLOUD_SCALE
        const r = (bl.r / mpp) * CLOUD_SCALE
        if (x + r < 0 || y + r < 0 || x - r > W || y - r > H) continue
        ctx.globalAlpha = alpha * bl.a * strength
        ctx.drawImage(this.blob, x - r, y - r, r * 2, r * 2)
      }
    }
    ctx.globalAlpha = 1
  }

  /** Faint streaks drifting downwind, longer and quicker in a stronger wind, pulsing with the gusts. */
  private drawStreamlines(ctx: CanvasRenderingContext2D, dt: number, zoom: number, down: number | null) {
    const { fx, streamlines, night } = this.state
    if (!streamlines || down == null || fx.windKt < 3 || zoom < 11 || !this.streaks.length) return
    const fade = Math.min(1, (zoom - 11) / 1)
    const g = gustiness(fx)
    const surge = 1 + g * 0.45 * Math.sin(this.t * 1.1) * Math.sin(this.t * 0.37 + 1)
    const ux = Math.sin(down)
    const uy = -Math.cos(down)
    // Pixels a second: a light breeze creeps, a gale races.
    const v = (10 + fx.windKt * 2.4) * surge
    const base = (0.05 + 0.06 * Math.min(1, fx.windKt / 25)) * fade * (1 - night * 0.35)
    ctx.lineCap = 'round'
    ctx.lineWidth = 1
    for (let i = 0; i < this.streaks.length; i++) {
      let s = this.streaks[i]
      s.age += dt
      s.x += ux * v * s.speed * dt
      s.y += uy * v * s.speed * dt
      if (s.age > s.life || s.x < -60 || s.y < -60 || s.x > this.w + 60 || s.y > this.h + 60) {
        s = this.streaks[i] = this.newStreak(false)
      }
      const a = base * Math.sin((Math.PI * s.age) / s.life)
      if (a <= 0.003) continue
      const len = (16 + fx.windKt * 1.6) * s.len
      const tx = s.x - ux * len
      const ty = s.y - uy * len
      const grad = ctx.createLinearGradient(tx, ty, s.x, s.y)
      grad.addColorStop(0, 'rgba(226,234,250,0)')
      grad.addColorStop(1, `rgba(226,234,250,${a.toFixed(3)})`)
      ctx.strokeStyle = grad
      ctx.beginPath()
      ctx.moveTo(tx, ty)
      ctx.lineTo(s.x, s.y)
      ctx.stroke()
    }
  }

  private drawSocks(ctx: CanvasRenderingContext2D, zoom: number, down: number | null, night: number) {
    const { fx, sites } = this.state
    this.socksInView = false
    if (!sites.length || zoom < 13.8) return
    const alpha = Math.min(1, (zoom - 13.8) / 0.6) * (1 - night * 0.15)
    const length = Math.max(11, Math.min(34, 15 * 2 ** (zoom - 15.5)))
    const g = gustiness(fx)
    const t = this.t
    for (let i = 0; i < sites.length; i++) {
      const p = this.map.project(sites[i])
      if (p.x < -40 || p.y < -40 || p.x > this.w + 40 || p.y > this.h + 40) continue
      this.socksInView = true
      const phase = i * 1.7
      // Gusts fill and empty the sock and swing it; a steady wind only stirs it.
      const gust = g * (0.5 + 0.5 * Math.sin(t * 0.9 + phase) * Math.sin(t * 0.31 + phase * 2))
      const kt = fx.windKt + (fx.gustKt - fx.windKt) * gust
      const sway = ((4 + g * 16) * Math.PI) / 180
      let angle: number
      if (down != null) angle = down + sway * Math.sin(t * 2.3 + phase) * (0.4 + gust)
      // Variable wind: it wanders; calm: it hangs, drawn pointing down the screen.
      else if (fx.variable && fx.windKt > 0) angle = Math.sin(t * 0.13 + phase) * 2.4 + Math.sin(t * 0.41) * 0.6
      else angle = Math.PI + 0.25 * Math.sin(t * 0.5 + phase)
      drawWindsock(ctx, p.x, p.y, angle, length, sockExtension(fx.windKt > 0 ? kt : 0), alpha)
    }
  }

  /** Rain: short streaks driven downwind (from above, falling rain is seen only as its slant). */
  private drawRain(ctx: CanvasRenderingContext2D, dt: number, down: number | null, night: number) {
    const { fx } = this.state
    if (fx.rain <= 0 || !this.drops.length) return
    // With no wind, a slight slant toward the bottom left, as rain is usually drawn.
    const dir = down ?? (200 * Math.PI) / 180
    const slant = Math.min(1, 0.35 + fx.windKt / 30)
    const ux = Math.sin(dir) * slant
    const uy = -Math.cos(dir) * slant + (1 - slant)
    const n = Math.hypot(ux, uy) || 1
    const v = 520 + fx.windKt * 22
    ctx.lineWidth = 1
    ctx.strokeStyle = `rgba(196,212,240,${(0.1 + 0.16 * fx.rain) * (1 - night * 0.3)})`
    ctx.beginPath()
    for (const d of this.drops) {
      const dx = (ux / n + d.jitter) * d.speed
      const dy = (uy / n) * d.speed
      d.x += dx * v * dt
      d.y += dy * v * dt
      if (d.x < -30) d.x += this.w + 60
      else if (d.x > this.w + 30) d.x -= this.w + 60
      if (d.y < -30) d.y += this.h + 60
      else if (d.y > this.h + 30) d.y -= this.h + 60
      ctx.moveTo(d.x, d.y)
      ctx.lineTo(d.x - dx * d.len, d.y - dy * d.len)
    }
    ctx.stroke()
  }

  /** Snow: soft flecks drifting downwind with a little flutter. */
  private drawSnow(ctx: CanvasRenderingContext2D, dt: number, down: number | null) {
    const { fx } = this.state
    if (fx.snow <= 0 || !this.flakes.length) return
    const dir = down ?? Math.PI
    const v = 14 + fx.windKt * 2.2
    const ux = Math.sin(dir)
    const uy = -Math.cos(dir)
    ctx.fillStyle = 'rgba(244,247,255,0.8)'
    for (const f of this.flakes) {
      f.phase += dt * 1.6
      f.x += (ux * v * f.speed + Math.cos(f.phase) * 6) * dt
      f.y += (uy * v * f.speed + Math.sin(f.phase * 0.7) * 4) * dt
      if (f.x < -10) f.x += this.w + 20
      else if (f.x > this.w + 10) f.x -= this.w + 20
      if (f.y < -10) f.y += this.h + 20
      else if (f.y > this.h + 10) f.y -= this.h + 20
      ctx.globalAlpha = f.a * Math.min(1, fx.snow + 0.3)
      ctx.beginPath()
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }
}
