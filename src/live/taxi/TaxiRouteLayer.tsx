/**
 * Draws taxi routes from live clearances on the map: a glowing purple line
 * with marching yellow dashes from the aircraft to its runway, yellow
 * hold-short bars, and a chip at each stop. The route shortens behind the
 * aircraft as it taxis, and fades away when the aircraft reaches the end,
 * takes off, or after five minutes. Tapping it shows the clearance.
 */
import type { Feature, FeatureCollection } from 'geojson'
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from 'maplibre-gl'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { AirlineLogo } from '../../airline/AirlineLogo'
import { offset, toLocal, type LngLat } from '../../map/geo'
import { LAYER, TAXI_CHIP, TAXI_LAYER, TAXI_SRC, taxiRouteLayers } from '../../map/mapStyle'
import { useSettings } from '../../settings/settingsStore'
import { liveBuffer } from '../session'
import { progressAlong } from './route'
import { setTileTemplate } from './network'
import { ROUTE_TTL_MS, useTaxi, type TaxiRoute } from './store'
import { startTaxiWatcher } from './watch'

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
/** Dash patterns that, shown in turn, make the dashes march along the line. */
const DASH_STEPS = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
]
const FADE_IN_MS = 350
const DRAW_MS = 900
const FADE_OUT_MS = 1200
/** Within this of the end, the aircraft has arrived. */
const ARRIVED_M = 30
/** Further than this from its route, the aircraft is off it; the route is left whole. */
const OFF_ROUTE_M = 120
/** Rolling faster than this: taking off. */
const TAKEOFF_KT = 60

type Live = { shownAt: number; leg: number; ahead: LngLat[]; endAt: number | null; trimmedAt: number }

/** A rounded chip image that stretches around its text without blurring its corners. */
function chipImage(fill: string) {
  const s = 48
  const r = 14
  const c = document.createElement('canvas')
  c.width = s
  c.height = s
  const g = c.getContext('2d')!
  g.fillStyle = fill
  g.beginPath()
  g.roundRect(2, 2, s - 4, s - 4, r)
  g.fill()
  g.strokeStyle = 'rgba(0,0,0,0.35)'
  g.lineWidth = 2
  g.stroke()
  return { data: g.getImageData(0, 0, s, s), opts: { pixelRatio: 2, stretchX: [[r + 2, s - r - 2]] as [number, number][], stretchY: [[r + 2, s - r - 2]] as [number, number][], content: [10, 8, s - 10, s - 8] as [number, number, number, number] } }
}

function setData(map: MapLibreMap, id: string, data: FeatureCollection) {
  ;(map.getSource(id) as GeoJSONSource | undefined)?.setData(data)
}

/** Cut a polyline at a fraction of its length. */
function headOf(points: LngLat[], frac: number): LngLat[] {
  if (frac >= 1 || points.length < 2) return points
  const origin = points[0]
  const xy = points.map((p) => toLocal(origin, p))
  const lens: number[] = []
  let total = 0
  for (let i = 1; i < xy.length; i++) {
    const d = Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1])
    lens.push(d)
    total += d
  }
  let left = total * Math.max(0.001, frac)
  const out: LngLat[] = [points[0]]
  for (let i = 1; i < xy.length; i++) {
    if (lens[i - 1] >= left) {
      const k = left / (lens[i - 1] || 1)
      out.push(offset(origin, xy[i - 1][0] + (xy[i][0] - xy[i - 1][0]) * k, xy[i - 1][1] + (xy[i][1] - xy[i - 1][1]) * k))
      return out
    }
    left -= lens[i - 1]
    out.push(points[i])
  }
  return out
}

/** Split a polyline at the point nearest `p`: [before, after]. */
function splitAt(points: LngLat[], p: LngLat): [LngLat[], LngLat[]] {
  const origin = points[0]
  const xy = points.map((q) => toLocal(origin, q))
  const [px, py] = toLocal(origin, p)
  let best = { i: -1, d: Infinity }
  for (let i = 1; i < xy.length; i++) {
    const [ax, ay] = xy[i - 1]
    const [bx, by] = xy[i]
    const l2 = (bx - ax) ** 2 + (by - ay) ** 2
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2)) : 0
    const d = Math.hypot(ax + (bx - ax) * t - px, ay + (by - ay) * t - py)
    if (d < best.d) best = { i, d }
  }
  if (best.i < 0 || best.d > 3) return [points, []]
  return [
    [...points.slice(0, best.i), p],
    [p, ...points.slice(best.i)],
  ]
}

