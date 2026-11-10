/**
 * Draws the latest instruction each aircraft was given as a small chip under
 * it on the map ("↑5,000", "HDG 270", "→124.75"), following the aircraft
 * every frame and fading out after about two minutes or when a newer
 * instruction replaces it. Also starts the AI pass over live calls (the map
 * is always mounted, as the taxi routes' watcher is).
 *
 * Renders nothing in React: a frame loop writes a few features into a
 * GeoJSON source, and only runs while there are badges to show.
 */
import type { FeatureCollection, Feature, Point } from 'geojson'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { useEffect } from 'react'
import { INSTR_SRC, instructionBadgeLayers, LAYER } from '../../../map/mapStyle'
import { usePlayhead } from '../../../playback/playheadStore'
import { useReducedMotion } from '../../../ui/motion'
import { liveBuffer } from '../../session'
import { activeBadges, badgeOpacity } from './badges'
import { useUnderstanding } from './store'
import { startUnderstanding } from './understand'

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
const FADE_IN_MS = 300
/** How often the list of badges is recomputed (their positions update every frame). */
const RECOMPUTE_MS = 1000

let canvas: HTMLCanvasElement | null = null

/** A rounded dark chip with the label in the UI font, at the screen's pixel ratio. */
function drawBadge(label: string, dpr: number): ImageData | null {
  canvas ??= document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  const family = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif'
  const font = `650 11px ${family}`
  ctx.font = font
  const textW = Math.ceil(ctx.measureText(label).width)
  const h = 19
  const w = textW + 14
  canvas.width = Math.ceil((w + 2) * dpr)
  canvas.height = Math.ceil((h + 2) * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w + 2, h + 2)
  ctx.beginPath()
  ctx.roundRect(1, 1, w, h, h / 2)
  ctx.fillStyle = 'rgba(20,23,33,0.92)'
  ctx.fill()
  // A thin ring in the controller's purple: these are ATC's words.
  ctx.strokeStyle = 'rgba(169,148,255,0.7)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.font = font
  ctx.fillStyle = '#FFFFFF'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, 8, 1 + h / 2 + 0.5)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

export function InstructionBadgeLayer({ map }: { map: MapLibreMap | null }) {
  const reduceMotion = useReducedMotion()

  useEffect(() => startUnderstanding(), [])

  useEffect(() => {
    if (!map) return
    if (!map.getSource(INSTR_SRC)) map.addSource(INSTR_SRC, { type: 'geojson', data: EMPTY })
    // Over the aircraft, under their callsign tags.
    const before = map.getLayer('ac-label-parked') ? 'ac-label-parked' : map.getLayer(LAYER.label) ? LAYER.label : undefined
    for (const layer of instructionBadgeLayers()) if (!map.getLayer(layer.id)) map.addLayer(layer, before)
  }, [map])

  useEffect(() => {
    if (!map) return
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
    const shownAt = new Map<string, number>()
    let badges: ReturnType<typeof activeBadges> = []
    let computedAt = -Infinity
    let raf = 0
    let running = false
    let drawn = false

    const frame = (t: number) => {
      raf = 0
      const src = map.getSource(INSTR_SRC) as GeoJSONSource | undefined
      const ph = usePlayhead.getState()
      const now = Date.now()
      if (t - computedAt > RECOMPUTE_MS) {
        computedAt = t
        badges = ph.mode === 'live' ? activeBadges(Object.values(useUnderstanding.getState().results), ph.airportIcao, now) : []
      }
      const features: Feature<Point>[] = []
      for (const b of badges) {
        const a = liveBuffer.get(b.icao24, t)
        if (!a) continue
        const img = `ib:${b.label}`
        if (!map.hasImage(img)) {
          const data = drawBadge(b.label, dpr)
          if (!data) continue
          map.addImage(img, data, { pixelRatio: dpr })
        }
        const key = `${b.id}|${b.icao24}`
        if (!shownAt.has(key)) shownAt.set(key, t)
        const fin = reduceMotion ? 1 : Math.min(1, (t - shownAt.get(key)!) / FADE_IN_MS)
        features.push({ type: 'Feature', properties: { img, o: fin * badgeOpacity(now - b.at) * (a.opacity ?? 1) }, geometry: { type: 'Point', coordinates: [a.lon, a.lat] } })
      }
      if (features.length || drawn) src?.setData({ type: 'FeatureCollection', features })
      drawn = features.length > 0
      if (badges.length) raf = requestAnimationFrame(frame)
      else running = false
    }
    const kick = () => {
      computedAt = -Infinity
      if (running) return
      running = true
      raf = requestAnimationFrame(frame)
    }
    kick()
    const offU = useUnderstanding.subscribe((s, prev) => {
      if (s.results !== prev.results) kick()
    })
    const offP = usePlayhead.subscribe((s, prev) => {
      if (s.mode !== prev.mode || s.airportIcao !== prev.airportIcao) kick()
    })
    return () => {
      offU()
      offP()
      cancelAnimationFrame(raf)
      running = false
      ;(map.getSource(INSTR_SRC) as GeoJSONSource | undefined)?.setData(EMPTY)
    }
  }, [map, reduceMotion])

  return null
}

