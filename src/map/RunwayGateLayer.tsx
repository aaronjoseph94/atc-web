/**
 * Live airfield state on the map: which runways are in use (a badge by the
 * designator and a glow along the runway's first stretch) and which gates
 * have an aircraft parked at them (the gate chip takes the airline's colour).
 * Tapping a gate shows who is parked there, or that it is free.
 *
 * Every couple of seconds it reads the smoothed live positions and the tower
 * log, updates the pure trackers (`runwayUse`, `gates`), publishes the result
 * to `useAirfield` for the panels and pushes it into the map sources.
 */
import type { Feature, FeatureCollection } from 'geojson'
import type { GeoJSONSource, MapMouseEvent, MapTouchEvent, Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getAirport } from '../api/airports'
import { logoFor, logoPicture } from '../airline/logos'
import { useNow } from '../hooks/useNow'
import { useAirfield } from '../live/airfield'
import { describeGate, dominantColour, matchGates, textOn, trackParking, type Gate, type ParkingState } from '../live/gates'
import { activeRunways, createRunwayUse, observeEvents, observeTraffic, runwaysFromAtis, type ActiveRunways } from '../live/runwayUse'
import { liveBuffer } from '../live/session'
import { usePlayhead } from '../playback/playheadStore'
import { useWeather } from '../station/StationBar'
import { CloseButton } from '../ui/Panel'
import { usePresence } from '../ui/usePresence'
import { buildAirportDiagram, runwayEnds, widthScale } from './airportDiagram'
import { distanceM, offset, type LngLat } from './geo'
import { LAYER, RUNWAY_USE_COLOR, SRC } from './mapStyle'

const TICK_MS = 2000
/** Gates further than this from the airport's centre belong to someone else's map. */
const GATE_RADIUS_M = 7000
/** Chip colour when the airline's logo has no strong colour (or hasn't loaded yet). */
const NEUTRAL_CHIP = '#E9ECF2'
const GATE_LAYERS = ['aero-gate', 'aero-gate-dot', LAYER.gateBusy, LAYER.gateBusyDot]
const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }

function setData(map: MapLibreMap, id: string, data: FeatureCollection) {
  ;(map.getSource(id) as GeoJSONSource | undefined)?.setData(data)
}

// ---- images ---------------------------------------------------------------

