/**
 * "Spotted": the notable aircraft met this session (outsize freighters,
 * classics, military and VIP flights, types this airport rarely sees), under
 * Recent activity in the Traffic list. A few show at once; tapping one
 * selects it while it's still in range.
 */
import { ChevronDown, Shield, Sparkles, Star } from 'lucide-react'
import { useState } from 'react'
import { AirlineLogo } from '../airline/AirlineLogo'
import { useNow } from '../hooks/useNow'
import { liveBuffer } from '../live/session'
import { usePlayhead } from '../playback/playheadStore'
import { SectionLabel } from '../ui/Panel'
import { useSightingLine } from './aiLine'
import type { Spot } from './spotter'
import { useSpotted } from './useSpotter'

const COLLAPSED = 3

function ago(at: number, now: number): string {
  const min = Math.round((now - at) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

const DIRECTION: Record<Spot['direction'], string> = { inbound: 'Inbound', departing: 'Departing', ground: 'On the ground', nearby: 'Nearby' }

function Badge({ s }: { s: Spot }) {
  const Icon = s.military ? Shield : Star
  return (
    <span className={`mt-0.5 grid size-[26px] shrink-0 place-items-center rounded-full ${s.rare ? 'bg-atc-yellow/[0.16] text-atc-yellow' : 'bg-white/[0.08] text-white/70'}`} aria-hidden>
      <Icon className="size-3.5" strokeWidth={2.4} fill={s.rare ? 'currentColor' : 'none'} />
    </span>
  )
}

function Row({ s, now, onPick }: { s: Spot; now: number; onPick: (s: Spot) => void }) {
  const here = !!liveBuffer.get(s.icao24)
  const { line, ai } = useSightingLine(s)
  const label = s.military?.vip ? 'VIP' : s.military ? 'Military' : s.rare ? 'Rare' : 'Notable'
  return (
    <li>
      <button
        type="button"
        aria-disabled={!here || undefined}
        title={here ? undefined : 'No longer in range'}
        className="pressable-soft flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left enabled:hover:bg-white/[0.07] aria-disabled:cursor-default"
        onClick={() => here && onPick(s)}
      >
        <Badge s={s} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-caption font-medium tabular-nums text-white/45">
            <AirlineLogo callsign={s.callsign} icao24={s.icao24} height={13} maxWidth={22} />
            <span className={`font-semibold ${s.rare ? 'text-atc-yellow' : 'text-white/70'}`}>{label}</span>
            <span className="truncate">
              · {here ? DIRECTION[s.direction] : 'Gone'} · {ago(s.firstAt, now)}
            </span>
          </span>
          <span className={`mt-0.5 block truncate text-subhead font-semibold leading-snug ${here ? 'text-white/90' : 'text-white/55'}`}>
            {s.callsign} <span className="font-normal text-white/60">· {s.name}</span>
          </span>
          <span className="mt-0.5 flex items-start gap-1 text-footnote leading-snug text-white/60">
            {ai && <Sparkles className="mt-[3px] size-3 shrink-0 text-[#C9BCFF]" aria-label="Written by AI" />}
            <span>{line}</span>
          </span>
        </span>
      </button>
    </li>
  )
}

export function SpottedList({ onPick }: { onPick: () => void }) {
  const spots = useSpotted((s) => s.spots)
  const airport = usePlayhead((s) => s.airportIcao)
  const spottedAt = useSpotted((s) => s.airport)
  const liveStatus = usePlayhead((s) => s.liveStatus)
  const select = usePlayhead((s) => s.select)
  const now = useNow(15_000)
  const [all, setAll] = useState(false)
  const list = spottedAt === airport ? spots : []
  const shown = all ? list : list.slice(0, COLLAPSED)

  if (!list.length && liveStatus !== 'ok') return null
  return (
    <section aria-label="Spotted" className="-mx-1 mt-3">
      <SectionLabel>
        Spotted {list.length > 0 && <span className="font-normal tabular-nums text-white/30">{list.length}</span>}
      </SectionLabel>
      {list.length === 0 ? (
        <p className="mx-1 rounded-2xl bg-white/[0.05] px-3.5 py-3 text-footnote text-white/55">Unusual visitors show up here: giant freighters, classic jets, military flights.</p>
      ) : (
        <>
          <ol className="flex flex-col">
            {shown.map((s) => (
              <Row
                key={s.icao24}
                s={s}
                now={now}
                onPick={(x) => {
                  select(x.icao24)
                  onPick()
                }}
              />
            ))}
          </ol>
          {list.length > COLLAPSED && (
            <button type="button" aria-expanded={all} className="pressable ml-1 mt-0.5 flex min-h-9 items-center gap-1 rounded-full px-2 text-footnote font-semibold text-[#C9BCFF] hover:text-white" onClick={() => setAll(!all)}>
              {all ? 'Show less' : `Show all ${list.length}`}
              <ChevronDown aria-hidden className={`size-4 transition-transform duration-[var(--duration-base)] ease-[var(--ease-out)] ${all ? 'rotate-180' : ''}`} strokeWidth={2.5} />
            </button>
          )}
        </>
      )}
    </section>
  )
}
