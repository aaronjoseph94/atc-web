/**
 * Arrival (STAR), departure (SID) and approach paths for US airports, from
 * the FAA's CIFP (see `scripts/fetch-procedures.mjs`). Off unless the user
 * turns on "Procedures" in the Map sheet.
 *
 * Feeds the `proc-*` sources declared in `mapStyle.ts`:
 *  - every route segment once (shared segments would otherwise stack up),
 *    with runway-specific branches only for the runways in use;
 *  - the finals, flagged `on` for runways in use (the ATIS, landings in the
 *    event log, or traffic established on them now);
 *  - the procedure the selected aircraft seems to be flying, or a tapped one.
 * A tap on a line shows its name in a small card.
 */
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, MapTouchEvent } from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { maskToSdf } from '../aircraft/distance'
import { getAirport } from '../api/airports'
import { runwaysInUse } from '../live/events'
import { liveBuffer } from '../live/session'
import { usePlayhead } from '../playback/playheadStore'
import { useWeather } from '../station/StationBar'
import { useSettings } from '../settings/settingsStore'
import { usePresence } from '../ui/usePresence'
import type { LngLat } from './geo'
import { LAYER, PROC_FIX_IMAGE, SRC } from './mapStyle'
import { atisRunways, isLine, matchProcedure, normRunway, procedureTitle, runwaysInUseNow, uniqueSegments, visibleLines, type ProcedureFile, type ProcKind, type ProcLine } from './procedures/procedures'

const EMPTY = { type: 'FeatureCollection' as const, features: [] }
/** How often the in-use finals and the selected aircraft's procedure are re-worked out. */
const REFRESH_MS = 3000
/** Landings this recent mark a runway as in use. */
const IN_USE_WINDOW_MS = 30 * 60_000
/** Finger-sized reach around a tap, in pixels. */
const TAP_SLOP_PX = 8
/** When lines overlap under a tap, the one most likely meant. */
const TAP_ORDER: Record<ProcKind, number> = { final: 0, trans: 1, star: 2, sid: 3 }

/** Loaded files, kept for the session (they only change with the AIRAC cycle). */
const cache = new Map<string, Promise<ProcedureFile | null>>()
function load(code: string): Promise<ProcedureFile | null> {
  let p = cache.get(code)
  if (!p) {
    p = fetch(`/procedures/${code}.json`)
      .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? (r.json() as Promise<ProcedureFile>) : null))
      .catch(() => null)
    // A failed load may succeed later (offline, deploy in progress).
    p.then((f) => f ?? cache.delete(code))
    cache.set(code, p)
  }
  return p
}

function setData(map: MapLibreMap, id: string, data: unknown) {
  ;(map.getSource(id) as GeoJSONSource | undefined)?.setData(data as GeoJSON.GeoJSON)
}

/** Hollow triangle, the chart symbol for a fix, as a distance field so the style can colour it. */
function addFixImage(map: MapLibreMap) {
  if (map.hasImage(PROC_FIX_IMAGE)) return
  const size = 32
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  if (!g) return
  g.strokeStyle = '#fff'
  g.lineWidth = 3.2
  g.lineJoin = 'miter'
  g.beginPath()
  g.moveTo(size / 2, 6)
  g.lineTo(size - 6.5, size - 8)
  g.lineTo(6.5, size - 8)
  g.closePath()
  g.stroke()
  const mask = g.getImageData(0, 0, size, size)
  map.addImage(PROC_FIX_IMAGE, new ImageData(maskToSdf(mask.data, size, size, 4) as Uint8ClampedArray<ArrayBuffer>, size, size), { sdf: true, pixelRatio: 2 })
}

type Pick = { code: string; lines: ProcLine[]; at: LngLat }