/** Round badge with an arrow: down for arrivals, up for departures; both side by side for both. */
function badge(role: 'arrivals' | 'departures' | 'both'): ImageData {
  const s = 2 // drawn at 2× for sharpness
  const d = 13 * s
  const w = role === 'both' ? d * 2 - 3 * s : d
  const canvas = document.createElement('canvas')
  canvas.width = w + 4 * s
  canvas.height = d + 4 * s
  const ctx = canvas.getContext('2d')!
  const disc = (cx: number, color: string, up: boolean) => {
    const cy = canvas.height / 2
    ctx.beginPath()
    ctx.arc(cx, cy, d / 2, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.lineWidth = 1.5 * s
    ctx.strokeStyle = 'rgba(12,16,34,0.9)'
    ctx.stroke()
    // Arrow: a short shaft and an open head.
    const dir = up ? -1 : 1
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 1.7 * s
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(cx, cy - dir * 3.6 * s)
    ctx.lineTo(cx, cy + dir * 3.6 * s)
    ctx.moveTo(cx - 3 * s, cy + dir * 0.8 * s)
    ctx.lineTo(cx, cy + dir * 3.8 * s)
    ctx.lineTo(cx + 3 * s, cy + dir * 0.8 * s)
    ctx.stroke()
  }
  const x0 = 2 * s + d / 2
  if (role === 'both') {
    disc(x0 + d - 3 * s, RUNWAY_USE_COLOR.departures, true)
    disc(x0, RUNWAY_USE_COLOR.arrivals, false)
  } else disc(x0, RUNWAY_USE_COLOR[role], role === 'departures')
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

/** Stretchable gate chip in a colour, the occupied twin of `gate-chip`. */
function addChip(map: MapLibreMap, id: string, fill: string) {
  if (map.hasImage(id)) return
  const s = 32
  const canvas = document.createElement('canvas')
  canvas.width = s
  canvas.height = s
  const ctx = canvas.getContext('2d')!
  ctx.beginPath()
  ctx.roundRect(1, 1, s - 2, s - 2, 3)
  ctx.fillStyle = fill
  ctx.fill()
  // A thin light rim sets it apart from the amber free chips, even in a dark airline colour.
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'
  ctx.stroke()
  const inset = 5
  map.addImage(id, ctx.getImageData(0, 0, s, s), { pixelRatio: 2, stretchX: [[inset, s - inset]], stretchY: [[inset, s - inset]], content: [inset, inset, s - inset, s - inset] })
}

/** Logo colours already worked out, by airline code. */
const logoColours = new Map<string, string | null>()

function airlineColour(callsign: string, icao24: string): string | null {
  const logo = logoFor(callsign, icao24)
  if (!logo) return null
  if (logoColours.has(logo.code)) return logoColours.get(logo.code)!
  const img = logoPicture(logo)
  if (!img) return null
  try {
    const c = document.createElement('canvas')
    c.width = 24
    c.height = Math.max(1, Math.round((24 * img.naturalHeight) / Math.max(1, img.naturalWidth)))
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(img, 0, 0, c.width, c.height)
    logoColours.set(logo.code, dominantColour(ctx.getImageData(0, 0, c.width, c.height).data))
  } catch {
    logoColours.set(logo.code, null)
  }
  return logoColours.get(logo.code)!
}

// ---- map features -----------------------------------------------------------

function runwayFeatures(active: ActiveRunways, airportIcao: string, chips: Map<string, LngLat>): FeatureCollection {
  // The wind's guess stays off the map; seen traffic and the ATIS go on it.
  if (active.basis !== 'traffic' && active.basis !== 'atis') return empty
  const ends = runwayEnds(airportIcao)
  const features: Feature[] = []
  for (const r of active.runways) {
    const end = ends.find((e) => e.ident === r.ident)
    if (!end || !r.role) continue
    const rad = (end.bearing * Math.PI) / 180
    const reach = Math.min(1200, end.lengthM * 0.4)
    const tip = offset(end.threshold, Math.sin(rad) * reach, Math.cos(rad) * reach)
    features.push({ type: 'Feature', properties: { kind: 'glow', role: r.role, w: end.widthM, k: widthScale(end.threshold[1]) }, geometry: { type: 'LineString', coordinates: [end.threshold, tip] } })
    const at = chips.get(r.ident)
    if (at) features.push({ type: 'Feature', properties: { kind: 'mark', icon: `rwy-use-${r.role}`, len: r.ident.length }, geometry: { type: 'Point', coordinates: at } })
  }
  return { type: 'FeatureCollection', features }
}

export function RunwayGateLayer({ map, airportIcao }: { map: MapLibreMap | null; airportIcao: string }) {
  const weather = useWeather(airportIcao).data
  const metar = weather?.metar ?? null
  const atis = weather?.atis
  // Read by the tick, which shouldn't restart (and lose its memory) whenever a new observation arrives.
  const wind = useRef(metar)
  const announced = useRef<ReturnType<typeof runwaysFromAtis> | null>(null)
  useEffect(() => {
    wind.current = metar
    announced.current = atis?.length ? runwaysFromAtis(atis.map((a) => a.text), runwayEnds(airportIcao)) : null
  }, [metar, atis, airportIcao])

  useEffect(() => {
    if (!map) return
    for (const role of ['arrivals', 'departures', 'both'] as const) if (!map.hasImage(`rwy-use-${role}`)) map.addImage(`rwy-use-${role}`, badge(role), { pixelRatio: 2 })

    const airport = getAirport(airportIcao)
    const ends = runwayEnds(airportIcao)
    // Where the designator chips sit, so the badges can sit beside them.
    const chips = new Map<string, LngLat>()
    for (const f of buildAirportDiagram(airportIcao).ends.features) if (f.geometry.type === 'Point') chips.set(String(f.properties?.ident), f.geometry.coordinates as LngLat)

    const use = createRunwayUse()
    const parking: ParkingState = new Map()
    const gates = new Map<string, Gate>()
    const startedAt = Date.now()
    let lastRunways = ''
    let lastGates = ''
    let lastStore = ''

    const collectGates = () => {
      if (map.getZoom() < 13.5) return
      for (const f of map.querySourceFeatures('omt', { sourceLayer: 'aeroway', filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'class'], 'gate']] })) {
        if (f.geometry.type !== 'Point') continue
        const [lon, lat] = f.geometry.coordinates as LngLat
        const ref = String(f.properties?.ref ?? '')
        const id = f.id != null ? String(f.id) : `${ref}@${lon.toFixed(5)},${lat.toFixed(5)}`
        if (gates.has(id) || distanceM(airport.center, [lon, lat]) > GATE_RADIUS_M) continue
        gates.set(id, { id, ref, lon, lat })
      }
    }

    const clear = () => {
      if (!lastRunways && !lastGates) return
      lastRunways = lastGates = lastStore = ''
      setData(map, SRC.runwayUse, empty)
      setData(map, SRC.gateUse, empty)
      useAirfield.setState({ runways: null, gates: new Map() })
    }

    const tick = () => {
      const s = usePlayhead.getState()
      if (s.mode !== 'live') return clear()
      const now = Date.now()
      const traffic = liveBuffer.sample().filter((a) => a.opacity > 0.2)
      observeEvents(use, s.events)
      observeTraffic(use, traffic, ends, airport.elevationFt, now)
      const runways = activeRunways(use, ends, now, wind.current, announced.current)

      collectGates()
      // In the first moments of a session, anything standing still was already there.
      const parked = trackParking(parking, traffic, now, now - startedAt < 20_000)
      const { matches } = matchGates([...gates.values()], parked)

      const rKey = JSON.stringify([runways.basis, runways.runways.map((r) => `${r.ident}:${r.role}`)])
      if (rKey !== lastRunways) {
        lastRunways = rKey
        setData(map, SRC.runwayUse, runwayFeatures(runways, airportIcao, chips))
      }
      const gateFeatures: Feature[] = matches.map((m) => {
        const fill = airlineColour(m.aircraft.callsign, m.aircraft.icao24) ?? NEUTRAL_CHIP
        const chip = `gate-busy-${fill.slice(1).toLowerCase()}`
        addChip(map, chip, fill)
        return { type: 'Feature', properties: { gid: m.gate.id, ref: m.gate.ref, chip, tc: textOn(fill) }, geometry: { type: 'Point', coordinates: [m.gate.lon, m.gate.lat] } }
      })
      const gKey = JSON.stringify(gateFeatures.map((f) => f.properties))
      if (gKey !== lastGates) {
        lastGates = gKey
        setData(map, SRC.gateUse, { type: 'FeatureCollection', features: gateFeatures })
      }
      // Publish only real changes, so the panels reading this don't re-render every tick.
      const storeKey = JSON.stringify([runways.basis, runways.favoured, runways.runways.map((r) => [r.ident, r.role, r.arrivalCount, r.departureCount]), matches.map((m) => [m.gate.id, m.aircraft.icao24, m.since])])
      if (storeKey !== lastStore) {
        lastStore = storeKey
        useAirfield.setState({ runways, gates: new Map(matches.map((m) => [m.gate.id, m])) })
      }
    }

    tick()
    const id = window.setInterval(tick, TICK_MS)
    return () => {
      window.clearInterval(id)
      // The next airport's first tick replaces the map data; the panels shouldn't show this one's meanwhile.
      useAirfield.setState({ runways: null, gates: new Map() })
    }
  }, [map, airportIcao])

  return map ? <GateCard map={map} /> : null
}

