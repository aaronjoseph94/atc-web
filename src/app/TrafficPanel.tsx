/**
 * Everything currently in view, searchable. On a phone it sits under a short
 * list of recent activity (takeoffs, landings, go-arounds) and notable
 * aircraft; in the desktop side panel those live on the Now tab, and this is
 * the list alone. Hovering a row lights the aircraft up on the map; tapping
 * selects it and closes the list.
 */
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { memo, useEffect, useMemo, useState } from 'react'
import { AirlineLogo } from '../airline/AirlineLogo'
import { airlineInfo, brandFor } from '../airline/airlines'
import { getAirport } from '../api/airports'
import type { Aircraft } from '../api/types'
import { SpottedList } from '../discovery/SpottedList'
import { aircraftTypeName, friendlyFlightName, PHASE_LABEL, type Phase } from '../flight/describe'
import { liveBuffer } from '../live/session'
import { runwayEnds } from '../map/airportDiagram'
import { positionsAt } from '../playback/interpolate'
import { usePlayhead } from '../playback/playheadStore'
import { formatAltitude, formatSpeed, useSettings } from '../settings/settingsStore'
import { SearchField } from '../ui/kit'
import { PanelFrame, SectionLabel } from '../ui/Panel'
import { EmptyState, ListSkeleton, OfflineArt, QuietArt, StateAction } from '../ui/States'
import { ActivityList } from './ActivityList'
import { classifyAircraft, isVehicle, TRAFFIC_ORDER, type TrafficGroup } from './panel/overview'

/** `docked`: rendered in the desktop side panel instead of as a sheet; `search` is its query when the panel owns the search box. */
export function TrafficPanel({ docked = false, search }: { docked?: boolean; search?: string }) {
  const open = usePlayhead((s) => s.panel === 'traffic') || docked
  const mode = usePlayhead((s) => s.mode)
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const selectedIcao = usePlayhead((s) => s.selectedIcao)
  const liveStatus = usePlayhead((s) => s.liveStatus)
  const setPanel = usePlayhead((s) => s.setPanel)
  const setHover = usePlayhead((s) => s.setHover)
  const altitudeUnit = useSettings((s) => s.altitudeUnit)
  const speedUnit = useSettings((s) => s.speedUnit)
  const [ownQuery, setQuery] = useState('')
  const query = search ?? ownQuery
  const [list, setList] = useState<Aircraft[]>([])
  const queryClient = useQueryClient()
  // Same busy state as the map's offline card, so a tap on "Try again" visibly does something.
  const retrying = useIsFetching({ queryKey: ['aircraft', airportIcao] }) > 0

  // Refresh once a second while open; the map keeps its own 60 fps copy.
  useEffect(() => {
    if (!open) return
    const read = () => {
      const s = usePlayhead.getState()
      setList(s.mode === 'playback' && s.clip ? positionsAt(s.clip, s.tMs) : liveBuffer.sample())
    }
    read()
    const id = window.setInterval(read, 1000)
    return () => window.clearInterval(id)
  }, [open, mode])

  const airport = getAirport(airportIcao)
  const ends = useMemo(() => runwayEnds(airportIcao), [airportIcao])
  const q = query.trim().toLowerCase()

  const groups = useMemo(() => {
    const by = new Map<TrafficGroup, { a: Aircraft; phase: Phase; note: string | null }[]>()
    for (const a of list) {
      if (isVehicle(a)) continue
      const name = friendlyFlightName(a.callsign)
      // The brand too, so "Delta" also finds the Endeavor flights wearing the Delta logo.
      const brand = airlineInfo(brandFor(a.callsign)?.brand)?.name ?? ''
      if (q && !`${a.callsign} ${name} ${brand} ${a.type ?? ''} ${a.registration ?? ''}`.toLowerCase().includes(q)) continue
      const { phase, group: g, relation: rel } = classifyAircraft(a, ends, airport.elevationFt)
      const note = rel?.kind === 'final' ? `Final ${rel.runway}, ${rel.distanceNm.toFixed(1)} nm` : rel?.kind === 'on' ? `Runway ${rel.runway}` : null
      by.set(g, [...(by.get(g) ?? []), { a, phase, note }])
    }
    // Lowest first in the air (closest to landing or just departed); alphabetical on the ground.
    for (const [g, rows] of by) rows.sort((x, y) => (g === 'Parked' || g === 'Taxiing' ? x.a.callsign.localeCompare(y.a.callsign) : (x.a.altitudeFt ?? 0) - (y.a.altitudeFt ?? 0)))
    return by
  }, [list, q, ends, airport.elevationFt])

  const total = [...groups.values()].reduce((n, r) => n + r.length, 0)
  const close = () => {
    setHover(null)
    setPanel(null)
  }
  // Stable, so the rows (memoised) only re-render when what they show changes, not on every once-a-second refresh.
  const [pick] = useState(() => (icao24: string) => {
    usePlayhead.getState().select(icao24)
    usePlayhead.getState().setHover(null)
    usePlayhead.getState().setPanel(null)
  })

  return (
    <PanelFrame
      docked={docked}
      open={open}
      title={`Traffic at ${airport.icao}`}
      onClose={close}
      pinned={<SearchField value={query} onChange={setQuery} placeholder="Flight, airline, type or tail number" label="Search traffic" trailing={total} onEscape={() => (setQuery(''), true)} />}
    >
      {/* What the traffic has been doing: takeoffs, landings, go-arounds. Live only, and out of the way of a search. The side panel shows both on its Now tab instead. */}
      {!docked && mode === 'live' && !q && <ActivityList onPick={close} />}
      {/* Unusual visitors this session (src/discovery). */}
      {!docked && mode === 'live' && !q && <SpottedList onPick={close} />}

      {total === 0 ? (
        q ? (
          <EmptyState title="No matches">Nothing matches “{query}”.</EmptyState>
        ) : mode === 'live' && liveStatus === 'error' ? (
          <EmptyState
            art={<OfflineArt />}
            title="Live traffic is offline"
            actions={
              <StateAction primary busy={retrying} onClick={() => void queryClient.invalidateQueries({ queryKey: ['aircraft', airportIcao] })}>
                {retrying ? 'Trying…' : 'Try again'}
              </StateAction>
            }
          >
            Feeds not answering. Retrying.
          </EmptyState>
        ) : mode === 'live' && liveStatus !== 'ok' ? (
          <ListSkeleton />
        ) : (
          <EmptyState art={<QuietArt className="rounded-[22px] ring-1 ring-white/10" />} title={`All quiet at ${airport.icao}`}>
            No aircraft in range.
          </EmptyState>
        )
      ) : (
        TRAFFIC_ORDER.map((g) => {
          const rows = groups.get(g)
          if (!rows?.length) return null
          return (
            <section key={g} className="mt-5 first:mt-0">
              <SectionLabel count={rows.length}>{g}</SectionLabel>
              <ul className="grid grid-cols-1 gap-1.5 @xl:grid-cols-2">
                {rows.map(({ a, phase, note }) => (
                  <TrafficRow
                    key={a.icao24}
                    icao24={a.icao24}
                    callsign={a.callsign}
                    detail={note ?? aircraftTypeName(a.type) ?? PHASE_LABEL[phase]}
                    altitude={a.onGround ? 'Ground' : formatAltitude(a.altitudeFt, altitudeUnit)}
                    speed={formatSpeed(a.speedKt, speedUnit)}
                    selected={a.icao24 === selectedIcao}
                    onPick={pick}
                  />
                ))}
              </ul>
            </section>
          )
        })
      )}
    </PanelFrame>
  )
}