function routeFeatures(r: TaxiRoute, ahead: LngLat[], o: number): { line: Feature[]; marks: Feature[] } {
  const line: Feature[] = []
  const marks: Feature[] = []
  if (ahead.length < 2) return { line, marks }
  // Past the first hold-short point the route is a promise, not a clearance: draw it dimmer.
  const firstHold = r.holds.find((h) => h.label.startsWith('Hold short'))
  const [before, after] = firstHold ? splitAt(ahead, firstHold.at) : [ahead, []]
  const props = { id: r.id, o }
  if (before.length > 1) line.push({ type: 'Feature', properties: { ...props, beyond: 0 }, geometry: { type: 'LineString', coordinates: before } })
  if (after.length > 1) line.push({ type: 'Feature', properties: { ...props, beyond: 1 }, geometry: { type: 'LineString', coordinates: after } })
  const end = ahead[ahead.length - 1]
  for (const h of r.holds) {
    // Only stops still ahead of the aircraft.
    const [, rest] = splitAt(ahead, h.at)
    if (!rest.length && Math.hypot(...toLocal(end, h.at)) > 3) continue
    const b = ((h.bearing + 90) * Math.PI) / 180
    const half = 20
    marks.push({ type: 'Feature', properties: { ...props, kind: 'hold' }, geometry: { type: 'LineString', coordinates: [offset(h.at, -Math.sin(b) * half, -Math.cos(b) * half), offset(h.at, Math.sin(b) * half, Math.cos(b) * half)] } })
    marks.push({ type: 'Feature', properties: { ...props, kind: 'chip', label: h.label.toUpperCase(), tone: h.label.startsWith('Runway') ? 'runway' : 'hold' }, geometry: { type: 'Point', coordinates: h.at } })
  }
  return { line, marks }
}

export function TaxiRouteLayer({ map }: { map: MapLibreMap | null }) {
  const reduceMotion = useSettings((s) => s.reduceMotion)
  const [popup, setPopup] = useState<{ id: string; at: LngLat } | null>(null)
  const route = useTaxi((s) => (popup ? (s.routes.find((r) => r.id === popup.id) ?? null) : null))

  useEffect(() => startTaxiWatcher(), [])

  useEffect(() => {
    if (!map) return
    for (const [id, fill] of [
      [TAXI_CHIP.runway, '#5B3DF5'],
      [TAXI_CHIP.hold, '#FFD23F'],
    ] as const) {
      if (map.hasImage(id)) continue
      const img = chipImage(fill)
      map.addImage(id, img.data, img.opts)
    }
    for (const id of Object.values(TAXI_SRC)) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY })
    // Under the aircraft and their tags, over the airfield paint.
    const before = map.getLayer(LAYER.shadow) ? LAYER.shadow : undefined
    for (const layer of taxiRouteLayers()) if (!map.getLayer(layer.id)) map.addLayer(layer, before)
    const tiles = (map.getSource('omt') as { tiles?: string[] } | undefined)?.tiles?.[0]
    setTileTemplate(tiles)

    const click = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id as string | undefined
      if (id) setPopup({ id, at: [e.lngLat.lng, e.lngLat.lat] })
    }
    const away = (e: MapLayerMouseEvent) => {
      if (!map.queryRenderedFeatures(e.point, { layers: [TAXI_LAYER.hit] }).length) setPopup(null)
    }
    const enter = () => (map.getCanvas().style.cursor = 'pointer')
    const leave = () => (map.getCanvas().style.cursor = '')
    map.on('click', TAXI_LAYER.hit, click)
    map.on('click', away)
    map.on('mouseenter', TAXI_LAYER.hit, enter)
    map.on('mouseleave', TAXI_LAYER.hit, leave)
    return () => {
      map.off('click', TAXI_LAYER.hit, click)
      map.off('click', away)
      map.off('mouseenter', TAXI_LAYER.hit, enter)
      map.off('mouseleave', TAXI_LAYER.hit, leave)
    }
  }, [map])

  // The frame loop: trimming, fades, the draw-on and the marching dashes. Runs only while there are routes.
  useEffect(() => {
    if (!map) return
    const live = new Map<string, Live>()
    let raf = 0
    let lastDash = -1
    let lastPush = 0
    let running = false

    const frame = () => {
      raf = 0
      const routes = useTaxi.getState().routes
      const now = performance.now()
      const wall = Date.now()
      let animating = false
      const lines: Feature[] = []
      const marks: Feature[] = []
      for (const id of live.keys()) if (!routes.some((r) => r.id === id)) live.delete(id)
      for (const r of routes) {
        let s = live.get(r.id)
        if (!s) {
          s = { shownAt: now, leg: 0, ahead: r.coords, endAt: null, trimmedAt: 0 }
          live.set(r.id, s)
        }
        if (s.endAt == null && wall - r.at > ROUTE_TTL_MS) s.endAt = now
        // Follow the aircraft a few times a second.
        if (s.endAt == null && now - s.trimmedAt > 250) {
          s.trimmedAt = now
          const a = liveBuffer.get(r.icao24)
          if (a) {
            const origin = r.coords[0]
            const pts = r.coords.map((p) => {
              const [x, y] = toLocal(origin, p)
              return { x, y }
            })
            const [ax, ay] = toLocal(origin, [a.lon, a.lat])
            const prog = progressAlong(pts, { x: ax, y: ay }, s.leg)
            if (prog.offM < OFF_ROUTE_M) {
              s.leg = prog.leg
              s.ahead = prog.ahead.map((p) => offset(origin, p.x, p.y))
              if (prog.remainingM < ARRIVED_M) s.endAt = now
            }
            if (!a.onGround || (a.speedKt ?? 0) > TAKEOFF_KT) s.endAt = now
          }
        }
        const fin = reduceMotion ? 1 : Math.min(1, (now - s.shownAt) / FADE_IN_MS)
        const fout = s.endAt == null ? 1 : 1 - Math.min(1, (now - s.endAt) / (reduceMotion ? 300 : FADE_OUT_MS))
        if (fout <= 0) {
          useTaxi.getState().remove(r.id)
          continue
        }
        const drawn = reduceMotion ? 1 : 1 - (1 - Math.min(1, (now - s.shownAt) / DRAW_MS)) ** 3
        if (fin < 1 || fout < 1 || drawn < 1) animating = true
        const f = routeFeatures(r, headOf(s.ahead, drawn), fin * fout)
        lines.push(...f.line)
        if (drawn >= 1) marks.push(...f.marks)
      }
      if (animating || now - lastPush > 240 || !routes.length) {
        lastPush = now
        setData(map, TAXI_SRC.line, { type: 'FeatureCollection', features: lines })
        setData(map, TAXI_SRC.marks, { type: 'FeatureCollection', features: marks })
      }
      const step = reduceMotion ? 0 : Math.floor(now / 70) % DASH_STEPS.length
      if (step !== lastDash && map.getLayer(TAXI_LAYER.dash)) {
        lastDash = step
        map.setPaintProperty(TAXI_LAYER.dash, 'line-dasharray', DASH_STEPS[step])
      }
      if (routes.length) raf = requestAnimationFrame(frame)
      else running = false
    }
    const kick = () => {
      if (running) return
      running = true
      raf = requestAnimationFrame(frame)
    }
    kick()
    const off = useTaxi.subscribe((s, prev) => {
      if (s.routes !== prev.routes) kick()
    })
    return () => {
      off()
      cancelAnimationFrame(raf)
      running = false
      setData(map, TAXI_SRC.line, EMPTY)
      setData(map, TAXI_SRC.marks, EMPTY)
    }
  }, [map, reduceMotion])

  if (!map || !popup || !route) return null
  return createPortal(<RoutePopup map={map} at={popup.at} route={route} onClose={() => setPopup(null)} />, map.getContainer())
}