// ---- gate popover -------------------------------------------------------------

type GatePick = { id: string; ref: string; at: LngLat }

function GateCard({ map }: { map: MapLibreMap }) {
  const [pick, setPick] = useState<GatePick | null>(null)
  const panel = usePlayhead((s) => s.panel)
  const selected = usePlayhead((s) => !!s.selectedIcao)
  const open = !!pick && !panel && !selected
  const { mounted, closing } = usePresence(open, 200)
  const [shown, setShown] = useState(pick)
  if (pick && pick !== shown) setShown(pick)
  const card = useRef<HTMLDivElement>(null)

  useEffect(
    () =>
      usePlayhead.subscribe((s, prev) => {
        if (s.airportIcao !== prev.airportIcao || (s.panel && !prev.panel) || (s.selectedIcao && !prev.selectedIcao)) setPick(null)
      }),
    [],
  )

  useEffect(() => {
    // A tap that only dismisses a selection or a panel shouldn't open a card.
    let busyAtDown = false
    const down = () => {
      const s = usePlayhead.getState()
      busyAtDown = !!s.selectedIcao || !!s.panel
    }
    const click = (e: MapMouseEvent | MapTouchEvent) => {
      if (busyAtDown) return
      // Aircraft are on top; a tap on one is theirs.
      if (map.getLayer(LAYER.hit) && map.queryRenderedFeatures(e.point, { layers: [LAYER.hit] }).length) return
      const layers = GATE_LAYERS.filter((l) => map.getLayer(l))
      const r = 6
      const hits = layers.length ? map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers }) : []
      const f = hits[0]
      if (!f || f.geometry.type !== 'Point') return setPick(null)
      const at = f.geometry.coordinates as LngLat
      const ref = String(f.properties?.ref ?? '')
      const id = f.properties?.gid != null ? String(f.properties.gid) : f.id != null ? String(f.id) : `${ref}@${at[0].toFixed(5)},${at[1].toFixed(5)}`
      setPick((prev) => (prev?.id === id ? null : { id, ref, at }))
    }
    map.on('mousedown', down)
    map.on('touchstart', down)
    map.on('click', click)
    return () => {
      map.off('mousedown', down)
      map.off('touchstart', down)
      map.off('click', click)
    }
  }, [map])

  // Pin the card to its gate as the map moves.
  useEffect(() => {
    if (!mounted || !shown) return
    const place = () => {
      const el = card.current
      if (!el) return
      const p = map.project(shown.at)
      const half = el.offsetWidth / 2
      const width = map.getContainer().clientWidth
      const x = Math.min(width - half - 8, Math.max(half + 8, p.x))
      el.style.translate = `${x}px ${p.y - 10}px`
      el.style.setProperty('--arrow-x', `${p.x - x}px`)
    }
    place()
    map.on('move', place)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPick(null)
    window.addEventListener('keydown', onKey)
    return () => {
      map.off('move', place)
      window.removeEventListener('keydown', onKey)
    }
  }, [map, mounted, shown])

  if (!mounted || !shown) return null
  return createPortal(
    <div ref={card} className="pointer-events-none absolute left-0 top-0 z-20">
      <div data-closing={closing ? '' : undefined} className="motion-pop absolute bottom-0 left-0 origin-bottom -translate-x-1/2">
        <GateDetails pick={shown} onClose={() => setPick(null)} />
        <span aria-hidden className="absolute -bottom-1.5 left-[calc(50%+var(--arrow-x,0px))] size-3 -translate-x-1/2 rotate-45 rounded-[2px] border-b border-r border-white/[0.12] bg-[#1d2535]" />
      </div>
    </div>,
    map.getContainer(),
  )
}

