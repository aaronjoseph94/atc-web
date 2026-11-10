/**
 * Draws aircraft, their shadows and trails, and the highlight rings.
 *
 * Performance model: this component renders nothing and never causes React
 * re-renders per frame. It owns a single `requestAnimationFrame` loop that
 * samples the `LivePositionBuffer` (live mode) or the clip (playback) and
 * writes straight into GeoJSON sources. The layers themselves are declared
 * in `mapStyle.ts`.
 */
import { useEffect, useRef } from 'react'
import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from 'maplibre-gl'
import type { ClipPack } from '../api/types'
import { positionsAt, trackKeyFor, trailAt } from '../playback/interpolate'
import { playbackInstant, usePlayhead } from '../playback/playheadStore'
import type { LabelMode } from '../settings/settingsStore'
import { ATC_COLORS, speakerColors, type SpeakerColors } from '../ui/speaker'
import { metersPerDegLat, metersPerDegLon, metersPerPixel } from './geo'
import { AircraftFx, hideCoveredFins, LIVERY_MIN_ZOOM } from './fx/aircraftFx'
import type { LiveAircraft, LivePositionBuffer } from './livePositions'
import { ensureMapImages, ICON_REACH_PX, ICON_SCALE, iconFor, iconImage } from './mapImages'
import { iconZoomFactor, LAYER, SRC } from './mapStyle'
import { ParkedHeadings } from './parkedHeading'
import { attachTagImages, tagKey } from './tagImages'

type Props = {
  /** The loaded MapLibre instance (null until the style has loaded). */
  map: MapLibreMap | null
  liveBuffer: LivePositionBuffer
  labels: LabelMode
  dataBlocks: boolean
  hideGround: boolean
  trailLength: number
  trails: boolean
  shadows: boolean
  reduceMotion: boolean
  /** Field elevation, so shadows and data blocks can reason about height above ground. */
  elevationFt: number
  onSelect: (icao: string | null) => void
  /** Called every frame with what was drawn (camera follow reads it). */
  onFrame?: (aircraft: LiveAircraft[], dtMs: number) => void
}

/** Zoom at or above which moving aircraft are labelled in `auto` mode; parked ones need to be closer. */
/** Airborne aircraft carry a tag even on the wide view; taxiing ones only once the field is legible. */
const LABEL_AIRBORNE_ZOOM = 9.3
const LABEL_MOVING_ZOOM = 12.4
const LABEL_PARKED_ZOOM = 15.2
/** Background wakes are rebuilt at this interval; they don't need 60 fps. */
const WAKE_INTERVAL_MS = 220
/** Points kept in the faint wake behind non-selected aircraft. */
const WAKE_POINTS = 7
/** The plain marker (a parked aircraft whose heading nobody knows) stops growing past this zoom, so close in it stays a small dot rather than a disc the size of an airliner. */
const DOT_MAX_ZOOM = 14

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