type RowProps = { icao24: string; callsign: string; detail: string; altitude: string; speed: string; selected: boolean; onPick: (icao24: string) => void }

/**
 * One aircraft in the list. Memoised on what it shows: the list refreshes once
 * a second and a busy airport has well over a hundred rows, most unchanged.
 * Rows scrolled out of view skip layout and paint (`content-visibility`).
 */
const TrafficRow = memo(function TrafficRow({ icao24, callsign, detail, altitude, speed, selected, onPick }: RowProps) {
  const setHover = usePlayhead((s) => s.setHover)
  return (
    <li className="[contain-intrinsic-size:auto_3.5rem] [content-visibility:auto]">
      <button
        type="button"
        aria-current={selected || undefined}
        className={`pressable-soft flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left ${selected ? 'rounded-2xl bg-atc-card shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]' : 'ui-card hover:bg-white/[0.09]'}`}
        onPointerEnter={() => setHover(icao24)}
        onPointerLeave={() => setHover(null)}
        onFocus={() => setHover(icao24)}
        onClick={() => onPick(icao24)}
      >
        {/* Fixed slot, so callsigns line up whether or not the airline has a logo. */}
        <span className="grid h-6 w-9 shrink-0 place-items-center">
          <AirlineLogo callsign={callsign} icao24={icao24} height={22} maxWidth={34} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="display-tight block truncate font-display text-[22px] leading-tight">{callsign}</span>
          <span className={`block truncate text-caption ${selected ? 'text-white/85' : 'text-white/60'}`}>{detail}</span>
        </span>
        <span className={`shrink-0 text-right text-caption tabular-nums ${selected ? 'text-white/85' : 'text-white/65'}`}>
          <span className="block text-footnote font-semibold text-white">{altitude}</span>
          <span className="block">{speed}</span>
        </span>
      </button>
    </li>
  )
})