function GateDetails({ pick, onClose }: { pick: GatePick; onClose: () => void }) {
  const match = useAirfield((s) => s.gates.get(pick.id))
  const now = useNow(15_000)
  const { title, detail } = describeGate(pick.ref, match, now)
  const [who, parked] = detail.split(' · ')
  return (
    <div role="dialog" aria-label={title} className="pointer-events-auto flex w-max max-w-[min(20rem,calc(100vw-16px))] items-center gap-2.5 rounded-2xl bg-[#1d2535]/95 py-2 pl-2.5 pr-2 shadow-pop ring-1 ring-white/[0.12] backdrop-blur-xl">
      <span className="shrink-0 rounded-[5px] bg-[#F5B93D] px-1.5 py-0.5 text-subhead font-bold leading-tight text-[#1C1503]">{pick.ref || 'Gate'}</span>
      <div className="min-w-0 flex-1 text-footnote leading-snug">
        {match ? (
          <>
            <div className="truncate font-semibold text-white">{who}</div>
            <div className="text-caption text-white/60">Parked {parked.replace(/^parked /, '')}</div>
          </>
        ) : (
          <>
            <div className="font-semibold text-white">Free</div>
            <div className="text-caption text-white/60">No aircraft parked here</div>
          </>
        )}
      </div>
      <CloseButton onClick={onClose} className="size-7" />
    </div>
  )
}
