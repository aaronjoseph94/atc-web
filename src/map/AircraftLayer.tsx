/**
 * Draws aircraft, their shadows and trails, and the highlight rings.
 *
 * Performance model: this component renders nothing and never causes React
 * re-renders per frame. It owns a single `requestAnimationFrame` loop that
 * samples the `LivePositionBuffer` (live mode) or the clip (playback) and
 * writes straight into GeoJSON sources. The layers themselves are declared
 * in `mapStyle.ts`.
 *
 * A `setData` is the expensive part (MapLibre re-cuts the source's tiles,
 * redoes tag collision and re-uploads each tile's icon atlas), so a frame is
 * only sent when something on screen visibly changed (`sendGate.ts`); the
 * blinking lights live in their own small source so a strobe flash doesn't
 * re-send every tag; and the halo pulse is animated with plain paint values,
 * which (unlike data-driven ones) don't make MapLibre re-cut the source.
 */
import { useEffect, useRef } from 'react'
import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from 'maplibre-gl'
import type { ClipPack } from '../api/types'
import { positionsAt, trackKeyFor, trailAt } from '../playback/interpolate'
import { playbackInstant, usePlayhead } from '../playback/playheadStore'
import type { LabelMode } from '../settings/settingsStore'
import { speakerColors } from '../ui/speaker'
import { metersPerDegLat, metersPerDegLon, metersPerPixel } from './geo'
import { AircraftFx, hideCoveredFins, LIVERY_MIN_ZOOM } from './fx/aircraftFx'
import type { LiveAircraft, LivePositionBuffer } from './livePositions'
import { addImageHandler } from './imageResolver'
import { ensureMapImages, ICON_REACH_PX, ICON_SCALE, iconFor, iconImage } from './mapImages'
import { iconZoomFactor, LAYER, SRC, TALK_WAVE_LAYERS } from './mapStyle'
import { formatColor, mixColor, parseColor, type Rgba } from './lighting/color'
import { ParkedHeadings } from './parkedHeading'
import { TALK_FADE_OUT_MS, talkFade, talkWaves } from './talkWaves'
import { attachTagImages, tagKey } from './tagImages'
import { inBox, SendGate, type GateItem } from './sendGate'
import { noteSend, perfFrame, quality } from '../perf/governor'

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
/** Everything is re-sent at least this often, so aircraft off screen are never far behind when the map pans to them. */
const MAX_STALE_MS = 1000
/** Parked aircraft hardly move; off screen, nobody minds if one is a few seconds behind. */
const PARKED_STALE_MS = 10_000
/** Aircraft this far outside the view (as a fraction of its size) still count as on screen: tags and shadows reach past the point. */
const VIEW_MARGIN = 0.12
/** The talk waves take this long to turn from one speaker's colour to the other's. */
const TALK_COLOR_MS = 520

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
    const detachImages = addImageHandler(map, (m, id) => ensureMapImages(m, id))
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
    // The aircraft on the radio and when its call began; and the one whose waves are still ebbing after its call ended.
    let talkId: string | null = null
    let talkStart = 0
    let ghostId: string | null = null
    let ghostStart = 0
    let ghostEnd = 0
    // The talking colour on the map now, where it is heading and since when (pink to blue glides rather than snaps).
    let talkHex = ''
    let talkFrom: Rgba | null = null
    let talkTo: Rgba | null = null
    let talkTurnAt = 0
    // What the trail and shadow sources last held, so unchanged data isn't sent again (each send re-tiles the source in the worker).
    let trailsMoving = false
    let shadowsOff = false
    // Aircraft and shadows go to the map only when something visibly changed; the parked ones on their own,
    // so they aren't re-sent (tags and all) every time something taxies past them.
    const gate = new SendGate()
    const parkedGate = new SendGate()
    // The aircraft as last sent: the lights are drawn on these, so a light-only update stays registered with the airframe.
    let sentMoving = new Map<string, Feature<Point>>()
    let sentParked = new Map<string, Feature<Point>>()
    let fxKeySent = ''
    let last = performance.now()
    let raf = 0

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame)
      const L = latest.current
      const acSrc = map.getSource(SRC.aircraft) as GeoJSONSource | undefined
      const trailSrc = map.getSource(SRC.trails) as GeoJSONSource | undefined
      const shadowSrc = map.getSource(SRC.shadows) as GeoJSONSource | undefined
      const fxSrc = map.getSource(SRC.fx) as GeoJSONSource | undefined
      const parkedSrc = map.getSource(SRC.parked) as GeoJSONSource | undefined
      const parkedShadowSrc = map.getSource(SRC.parkedShadows) as GeoJSONSource | undefined
      if (!acSrc || !trailSrc || !shadowSrc || !fxSrc || !parkedSrc || !parkedShadowSrc) return
      perfFrame(t - last, t)
      const Q = quality()
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
      // Each aircraft's shadow (null for none), by index into `features`.
      const shadowOf: (Feature<Point> | null)[] = []
      // Shadow falls down-screen and to the right, whatever way the map is turned.
      const mpp = metersPerPixel(map.getCenter().lat, zoom)
      const br = (map.getBearing() * Math.PI) / 180
      const sx = Math.cos(br) * 0.55 + Math.sin(br) * 0.83
      const sy = Math.sin(br) * 0.55 - Math.cos(br) * 0.83
      const canvas = map.getCanvas()
      fx.begin({ t, zoom, reduceMotion: L.reduceMotion, width: canvas.clientWidth, height: canvas.clientHeight })
      if (!playing) parkedHeadings.update(map, list, t)
      const dotCap = Math.min(1, iconZoomFactor(DOT_MAX_ZOOM) / iconZoomFactor(zoom))
      const view = map.getBounds()
      const box = { west: view.getWest(), south: view.getSouth(), east: view.getEast(), north: view.getNorth() }
      const items: GateItem[] = []
      // Lights and exhaust, per aircraft, for the separate fx source.
      const fxProps = new Map<string, { lt: string; lo: number; ex: string; exo: number }>()
      let fxKey = ''
      const reachK = ICON_REACH_PX * iconZoomFactor(zoom)

      // A call starting or ending: the waves fade in, and ebb away on the aircraft for a moment after it ends.
      if (active !== talkId) {
        if (active) {
          ghostId = null
          talkStart = t
        } else if (talkId && !L.reduceMotion) {
          ghostId = talkId
          ghostStart = talkStart
          ghostEnd = t
        }
        talkId = active
      }
      if (ghostId && t - ghostEnd > TALK_FADE_OUT_MS) ghostId = null

      let anySel = false
      let anyTx = false
      // Fade of the selected and the transmitting aircraft, for their halo and waves.
      let selFade = 0
      let txFade = 0
      for (let a of list) {
        const isSelected = a.icao24 === selected
        const transmitting = a.icao24 === active
        const hi = isSelected || transmitting
        // Wears the talk waves: on the radio now, or just off it (a selected aircraft goes straight back to its selection halo).
        const onAir = transmitting || (a.icao24 === ghostId && !isSelected)
        anySel ||= isSelected && !onAir
        anyTx ||= onAir
        if (isSelected && !onAir) selFade = a.opacity
        if (onAir) txFade = a.opacity
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

        const vis = inBox(a.lon, a.lat, box, VIEW_MARGIN)
        // Blinking lights and the exhaust shimmer go to their own source; off screen they're left dark.
        const { lt, lo, ex, exo, ...drawn } = fxa.props
        if (vis && (lt || ex)) {
          fxProps.set(a.icao24, { lt, lo, ex, exo })
          fxKey += `${a.icao24}:${lt}:${ex}:${lo}:${exo};`
        }
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
            tx: onAir ? 1 : 0,
            state,
            lbl: wantLabel ? 1 : 0,
            alert: alert ? 1 : 0,
            o: a.opacity,
            // Higher aircraft draw on top; the highlighted one above all.
            z: hi ? 1e6 : agl,
            ...drawn,
          },
          geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
        })

        let shadowAt: [number, number] | null = null
        let shadow: Feature<Point> | null = null
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
          shadowAt = [a.lon + east / metersPerDegLon(a.lat), a.lat + north / metersPerDegLat(a.lat)]
          shadow = {
            type: 'Feature',
            properties: { icon: fxa.shadowImage, sh: icon, bl: fxa.shadowBlur, scale: ICON_SCALE[icon] * fxa.scale * (hi ? 1.25 : 1) * (1 + Math.min(0.25, agl / 40000) + 0.05 * climb), heading: a.heading, o: a.opacity * (parked && !hi ? 0.6 : 1) * fxa.shadowFade },
            geometry: { type: 'Point', coordinates: shadowAt },
          }
        }
        shadowOf.push(shadow)
        // Filled in below, once the fin pass has settled what each aircraft shows.
        items.push({ id: a.icao24, lon: a.lon, lat: a.lat, shadow: shadowAt, heading: 0, reachPx: 0, scale: 1, o: a.opacity, eo: 1, key: shadowAt ? `${fxa.shadowImage}|${fxa.shadowBlur}` : '', vis })
      }
      // The fin colour layer sits over all the artwork: leave it off aircraft another one is drawn over.
      if (zoom >= LIVERY_MIN_ZOOM - 0.5) {
        const k = ICON_REACH_PX * iconZoomFactor(zoom)
        hideCoveredFins(features, (f) => k * Number(f.properties?.scale) * (f.properties?.hi ? 1.25 : 1), mpp)
      }
      // Split into the parked aircraft (not highlighted) and everything else, and fill in what the gates
      // compare: where each aircraft and its shadow are, how it's turned and sized, and everything else drawn.
      const movingF: Feature<Point>[] = []
      const movingShadows: Feature<Point>[] = []
      const movingItems: GateItem[] = []
      const parked: Feature<Point>[] = []
      const parkedShadows: Feature<Point>[] = []
      const parkedItems: GateItem[] = []
      // How far the talking and the selected aircraft's artwork reaches on screen, to size their waves and halo.
      let txReach = 0
      let selReach = 0
      for (let i = 0; i < features.length; i++) {
        const f = features[i]
        const p = f.properties!
        const it = items[i]
        it.heading = Number(p.heading) || 0
        it.scale = Number(p.scale) || 1
        it.reachPx = reachK * it.scale * (p.hi ? 1.25 : 1)
        if (p.tx) txReach = it.reachPx
        else if (p.hi) selReach = it.reachPx
        it.eo = Number(p.eo ?? 1)
        it.key += `|${p.icon}|${p.tag}|${p.hi}|${p.tx}|${p.state}|${p.lbl}|${p.alert}|${p.lv}|${p.ll}|${p.sub}`
        if (p.state === 0 && !p.hi) {
          parked.push(f)
          parkedItems.push(it)
          if (shadowOf[i]) parkedShadows.push(shadowOf[i]!)
          // The aircraft source keeps a bare point for it: the tap target (and hover) cover every aircraft.
          movingF.push({ type: 'Feature', properties: { icao24: p.icao24, ps: 1, hi: 0, tx: p.tx, state: 0, o: p.o }, geometry: f.geometry })
        } else {
          movingF.push(f)
          movingItems.push(it)
          if (shadowOf[i]) movingShadows.push(shadowOf[i]!)
        }
      }
      const gateOpts = { motionPx: Q.motionPx, minSendMs: Q.minSendMs, maxStaleMs: MAX_STALE_MS }
      const shadowsToggled = shadowsOff !== !L.shadows
      const parkedReason = parkedGate.check(parkedItems, t, mpp, { ...gateOpts, maxStaleMs: PARKED_STALE_MS }) ?? (shadowsToggled ? 'key' : null)
      // The aircraft source carries the parked aircraft's tap targets, so it goes whenever they do.
      const reason = gate.check(movingItems, t, mpp, gateOpts) ?? (shadowsToggled ? 'key' : parkedReason)
      if (reason) noteSend(reason)
      if (parkedReason) noteSend(`parked-${parkedReason}`)
      const acSent = reason != null
      if (parkedReason) {
        parkedGate.commit(parkedItems, t)
        parkedSrc.setData({ type: 'FeatureCollection', features: parked })
        parkedShadowSrc.setData(L.shadows ? { type: 'FeatureCollection', features: parkedShadows } : EMPTY)
        sentParked = new Map(parked.map((f) => [String(f.properties!.icao24), f]))
      }
      if (acSent) {
        gate.commit(movingItems, t)
        acSrc.setData({ type: 'FeatureCollection', features: movingF })
        if (L.shadows) shadowSrc.setData({ type: 'FeatureCollection', features: movingShadows })
        else if (!shadowsOff) shadowSrc.setData(EMPTY)
        shadowsOff = !L.shadows
        sentMoving = new Map(movingF.filter((f) => !f.properties!.ps).map((f) => [String(f.properties!.icao24), f]))
      }
      // Lights: whenever one blinks, drawn on the aircraft as last sent.
      if (acSent || parkedReason || fxKey !== fxKeySent) {
        fxKeySent = fxKey
        const fxFeatures: Feature<Point>[] = []
        for (const [id, v] of fxProps) {
          const f = sentMoving.get(id) ?? sentParked.get(id)
          if (!f) continue
          const p = f.properties!
          fxFeatures.push({ type: 'Feature', properties: { heading: p.heading, scale: p.scale, hi: p.hi, z: p.z, o: p.o, sh: p.sh, ...v }, geometry: f.geometry })
        }
        fxSrc.setData({ type: 'FeatureCollection', features: fxFeatures })
      }

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
      for (const c of fx.contrails(Q.contrails ? list : [], (id) => (playing ? trailAt(playing.tracks[trackKeyFor(playing, id) ?? ''] ?? [], tMs, 16) : liveBuffer.trail(id, 16, t)))) lines.push(c)
      // The wakes alone only change when they are rebuilt; the focus trail and contrails follow their aircraft, so they go whenever the aircraft do.
      const moving = lines.length > wakeCount
      if (rebuilt || (acSent && (moving || trailsMoving))) {
        trailSrc.setData({ type: 'FeatureCollection', features: lines })
        trailsMoving = moving
      }

      // ---- selection halo and talk waves ---------------------------------------
      // The aircraft on the radio wears soft waves in the speaker's colour (pink
      // while the tower talks to it, blue while its pilot talks); a selected
      // aircraft that nobody is talking to keeps the violet selection discs.
      // Only animated while someone wears them: each paint change re-evaluates the layer.
      // Plain numbers, not expressions reading the feature: a data-driven paint value makes MapLibre
      // re-cut the whole aircraft source on every change, which here would be every frame. They
      // still fade with their aircraft (one dropping out of the feed) through `selFade` and `txFade`.
      if (anySel) {
        const breath = L.reduceMotion ? 0 : Math.sin(t / 620)
        // Sized to the aircraft, so close in the discs still ring it instead of hiding under it.
        const inner = Math.max(19, Math.min(58, selReach * 1.1))
        map.setPaintProperty(LAYER.halo, 'circle-opacity', (0.3 + 0.05 * breath) * selFade)
        map.setPaintProperty(LAYER.halo, 'circle-radius', inner + 0.08 * inner * breath)
        map.setPaintProperty(LAYER.haloOuter, 'circle-opacity', (0.16 + 0.04 * breath) * selFade)
        map.setPaintProperty(LAYER.haloOuter, 'circle-radius', inner * (1.75 + 0.12 * breath))
      }
      if (anyTx) {
        // Colour: the speaker's, gliding from one to the other when the pilot answers the tower.
        const hex = speakerColors(st.activeSpeaker).base
        const turned = (now: number) => {
          const k = Math.min(1, (now - talkTurnAt) / TALK_COLOR_MS)
          return k * k * (3 - 2 * k)
        }
        if (talkId && hex !== talkHex) {
          const shown = talkTo && talkFrom ? mixColor(talkFrom, talkTo, turned(t)) : null
          talkHex = hex
          talkTo = parseColor(hex)
          // A call that has only just begun has nothing on screen to glide from.
          talkFrom = shown && t - talkStart > 120 && !L.reduceMotion ? shown : talkTo
          talkTurnAt = t
        }
        if (talkTo && talkFrom) {
          const k = turned(t)
          const color = k >= 1 || talkFrom === talkTo ? talkHex : formatColor(mixColor(talkFrom, talkTo, k))
          if (k >= 1) talkFrom = talkTo
          if (map.getPaintProperty(LAYER.talkGlow, 'circle-color') !== color) {
            map.setPaintProperty(LAYER.talkGlow, 'circle-color', color)
            for (const id of TALK_WAVE_LAYERS) map.setPaintProperty(id, 'circle-stroke-color', color)
          }
        }
        const fade = (L.reduceMotion ? 1 : talkId ? talkFade(t, talkStart, null) : talkFade(t, ghostStart, ghostEnd)) * txFade
        const w = talkWaves(t - talkStart, txReach, L.reduceMotion)
        map.setPaintProperty(LAYER.talkGlow, 'circle-radius', w.glow.radius)
        map.setPaintProperty(LAYER.talkGlow, 'circle-opacity', w.glow.opacity * fade)
        w.rings.forEach((ring, i) => {
          const id = TALK_WAVE_LAYERS[i]
          map.setPaintProperty(id, 'circle-radius', ring.radius)
          map.setPaintProperty(id, 'circle-stroke-width', ring.stroke)
          map.setPaintProperty(id, 'circle-stroke-opacity', ring.opacity * fade)
        })
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
      detachImages()
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
