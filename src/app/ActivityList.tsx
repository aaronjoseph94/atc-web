/**
 * Recent activity on the airfield: takeoffs, landings, go-arounds, line-ups
 * and emergencies as they are detected from the traffic, newest first, each
 * with its colour-coded badge. A few show at once; "Show all" opens the last
 * twenty. Tapping one selects the aircraft (if it is still in range).
 *
 * These used to sit among the radio calls in the transcript; they live here,
 * with the traffic, so the transcript is only what was said on the radio.
 */
import { ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { AirlineLogo } from '../airline/AirlineLogo'
import { useNow } from '../hooks/useNow'
import { useHistory } from '../live/history/store'
import { liveBuffer } from '../live/session'
import { usePlayhead } from '../playback/playheadStore'
import { EventBadge } from '../ui/EventBadge'
import { eventStyle } from '../ui/eventStyle'
import { SectionLabel } from '../ui/Panel'
import { recentActivity, type Activity } from './activity'

/** Rows shown before "Show all", and the most "Show all" opens. */
const COLLAPSED = 3
const LIMIT = 20

/** `just now`, `12 min ago`, then the clock time. */
function ago(at: number, now: number): string {
  const min = Math.round((now - at) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function Row({ a, now, onPick }: { a: Activity; now: number; onPick: (a: Activity) => void }) {
  const style = eventStyle(a.kind)
  const here = !!a.icao24 && !!liveBuffer.get(a.icao24)
  return (
    <li>
      <button
        type="button"
        aria-disabled={!here || undefined}
        title={here ? undefined : 'No longer in range'}
        className="pressable-soft flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left enabled:hover:bg-white/[0.07] aria-disabled:cursor-default"
        onClick={() => here && onPick(a)}
      >
        <EventBadge kind={a.kind} size={26} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-caption font-medium tabular-nums text-white/45">
            <AirlineLogo callsign={a.callsign} icao24={a.icao24} height={13} maxWidth={22} />
            <span className="font-semibold" style={{ color: style.color }}>
              {style.label}
            </span>
            <span>· {ago(a.at, now)}</span>
          </span>
          <span className={`mt-0.5 block text-subhead font-semibold leading-snug ${here ? 'text-white/90' : 'text-white/55'}`}>{a.text}</span>
        </span>
      </button>
    </li>
  )
}

export function ActivityList({ onPick }: { onPick: () => void }) {
  const airport = usePlayhead((s) => s.airportIcao)
  const events = usePlayhead((s) => s.events)
  const liveStatus = usePlayhead((s) => s.liveStatus)
  const select = usePlayhead((s) => s.select)
  const history = useHistory((s) => s.entries)
  const now = useNow(15_000)
  const [all, setAll] = useState(false)
  const list = useMemo(() => recentActivity(history, events, airport, LIMIT), [history, events, airport])
  const shown = all ? list : list.slice(0, COLLAPSED)

  if (!list.length && liveStatus !== 'ok') return null
  return (
    <section aria-label="Recent activity" className="-mx-1 mt-3">
      <SectionLabel>Recent activity</SectionLabel>
      {list.length === 0 ? (
        <p className="mx-1 rounded-2xl bg-white/[0.05] px-3.5 py-3 text-footnote text-white/55">Takeoffs, landings and go-arounds show up here as they happen.</p>
      ) : (
        <>
          <ol className="flex flex-col">
            {shown.map((a) => (
              <Row
                key={a.id}
                a={a}
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