export function AircraftLayer(props: Props) {
  const { map, liveBuffer } = props
  // Latest props, readable from the rAF loop without re-subscribing.
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
  })

  useEffect(() => {
    if (!map) return
    ensureMapImages(map)
    // A lost WebGL context drops images; MapLibre asks for them again by id.
    // Aircraft artwork is drawn per class when a feature first asks for it.
    const onMissing = (e: { id: string }) => ensureMapImages(map, e.id)
    map.on('styleimagemissing', onMissing)
    // Callsign tags are bitmaps drawn on demand.
    const detachTags = attachTagImages(map)

    const pick = (e: MapLayerMouseEvent) => {
      const icao = e.features?.[0]?.properties?.icao24
      return typeof icao === 'string' ? icao : null
    }
    // Aircraft sit above everything else, so a hit here must not also count as a map click.
    let handled = false
    const click = (e: MapLayerMouseEvent) => {
      const icao = pick(e)
      if (!icao) return
      handled = true
      latest.current.onSelect(icao)
    }
    const mapClick = () => {
      if (handled) {
        handled = false
        return
      }
      // Tapping empty map dismisses the selection, like tapping away from a card.
      if (usePlayhead.getState().selectedIcao) latest.current.onSelect(null)
    }
    const move = (e: MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = 'pointer'
      const icao = pick(e)
      if (icao !== usePlayhead.getState().hoverIcao) usePlayhead.getState().setHover(icao)
    }
    const leave = () => {
      map.getCanvas().style.cursor = ''
      usePlayhead.getState().setHover(null)
    }
    map.on('click', LAYER.hit, click)
    map.on('click', mapClick)
    map.on('mousemove', LAYER.hit, move)
    map.on('mouseleave', LAYER.hit, leave)

    // Lights, banking, contrails and the other aircraft effects (src/map/fx).
    const fx = new AircraftFx(map)
    // Nose-in headings for parked aircraft that don't report one.
    const parkedHeadings = new ParkedHeadings()

    const wakes = new Map<string, Feature<LineString>>()
    let wakesAt = 0
    // Speaker colours last pushed to the halo layers (only re-sent when they change).
    let haloTalk: SpeakerColors | null = null
    // What the trail and shadow sources last held, so unchanged data isn't sent again (each send re-tiles the source in the worker).
    let trailsMoving = false
    let shadowsOff = false
    let last = performance.now()
    let raf = 0

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame)
      const L = latest.current
      const acSrc = map.getSource(SRC.aircraft) as GeoJSONSource | undefined
      const trailSrc = map.getSource(SRC.trails) as GeoJSONSource | undefined
      const shadowSrc = map.getSource(SRC.shadows) as GeoJSONSource | undefined
      if (!acSrc || !trailSrc || !shadowSrc) return
      const dt = Math.min(100, t - last)
      last = t

      const st = usePlayhead.getState()
      const playing = st.mode === 'playback' && st.clip ? st.clip : null
      const tMs = playing ? playbackInstant(st) : 0
      const all: LiveAircraft[] = playing ? replayed(playing, tMs) : liveBuffer.sample(t)

      // Whoever is being talked about: the active cue in playback, the caption's aircraft in live.
      const active = (st.activeCallsign ?? (st.mode === 'live' ? st.caption?.icao24 : null))?.toLowerCase() ?? null
      const selected = st.selectedIcao
      const hover = st.hoverIcao
      const list = L.hideGround ? all.filter((a) => !a.onGround || a.icao24 === selected || a.icao24 === active) : all

      const zoom = map.getZoom()
      const features: Feature<Point>[] = []
      const shadows: Feature<Point>[] = []
      // Shadow falls down-screen and to the right, whatever way the map is turned.
      const mpp = metersPerPixel(map.getCenter().lat, zoom)
      const br = (map.getBearing() * Math.PI) / 180
      const sx = Math.cos(br) * 0.55 + Math.sin(br) * 0.83
      const sy = Math.sin(br) * 0.55 - Math.cos(br) * 0.83
      const canvas = map.getCanvas()
      fx.begin({ t, zoom, reduceMotion: L.reduceMotion, width: canvas.clientWidth, height: canvas.clientHeight })
      if (!playing) parkedHeadings.update(map, list, t)
      const dotCap = Math.min(1, iconZoomFactor(DOT_MAX_ZOOM) / iconZoomFactor(zoom))

      let anyHi = false
      let anyTx = false
      for (let a of list) {
        const isSelected = a.icao24 === selected
        const transmitting = a.icao24 === active
        const hi = isSelected || transmitting
        anyHi ||= hi
        anyTx ||= transmitting
        // A parked aircraft with no reported heading is drawn nose-in to its terminal when there is one.
        const guess = !playing && a.headingKnown === false ? parkedHeadings.get(a.icao24) : null
        if (guess != null) a = { ...a, heading: guess, headingKnown: true }
        const icon = iconFor(a)
        // Image for this frame (airborne helicopters cycle rotor frames).
        const image = iconImage(icon, !a.onGround, t, L.reduceMotion)
        const parked = a.onGround && (a.speedKt ?? 0) < 5
        const state = a.onGround ? (parked ? 0 : 1) : 2
        const agl = a.onGround || a.altitudeFt == null ? 0 : Math.max(0, a.altitudeFt - L.elevationFt)
        const wantLabel =
          L.labels !== 'never' &&
          icon !== 'ac-vehicle' &&
          (hi || a.icao24 === hover || L.labels === 'always' || zoom >= (parked ? LABEL_PARKED_ZOOM : a.onGround ? LABEL_MOVING_ZOOM : LABEL_AIRBORNE_ZOOM))
        const alert = a.emergency || a.squawk === '7700' || a.squawk === '7600' || a.squawk === '7500'
        const sub = wantLabel && L.dataBlocks && (hi || zoom >= 13.4) ? dataBlock(a, agl) : ''
        const fxa = fx.aircraft(a, icon, image, agl, parked, hi, wantLabel)

        features.push({
          type: 'Feature',
          properties: {
            icao24: a.icao24,
            callsign: a.callsign,
            sub,
            tag: wantLabel ? tagKey(a.callsign, a.icao24, hi, sub, t) : '',
            icon: fxa.image,
            scale: ICON_SCALE[icon] * fxa.scale * (icon === 'ac-dot' ? dotCap : 1),
            heading: icon === 'ac-dot' ? 0 : a.heading,
            hi: hi ? 1 : 0,
            tx: transmitting ? 1 : 0,
            state,
            lbl: wantLabel ? 1 : 0,
            alert: alert ? 1 : 0,
            o: a.opacity,
            // Higher aircraft draw on top; the highlighted one above all.
            z: hi ? 1e6 : agl,
            ...fxa.props,
          },
          geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
        })

        if (L.shadows && icon !== 'ac-dot') {
          // Offset grows with height and is capped, in screen pixels; on the
          // ground it is a soft contact shadow just below and to the right.
          // It opens up quickly just after lift-off (square root), so a
          // departure visibly leaves the ground, and a climbing aircraft's
          // shadow is a touch larger and further out (nose up, closer to the sun).
          const climb = a.onGround ? 0 : Math.max(0, Math.min(1, ((a.verticalRateFpm ?? 0) - 300) / 2000))
          const px = Math.min(28, 3 + 0.36 * Math.sqrt(agl) + 3 * climb)
          const east = sx * px * mpp
          const north = sy * px * mpp
          shadows.push({
            type: 'Feature',
            properties: { icon: fxa.shadowImage, sh: icon, bl: fxa.shadowBlur, scale: ICON_SCALE[icon] * fxa.scale * (hi ? 1.25 : 1) * (1 + Math.min(0.25, agl / 40000) + 0.05 * climb), heading: a.heading, o: a.opacity * (parked && !hi ? 0.6 : 1) * fxa.shadowFade },
            geometry: { type: 'Point', coordinates: [a.lon + east / metersPerDegLon(a.lat), a.lat + north / metersPerDegLat(a.lat)] },
          })
        }
      }
      // The fin colour layer sits over all the artwork: leave it off aircraft another one is drawn over.
      if (zoom >= LIVERY_MIN_ZOOM - 0.5) {
        const k = ICON_REACH_PX * iconZoomFactor(zoom)
        hideCoveredFins(features, (f) => k * Number(f.properties?.scale) * (f.properties?.hi ? 1.25 : 1), mpp)
      }
      acSrc.setData({ type: 'FeatureCollection', features })
      if (L.shadows) shadowSrc.setData({ type: 'FeatureCollection', features: shadows })
      else if (!shadowsOff) shadowSrc.setData(EMPTY)
      shadowsOff = !L.shadows

      // ---- trails ----------------------------------------------------------
      // Faint wakes behind everything airborne are rebuilt a few times a
      // second; the highlighted aircraft's trail is rebuilt every frame so it
      // stays glued to the icon.
      const rebuilt = t - wakesAt > WAKE_INTERVAL_MS
      if (rebuilt) {
        wakesAt = t
        wakes.clear()
        if (L.trails) {
          for (const a of list) {
            if (a.onGround) continue
            const coords = playing ? trailAt(playing.tracks[trackKeyFor(playing, a.icao24) ?? ''] ?? [], tMs, WAKE_POINTS) : liveBuffer.trail(a.icao24, WAKE_POINTS, t)
            if (coords.length >= 2) wakes.set(a.icao24, line(coords, 0))
          }
        }
      }
      const lines: Feature<LineString>[] = []
      const focus = selected ?? active
      // A contrail replaces the wake of an aircraft that leaves one.
      for (const [id, f] of wakes) if (id !== focus && !fx.hasContrail(id)) lines.push(f)
      const wakeCount = lines.length
      if (focus) {
        const coords = playing ? trailAt(playing.tracks[trackKeyFor(playing, focus) ?? ''] ?? [], tMs, L.trailLength * 4) : liveBuffer.trail(focus, L.trailLength, t)
        if (coords.length >= 2) lines.push(line(coords, 1))
      }
      // Contrails behind anything cruising high overhead, rebuilt every frame so they stay attached.
      for (const c of fx.contrails(list, (id) => (playing ? trailAt(playing.tracks[trackKeyFor(playing, id) ?? ''] ?? [], tMs, 16) : liveBuffer.trail(id, 16, t)))) lines.push(c)
      // The wakes alone only change when they are rebuilt; the focus trail and contrails follow their aircraft every frame.
      const moving = lines.length > wakeCount
      if (rebuilt || moving || trailsMoving) trailSrc.setData({ type: 'FeatureCollection', features: lines })
      trailsMoving = moving

      // ---- highlight rings ---------------------------------------------------
      // The aircraft being talked about wears the speaker's colour (purple while
      // ATC talks to it, blue while its pilot talks); a selected aircraft that
      // nobody is talking to keeps the plain purple selection look.
      // Only animated while someone wears them: each paint change re-evaluates the layer.
      const wave = L.reduceMotion ? 0 : Math.sin(t / 620)
      const talk = speakerColors(st.activeSpeaker)
      if (talk !== haloTalk) {
        haloTalk = talk
        const color = ['case', ['==', ['get', 'tx'], 1], talk.base, ATC_COLORS.base]
        map.setPaintProperty(LAYER.halo, 'circle-color', color as never)
        map.setPaintProperty(LAYER.haloOuter, 'circle-color', color as never)
        map.setPaintProperty(LAYER.ping, 'circle-stroke-color', talk.light)
      }
      if (anyHi) {
        map.setPaintProperty(LAYER.halo, 'circle-opacity', fading(0.36 + 0.06 * wave))
        map.setPaintProperty(LAYER.halo, 'circle-radius', 20 + 2 * wave)
        map.setPaintProperty(LAYER.haloOuter, 'circle-opacity', fading(0.2 + 0.05 * wave))
        map.setPaintProperty(LAYER.haloOuter, 'circle-radius', 36 + 5 * wave)
      }
      if (anyTx) {
        // Radar-style ping expanding from whoever is transmitting.
        const phase = L.reduceMotion ? 0.4 : (t % 1500) / 1500
        map.setPaintProperty(LAYER.ping, 'circle-radius', 12 + 34 * phase)
        map.setPaintProperty(LAYER.ping, 'circle-stroke-opacity', fading(L.reduceMotion ? 0.35 : 0.75 * (1 - phase) ** 1.6))
      }

      L.onFrame?.(list, dt)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      fx.clear()
      parkedHeadings.clear()
      detachTags()
      map.off('styleimagemissing', onMissing)
      map.off('click', LAYER.hit, click)
      map.off('click', mapClick)
      map.off('mousemove', LAYER.hit, move)
      map.off('mouseleave', LAYER.hit, leave)
    }
  }, [map, liveBuffer])

  return null
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Clip aircraft at `tMs`, fully opaque (replays don't fade). */
function replayed(clip: ClipPack, tMs: number): LiveAircraft[] {
  const list = positionsAt(clip, tMs) as LiveAircraft[]
  for (const a of list) a.opacity = 1
  return list
}

/** A ring's opacity scaled by its aircraft's own fade, so the halo leaves with an aircraft that drops out of the feed instead of pulsing on over empty ground. */
function fading(v: number): never {
  return ['*', v, ['get', 'o']] as never
}

function line(coordinates: [number, number][], sel: 0 | 1): Feature<LineString> {
  return { type: 'Feature', properties: { sel }, geometry: { type: 'LineString', coordinates } }
}

/**
 * Second label line, in the style of a controller's data block: altitude in
 * hundreds of feet with a climb/descent arrow, then the type.
 * `045↑ B738` = 4,500 ft and climbing.
 */
export function dataBlock(a: { onGround: boolean; altitudeFt: number | null; verticalRateFpm?: number | null; type?: string | null; speedKt: number | null }, aglFt: number): string {
  const parts: string[] = []
  if (a.onGround) {
    if ((a.speedKt ?? 0) >= 5) parts.push(`${Math.round(a.speedKt ?? 0)}kt`)
  } else if (a.altitudeFt != null) {
    const vr = a.verticalRateFpm ?? 0
    const trend = vr > 300 ? '↑' : vr < -300 ? '↓' : ''
    parts.push(`${String(Math.max(0, Math.round(a.altitudeFt / 100))).padStart(3, '0')}${trend}`)
  } else if (aglFt > 0) parts.push('air')
  if (a.type) parts.push(a.type)
  return parts.length ? `\n${parts.join(' ')}` : ''
}
