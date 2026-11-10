/**
 * Tap a runway (or its end label) on the map: a small card pinned to the spot
 * with its size, headings, surface, how the wind lines up with it and
 * whether it has been seen in use. Tap elsewhere, move away or press Escape
 * to let it go.
 */
import type { MapMouseEvent, MapTouchEvent } from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { runwaysInUse } from '../live/events'
import { metersPerPixel, type LngLat } from '../map/geo'
import { LAYER } from '../map/mapStyle'
import { runwayEnds } from '../map/airportDiagram'
import { usePlayhead } from '../playback/playheadStore'
import { useSettings } from '../settings/settingsStore'
import { useWeather } from '../station/StationBar'
import { runwayWinds } from '../weather/atis'
import { CloseButton } from '../ui/Panel'
import { usePresence } from '../ui/usePresence'
import { formatRunwaySize, runwayAt, type RunwayFacts } from './runwayInfo'
import { useMap } from './useMap'

/** Finger-sized reach around a runway, in screen pixels. */
const TAP_SLOP_PX = 12

export function RunwayInfo() {
  const map = useMap()
  const panel = usePlayhead((s) => s.panel)
  const selected = usePlayhead((s) => !!s.selectedIcao)
  const [pick, setPick] = useState<{ facts: RunwayFacts; at: LngLat } | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const open = !!pick && !panel && !selected
  const { mounted, closing } = usePresence(open, 200)
  // Keep the last runway on screen while the card fades away.
  const [shown, setShown] = useState(pick)
  if (pick && pick !== shown) setShown(pick)

  // Another airport, a panel or a selection: the card has done its job.
  useEffect(
    () =>
      usePlayhead.subscribe((s, prev) => {
        if (s.airportIcao !== prev.airportIcao || (s.panel && !prev.panel) || (s.selectedIcao && !prev.selectedIcao)) setPick(null)
      }),
    [],
  )

  useEffect(() => {
    if (!map) return
    // A tap that only dismisses a selection or a card shouldn't open one.
    let busyAtDown = false
    const down = () => {
      const s = usePlayhead.getState()
      busyAtDown = !!s.selectedIcao || !!s.panel
    }
    const click = (e: MapMouseEvent | MapTouchEvent) => {
      if (busyAtDown) return
      if (map.getLayer(LAYER.hit) && map.queryRenderedFeatures(e.point, { layers: [LAYER.hit] }).length) return
      const icao = usePlayhead.getState().airportIcao
      const slop = TAP_SLOP_PX * metersPerPixel(e.lngLat.lat, map.getZoom())
      const facts = runwayAt(icao, [e.lngLat.lng, e.lngLat.lat], slop)
      setPick((prev) => (facts && prev?.facts.name !== facts.name ? { facts, at: [e.lngLat.lng, e.lngLat.lat] } : null))
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

  // Pin the card to its spot as the map moves, without re-rendering.
  useEffect(() => {
    if (!map || !mounted || !shown) return
    const place = () => {
      const el = card.current
      if (!el) return
      const p = map.project(shown.at)
      const half = el.offsetWidth / 2
      const x = Math.min(window.innerWidth - half - 8, Math.max(half + 8, p.x))
      el.style.translate = `${x}px ${p.y}px`
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
  return (
    <div ref={card} className="pointer-events-none absolute left-0 top-0 z-30">
      <div data-closing={closing ? '' : undefined} className="motion-pop absolute bottom-3 left-0 origin-bottom -translate-x-1/2">
        <Card facts={shown.facts} onClose={() => setPick(null)} />
        {/* Pointer down to the tapped spot. */}
        <span aria-hidden className="absolute -bottom-1.5 left-[calc(50%+var(--arrow-x,0px))] size-3 -translate-x-1/2 rotate-45 rounded-[2px] border-b border-r border-white/[0.12] bg-[#1d2535]" />
      </div>
    </div>
  )
}

function Card({ facts, onClose }: { facts: RunwayFacts; onClose: () => void }) {
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const events = usePlayhead((s) => s.events)
  const metric = useSettings((s) => s.altitudeUnit === 'm')
  const metar = useWeather(airportIcao).data?.metar
  const ends = useMemo(() => runwayEnds(airportIcao).filter((e) => facts.ends.some((f) => f.ident === e.ident)), [airportIcao, facts])
  const best = runwayWinds(metar, ends)[0]
  const inUse = useMemo(() => {
    const used = runwaysInUse(events, (events[0]?.at ?? 0) - 30 * 60_000)
    const mine = (list: string[]) => list.filter((r) => facts.ends.some((e) => e.ident === r))
    return { landing: mine(used.landing), departing: mine(used.departing) }
  }, [events, facts])
  const size = formatRunwaySize(facts, metric)

  return (
    <div role="dialog" aria-label={`Runway ${facts.name}`} className="pointer-events-auto w-[17rem] rounded-2xl glass-pop p-3.5 shadow-pop ring-1 ring-white/[0.12]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-caption font-semibold text-white/55">Runway</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            {facts.ends.map((e) => (
              <span key={e.ident} className="rounded-md bg-[#C8102E] px-1.5 py-0.5 text-subhead font-bold leading-tight text-white ring-1 ring-white/70">
                {e.ident}
              </span>
            ))}
          </div>
        </div>
        <CloseButton onClick={onClose} className="-mr-1 -mt-1 size-7" />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-footnote">
        {size && <Fact k="Length × width" v={size} />}
        {facts.surface && <Fact k="Surface" v={facts.surface} />}
        {facts.ends.map((e) => (
          <Fact key={e.ident} k={`Heading ${e.ident}`} v={`${String(e.headingDeg).padStart(3, '0')}°`} />
        ))}
      </dl>
      {(best || inUse.landing.length > 0 || inUse.departing.length > 0) && (
        <div className="mt-3 space-y-1 border-t border-white/10 pt-2.5 text-footnote text-white/80">
          {best && (
            <p className="tabular-nums">
              {best.headwindKt >= 0 ? `${best.headwindKt} kt headwind on ${best.ident}` : `${-best.headwindKt} kt tailwind either way`}
              {best.crosswindKt > 0 ? `, ${best.crosswindKt} kt across` : ''}
            </p>
          )}
          {inUse.landing.length > 0 && <p>Landings on {inUse.landing.join(', ')} recently</p>}
          {inUse.departing.length > 0 && <p>Departures from {inUse.departing.join(', ')} recently</p>}
        </div>
      )}
    </div>
  )
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-white/50">{k}</dt>
      <dd className="truncate font-semibold tabular-nums">{v}</dd>
    </div>
  )
}
