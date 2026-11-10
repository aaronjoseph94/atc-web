/**
 * Everything currently in view, searchable. Hovering a row lights the
 * aircraft up on the map; tapping selects it and closes the list.
 */
import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getAirport } from '../api/airports'
import type { Aircraft } from '../api/types'
import { aircraftTypeName, flightPhase, friendlyFlightName, PHASE_LABEL, type Phase } from '../flight/describe'
import { runwayRelation } from '../live/events'
import { liveBuffer } from '../live/session'
import { runwayEnds } from '../map/airportDiagram'
import { positionsAt } from '../playback/interpolate'
import { usePlayhead } from '../playback/playheadStore'
import { formatAltitude, formatSpeed, useSettings } from '../settings/settingsStore'
import { FullPanel, SectionLabel } from '../ui/Panel'

type Group = 'Arriving' | 'Departing' | 'Passing through' | 'Taxiing' | 'Parked'
const ORDER: Group[] = ['Arriving', 'Departing', 'Taxiing', 'Passing through', 'Parked']

function groupOf(phase: Phase, onFinal: boolean): Group {
  if (phase === 'parked') return 'Parked'
  if (phase === 'taxiing' || phase === 'rolling') return 'Taxiing'
  if (onFinal || phase === 'final' || phase === 'descending') return 'Arriving'
  if (phase === 'takeoff' || phase === 'climbing') return 'Departing'
  return 'Passing through'
}

export function TrafficPanel() {
  const open = usePlayhead((s) => s.panel === 'traffic')
  const mode = usePlayhead((s) => s.mode)
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const selectedIcao = usePlayhead((s) => s.selectedIcao)
  const liveStatus = usePlayhead((s) => s.liveStatus)
  const setPanel = usePlayhead((s) => s.setPanel)
  const select = usePlayhead((s) => s.select)
  const setHover = usePlayhead((s) => s.setHover)
  const altitudeUnit = useSettings((s) => s.altitudeUnit)
  const speedUnit = useSettings((s) => s.speedUnit)
  const [query, setQuery] = useState('')
  const [list, setList] = useState<Aircraft[]>([])

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
    const by = new Map<Group, { a: Aircraft; phase: Phase; note: string | null }[]>()
    for (const a of list) {
      if (a.category?.startsWith('C')) continue
      const name = friendlyFlightName(a.callsign)
      if (q && !`${a.callsign} ${name} ${a.type ?? ''} ${a.registration ?? ''}`.toLowerCase().includes(q)) continue
      const rel = runwayRelation(a, ends, airport.elevationFt)
      const phase = flightPhase({ ...a, altitudeFt: a.altitudeFt == null || a.onGround ? a.altitudeFt : a.altitudeFt - airport.elevationFt })
      const g = groupOf(phase, rel?.kind === 'final')
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

  return (
    <FullPanel open={open} title={`Traffic at ${airport.icao}`} onClose={close}>
      <label className="sticky top-0 z-10 flex items-center gap-2 rounded-xl bg-[#232c3b] px-3 shadow-[0_6px_12px_-6px_rgba(0,0,0,0.6)] ring-1 ring-inset ring-transparent transition-shadow duration-[var(--duration-fast)] focus-within:ring-atc-yellow/70">
        <Search className="size-4 shrink-0 text-atc-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Flight, airline, type or tail number"
          aria-label="Search traffic"
          className="h-10 min-w-0 flex-1 bg-transparent text-subhead outline-none placeholder:text-atc-muted"
        />
        <span className="shrink-0 text-caption tabular-nums text-atc-muted">{total}</span>
      </label>

      {total === 0 ? (
        <p className="py-10 text-center text-subhead text-atc-muted">
          {q ? `Nothing in view matches “${query}”.` : liveStatus === 'error' ? 'The traffic feed isn’t answering. It retries on its own.' : 'No aircraft in view yet.'}
        </p>
      ) : (
        ORDER.map((g) => {
          const rows = groups.get(g)
          if (!rows?.length) return null
          return (
            <section key={g}>
              <SectionLabel>
                {g} <span className="font-normal tabular-nums text-white/30">{rows.length}</span>
              </SectionLabel>
              <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {rows.map(({ a, phase, note }) => (
                  <li key={a.icao24}>
                    <button
                      type="button"
                      aria-current={a.icao24 === selectedIcao || undefined}
                      className={`pressable-soft flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left ${a.icao24 === selectedIcao ? 'bg-atc-card' : 'bg-white/[0.05] hover:bg-white/[0.09]'}`}
                      onPointerEnter={() => setHover(a.icao24)}
                      onPointerLeave={() => setHover(null)}
                      onFocus={() => setHover(a.icao24)}
                      onClick={() => {
                        select(a.icao24)
                        close()
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display text-[22px] leading-tight">{a.callsign}</span>
                        <span className="block truncate text-caption text-white/60">{note ?? aircraftTypeName(a.type) ?? PHASE_LABEL[phase]}</span>
                      </span>
                      <span className="shrink-0 text-right text-caption tabular-nums text-white/65">
                        <span className="block text-footnote font-semibold text-white">{a.onGround ? 'Ground' : formatAltitude(a.altitudeFt, altitudeUnit)}</span>
                        <span className="block">{formatSpeed(a.speedKt, speedUnit)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )
        })
      )}
    </FullPanel>
  )
}
