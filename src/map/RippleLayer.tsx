/**
 * The transmission ripple: while a call is on the air and matched to an
 * aircraft, soft arcs travel between the tower and that aircraft. ATC
 * calls ripple purple from the tower out to the aircraft; pilot calls ripple
 * blue from the aircraft back to the tower (see `ui/speaker.ts`).
 *
 * "On the air" means: in a replay, while the cue is being spoken; live, for
 * about the length of the call once its caption arrives (live transcripts
 * land just after the call ends, so the ripple accompanies the caption).
 *
 * Like `AircraftLayer`, this renders nothing in React. One rAF loop writes a
 * few features into a GeoJSON source declared in `mapStyle.ts`; with nothing
 * on the air it only reads two stores per frame. Reduced motion shows a
 * still guide line between the two parties instead of travelling waves.
 */
import { useEffect, useRef } from 'react'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import type { AirportConfig } from '../api/airports'
import { useRadio } from '../live/radio/radioStore'
import { liveBuffer } from '../live/session'
import { positionsAt } from '../playback/interpolate'
import { playbackInstant, usePlayhead } from '../playback/playheadStore'
import { speakerColors, speakerDirection, type RadioSpeaker } from '../ui/speaker'
import { distanceM, metersPerPixel } from './geo'
import { burstDone, liveRippleMs, rippleEnvelope, rippleFeatures } from './ripple'
import { SRC } from './mapStyle'

type Props = { map: MapLibreMap | null; airport: AirportConfig; reduceMotion: boolean }

/** One call's ripple: who, which way, and when it started and stopped emitting. */
type Burst = { key: string; target: string; speaker: RadioSpeaker; start: number; stopAt: number | null }

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
/** A tower mapped further than this from the airport is somebody else's. */
const TOWER_MAX_M = 6000

export function RippleLayer({ map, airport, reduceMotion }: Props) {
  const latest = useRef({ airport, reduceMotion })
  useEffect(() => {
    latest.current = { airport, reduceMotion }
  })

  useEffect(() => {
    if (!map) return
    let raf = 0
    const osReduce = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : null
    let burst: Burst | null = null
    let drawn = false
    // A caption already up when the map loads is old news: don't ripple it.
    let captionId: string | null = useRadio.getState().caption?.id ?? null
    let mode = usePlayhead.getState().mode
    const towers = new Map<string, { at: [number, number]; checkedAt: number; found: boolean }>()

    /** The control tower if the map data has it near the field, else the airport reference point. */
    const towerFor = (a: AirportConfig, now: number): [number, number] => {
      const known = towers.get(a.icao)
      if (known && (known.found || now - known.checkedAt < 30_000)) return known.at
      const found = findTower(map, a)
      towers.set(a.icao, { at: found ?? a.center, checkedAt: now, found: !!found })
      return found ?? a.center
    }

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame)
      const src = map.getSource(SRC.ripple) as GeoJSONSource | undefined
      if (!src) return
      const apt = latest.current.airport
      const still = latest.current.reduceMotion || !!osReduce?.matches
      const ph = usePlayhead.getState()
      if (ph.mode !== mode) {
        // Entering or leaving a replay: whatever was rippling belongs to the other world.
        mode = ph.mode
        burst = null
        captionId = useRadio.getState().caption?.id ?? null
      }

      // ---- what is on the air ------------------------------------------------
      if (ph.mode === 'playback') {
        const id = ph.activeCallsign?.toLowerCase() ?? null
        const key = id ? `pb|${id}|${ph.activeSpeaker ?? ''}` : null
        if (key !== (burst?.stopAt == null ? burst?.key : null)) {
          if (burst && burst.stopAt == null) burst.stopAt = t - burst.start
          if (id && key) burst = { key, target: id, speaker: ph.activeSpeaker, start: t, stopAt: null }
        }
      } else {
        const cap = useRadio.getState().caption
        if (cap?.id !== captionId) {
          captionId = cap?.id ?? null
          const id = cap ? (cap.icao24 ?? cap.callsigns.find((c) => c.icao24)?.icao24 ?? null) : null
          if (cap && id && ph.stationId === cap.stationId) {
            if (burst && burst.stopAt == null) burst.stopAt = t - burst.start
            burst = { key: cap.id, target: id, speaker: cap.speaker, start: t, stopAt: liveRippleMs(cap.durationMs) }
          }
        }
      }

      if (!burst) {
        if (drawn) src.setData(EMPTY)
        drawn = false
        return
      }
      const elapsed = t - burst.start
      if (burstDone(elapsed, burst.stopAt ?? Infinity) || (still && burst.stopAt != null && elapsed > burst.stopAt)) {
        burst = null
        return
      }

      // ---- where the two ends are --------------------------------------------
      const plane = ph.mode === 'playback' && ph.clip ? positionsAt(ph.clip, playbackInstant(ph)).find((a) => a.icao24 === burst!.target) : liveBuffer.get(burst.target, t)
      if (!plane) {
        if (drawn) src.setData(EMPTY)
        drawn = false
        return
      }
      const tower = towerFor(apt, t)
      const aircraft: [number, number] = [plane.lon, plane.lat]
      // Too close to tell apart on screen: nothing worth drawing.
      if (distanceM(tower, aircraft) < 40) return
      const [from, to] = speakerDirection(burst.speaker) === 'to-aircraft' ? [tower, aircraft] : [aircraft, tower]
      const color = speakerColors(burst.speaker).light
      const env = rippleEnvelope(elapsed, burst.stopAt != null && elapsed > burst.stopAt ? burst.stopAt : null)
      const mpp = metersPerPixel(map.getCenter().lat, map.getZoom())
      const features: Feature<Geometry>[] = rippleFeatures(from, to, elapsed, burst.stopAt ?? Infinity, mpp, color, still ? { beam: Math.min(1, env.beam * 1.8), waves: 0 } : env)
      // A small soft light where the tower stands, so the ripple has an end.
      features.push({ type: 'Feature', properties: { kind: 'tower', c: color, o: env.beam }, geometry: { type: 'Point', coordinates: tower } })
      src.setData({ type: 'FeatureCollection', features })
      drawn = true
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ;(map.getSource(SRC.ripple) as GeoJSONSource | undefined)?.setData(EMPTY)
    }
  }, [map])

  return null
}

/**
 * A control tower in the loaded map data near the airport. OpenStreetMap
 * tags them `aeroway=tower` or `man_made=tower` + `tower:type=…`; the
 * OpenMapTiles schema mostly drops them, so this usually finds nothing and
 * the airport reference point stands in.
 */
function findTower(map: MapLibreMap, airport: AirportConfig): [number, number] | null {
  try {
    const feats = map.querySourceFeatures('omt', { sourceLayer: 'poi' })
    let best: [number, number] | null = null
    let bestD = TOWER_MAX_M
    for (const f of feats) {
      const p = f.properties ?? {}
      const tower = p.subclass === 'tower' || p.class === 'tower' || /\b(control tower|atct|atc tower)\b/i.test(String(p.name ?? ''))
      if (!tower || f.geometry.type !== 'Point') continue
      const at = f.geometry.coordinates as [number, number]
      const d = distanceM(airport.center, at)
      if (d < bestD) {
        bestD = d
        best = at
      }
    }
    return best
  } catch {
    return null
  }
}