export function ProceduresLayer({ map, airportIcao }: { map: MapLibreMap | null; airportIcao: string }) {
  const enabled = useSettings((s) => s.procedures)
  const airport = getAirport(airportIcao)
  const isUs = airport.group === 'US'
  const [loaded, setLoaded] = useState<{ code: string; file: ProcedureFile | null } | null>(null)
  const [picked, setPick] = useState<Pick | null>(null)

  // ---- load --------------------------------------------------------------------
  useEffect(() => {
    if (!enabled || !isUs) return
    let live = true
    load(airportIcao).then((f) => live && setLoaded({ code: airportIcao, file: f }))
    return () => {
      live = false
    }
  }, [enabled, isUs, airportIcao])
  // Another airport, or the toggle off: whatever was loaded or tapped no longer applies.
  const file = enabled && isUs && loaded?.code === airportIcao ? loaded.file : null
  const pick = file && picked?.code === airportIcao ? picked : null

  const lines = useMemo(() => (file ? file.features.filter(isLine) : []), [file])
  const finals = useMemo(() => lines.filter((l) => l.properties.k === 'final'), [lines])
  // The ATIS says which runways are in use; shared with the station bar's weather query.
  const atis = useWeather(airportIcao).data?.atis
  const atisUse = useMemo(() => {
    const read = (atis ?? []).map((a) => Object.assign({ kind: a.kind }, atisRunways(a.text)))
    return {
      landing: [...new Set(read.filter((a) => a.kind !== 'departure').flatMap((a) => a.landing))],
      departing: [...new Set(read.filter((a) => a.kind !== 'arrival').flatMap((a) => a.departing))],
    }
  }, [atis])

  useEffect(() => {
    if (!map) return
    addFixImage(map)
    if (enabled && file) return
    for (const id of [SRC.procAll, SRC.procNet, SRC.procFinal, SRC.procHi]) setData(map, id, EMPTY)
  }, [map, enabled, file])

  // ---- what is drawn: runways in use, and the selected aircraft's procedure ---------------------
  useEffect(() => {
    if (!map || !enabled || !file) return
    const fixes = file.features.filter((f) => f.properties.k === 'fix')
    let lastUse = ''
    let lastHi = ''
    const refresh = () => {
      const s = usePlayhead.getState()
      const elevation = airport.elevationFt
      const traffic = s.mode === 'live' ? liveBuffer.sample() : []
      const recent = runwaysInUse(s.events, Date.now() - IN_USE_WINDOW_MS)
      const landing = runwaysInUseNow(traffic, finals, elevation, [...atisUse.landing, ...recent.landing])
      const departing = new Set([...atisUse.departing, ...recent.departing].map(normRunway))
      const useKey = `${[...landing].sort().join(' ')}|${[...departing].sort().join(' ')}`
      if (useKey !== lastUse) {
        lastUse = useKey
        setData(map, SRC.procFinal, {
          type: 'FeatureCollection',
          features: finals.map((f) => ({ ...f, properties: { ...f.properties, on: (f.properties.rw ?? '').split(' ').some((r) => landing.has(r)) ? 1 : 0 } })),
        })
        // Runway branches only for the runways in use; the fixes along what is left.
        const shown = visibleLines(lines, landing, departing)
        const names = new Set(shown.flatMap((l) => (l.properties.fx ?? '').split(' ')))
        setData(map, SRC.procAll, { ...file, features: [...shown, ...fixes.filter((f) => names.has(f.properties.n))] })
        const net = (kinds: ProcKind[], k: string) =>
          uniqueSegments(shown.filter((l) => kinds.includes(l.properties.k))).map((coordinates) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: { k } }))
        setData(map, SRC.procNet, { type: 'FeatureCollection', features: [...net(['star', 'trans'], 'star'), ...net(['sid'], 'sid')] })
      }
    // A tapped procedure wins; otherwise the one the selected aircraft is on.
      let hi: ProcLine[] = pick?.lines.slice(0, 1) ?? []
      if (!hi.length && s.selectedIcao && s.mode === 'live') {
        const ac = liveBuffer.get(s.selectedIcao)
        const i = ac ? matchProcedure(ac, lines, elevation) : -1
        if (i >= 0) hi = [lines[i]]
      }
      const hiKey = hi.map((l) => `${l.properties.n}|${l.properties.t ?? ''}|${l.geometry.coordinates[0]}`).join()
      if (hiKey !== lastHi) {
        lastHi = hiKey
        setData(map, SRC.procHi, { type: 'FeatureCollection', features: hi })
      }
    }
    refresh()
    const id = window.setInterval(refresh, REFRESH_MS)
    // Selecting an aircraft or tapping a line should show at once, not on the next tick.
    const unsub = usePlayhead.subscribe((s, prev) => s.selectedIcao !== prev.selectedIcao && refresh())
    return () => {
      window.clearInterval(id)
      unsub()
    }
  }, [map, enabled, file, lines, finals, airport.elevationFt, pick, atisUse])

  // ---- tap a line -----------------------------------------------------------------------------
  useEffect(() => {
    if (!map || !enabled || !file) return
    // A tap that only dismisses a selection or a panel shouldn't open a card.
    let busyAtDown = false
    const down = () => {
      const s = usePlayhead.getState()
      busyAtDown = !!s.selectedIcao || !!s.panel
    }
    const click = (e: MapMouseEvent | MapTouchEvent) => {
      if (busyAtDown) return setPick(null)
      const { x, y } = e.point
      // Aircraft and runways have their own cards.
      if (map.getLayer(LAYER.hit) && map.queryRenderedFeatures(e.point, { layers: [LAYER.hit] }).length) return setPick(null)
      if (map.getLayer('apt-surface') && map.queryRenderedFeatures(e.point, { layers: ['apt-surface'] }).length) return setPick(null)
      const box: [[number, number], [number, number]] = [
        [x - TAP_SLOP_PX, y - TAP_SLOP_PX],
        [x + TAP_SLOP_PX, y + TAP_SLOP_PX],
      ]
      const hits = map.queryRenderedFeatures(box, { layers: [LAYER.procHit] })
      const seen = new Set<string>()
      const found: ProcLine[] = []
      for (const h of hits) {
        const p = h.properties as ProcLine['properties']
        const key = `${p.n}|${p.t ?? ''}`
        if (seen.has(key)) continue
        seen.add(key)
        // Find the full line again: rendered features are clipped to tiles.
        const line = lines.find((l) => l.properties.n === p.n && (l.properties.t ?? '') === (p.t ?? '') && (l.properties.rw ?? '') === (p.rw ?? ''))
        if (line) found.push(line)
      }
      found.sort((a, b) => TAP_ORDER[a.properties.k] - TAP_ORDER[b.properties.k])
      // Tapping the same line again puts the card away.
      setPick((prev) => (found.length && prev?.lines[0] !== found[0] ? { code: usePlayhead.getState().airportIcao, lines: found, at: [e.lngLat.lng, e.lngLat.lat] } : null))
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPick(null)
    map.on('mousedown', down)
    map.on('touchstart', down)
    map.on('click', click)
    window.addEventListener('keydown', onKey)
    return () => {
      map.off('mousedown', down)
      map.off('touchstart', down)
      map.off('click', click)
      window.removeEventListener('keydown', onKey)
    }
  }, [map, enabled, file, lines])

  // Selecting an aircraft or opening a panel puts the card away.
  useEffect(() => usePlayhead.subscribe((s, prev) => ((s.selectedIcao && !prev.selectedIcao) || (s.panel && !prev.panel)) && setPick(null)), [])

  if (!map) return null
  return createPortal(<ProcedureCard map={map} pick={pick} />, map.getContainer())
}