function ago(at: number) {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  return s < 50 ? 'Just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** The clearance behind a route, pinned to where it was tapped. */
function RoutePopup({ map, at, route, onClose }: { map: MapLibreMap; at: LngLat; route: TaxiRoute; onClose: () => void }) {
  const [pt, setPt] = useState(() => map.project(at))
  useEffect(() => {
    const move = () => setPt(map.project(at))
    move()
    map.on('move', move)
    return () => {
      map.off('move', move)
    }
  }, [map, at])
  return (
    <div className="pointer-events-none absolute left-0 top-0 z-10" style={{ transform: `translate(${pt.x}px, ${pt.y}px)` }}>
      <div role="dialog" aria-label={`Taxi clearance for ${route.callsign}`} className="animate-pop pointer-events-auto absolute bottom-3 left-1/2 w-[min(18rem,80vw)] -translate-x-1/2 rounded-2xl bg-atc-card p-3 pr-2.5 text-white shadow-pop ring-1 ring-white/15">
        <div className="flex items-center gap-2">
          <AirlineLogo callsign={route.callsign} icao24={route.icao24} height={16} maxWidth={28} />
          <span className="text-subhead font-bold">{route.callsign}</span>
          <span className="text-caption text-white/60">{ago(route.at)}</span>
          <button type="button" aria-label="Close" className="pressable ml-auto grid size-7 place-items-center rounded-full bg-white/15 hover:bg-white/25" onClick={onClose}>
            <X className="size-3.5" strokeWidth={2.75} />
          </button>
        </div>
        <p className="mt-1.5 text-footnote font-semibold leading-snug">{route.summary}</p>
        <p className="mt-1.5 rounded-xl bg-black/20 px-2.5 py-2 text-footnote leading-snug text-white/85">“{route.text}”</p>
        {(!route.exact || route.missing.length > 0) && (
          <p className="mt-1.5 text-caption text-white/60">
            {route.missing.length ? `Not on the map: ${route.missing.join(', ')}. ` : ''}Route is a best guess.
          </p>
        )}
      </div>
      <span aria-hidden className="absolute left-0 top-0 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ring-2 ring-atc-card" />
    </div>
  )
}