/** The name of a tapped procedure, pinned to the tap. */
function ProcedureCard({ map, pick }: { map: MapLibreMap; pick: Pick | null }) {
  const { mounted, closing } = usePresence(!!pick, 180)
  const [shown, setShown] = useState(pick)
  if (pick && pick !== shown) setShown(pick)
  const el = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!mounted || !shown) return
    const place = () => {
      const node = el.current
      if (!node) return
      const p = map.project(shown.at)
      const half = node.offsetWidth / 2
      const x = Math.min(map.getContainer().clientWidth - half - 8, Math.max(half + 8, p.x))
      node.style.translate = `${x}px ${p.y}px`
      node.style.setProperty('--arrow-x', `${p.x - x}px`)
    }
    place()
    map.on('move', place)
    return () => {
      map.off('move', place)
    }
  }, [map, mounted, shown])

  if (!mounted || !shown) return null
  const [first, ...rest] = shown.lines
  const head = procedureTitle(first.properties)
  const others = [...new Set(rest.map((l) => l.properties.n).filter((n) => n !== first.properties.n))].slice(0, 2)
  return (
    <div ref={el} className="pointer-events-none absolute left-0 top-0 z-[5]">
      <div data-closing={closing ? '' : undefined} className="motion-pop absolute bottom-2.5 left-0 origin-bottom -translate-x-1/2">
        <div role="status" className="w-max max-w-[16rem] rounded-xl bg-[#1d2535]/95 px-3 py-2 shadow-pop ring-1 ring-white/[0.12] backdrop-blur-xl">
          <div className="flex items-center gap-1.5 text-footnote font-semibold leading-snug text-white">
            <span aria-hidden className={`inline-block h-0.5 w-3 shrink-0 rounded-full ${first.properties.k === 'final' ? 'bg-[#DCE4FF]' : 'bg-[#8E9CC4]'}`} />
            <span className="truncate">{head.title}</span>
          </div>
          {head.detail && <div className="mt-0.5 text-caption leading-snug text-white/60">{head.detail}</div>}
          {others.length > 0 && <div className="mt-1 border-t border-white/10 pt-1 text-caption leading-snug text-white/50">Also here: {others.join(', ')}</div>}
        </div>
        <span aria-hidden className="absolute -bottom-1.5 left-[calc(50%+var(--arrow-x,0px))] size-3 -translate-x-1/2 rotate-45 rounded-[2px] border-b border-r border-white/[0.12] bg-[#1d2535]" />
      </div>
    </div>
  )
}
