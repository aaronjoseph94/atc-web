/**
 * The aircraft, in a compact card for the flight view: a side view of its
 * type (gear down when it is on the ground), its name, one quiet line with
 * the registration and what kind of aircraft it is, and three key numbers.
 * The map keeps its top-view icons; this card is the only place the side
 * views appear.
 *
 * Unknown types are drawn by their class and show no numbers.
 */
import { useSettings } from '../settings/settingsStore'
import { SectionLabel } from '../ui/Panel'
import airlinerTop from './art/airliner-top.webp'
import { formatLength } from './format'
import { aircraftProfile, type TypeFacts } from './types'

type Props = {
  /** ICAO type designator from the feed, e.g. "B738". */
  type: string | null | undefined
  /** ADS-B emitter category, used when the type is unknown. */
  category?: string | null
  registration?: string | null
  /** Airframe description from the registration database, e.g. "A321 231SL". */
  dbName?: string | null
  dbManufacturer?: string | null
  /** Accepted for the callers' convenience; the drawing carries no livery. */
  callsign?: string | null
  icao24?: string | null
  /** Draws the landing gear. */
  onGround?: boolean
}

/** "4 turbofans", "1 piston". */
function engines(e: TypeFacts['engines']): string {
  return `${e.count} ${e.type}${e.count === 1 ? '' : 's'}`
}

export function AircraftPanel({ type, category, registration, dbName, dbManufacturer }: Props) {
  const altitudeUnit = useSettings((s) => s.altitudeUnit)
  const profile = aircraftProfile({ type, category, dbName, dbManufacturer })
  const facts = profile.facts
  const isHeli = profile.shape === 'ac-heli'
  const title = profile.title ?? 'Aircraft type not reported'
  const about = facts ? [facts.kind, facts.firstFlight != null ? `since ${facts.firstFlight}` : null] : [profile.title ? 'No specifications on file' : 'Drawn by its class']

  const stats: { label: string; value: string }[] = facts
    ? [
        { label: 'Engines', value: engines(facts.engines) },
        ...(facts.lengthM != null ? [{ label: 'Length', value: formatLength(facts.lengthM, altitudeUnit) }] : []),
        ...(facts.spanM != null ? [{ label: isHeli ? 'Rotor' : 'Wingspan', value: formatLength(facts.spanM, altitudeUnit) }] : []),
      ]
    : []

  return (
    <section aria-label="Aircraft" className="mt-5">
      <SectionLabel>Aircraft</SectionLabel>
      <div className="ui-card overflow-hidden px-4 pb-3.5 pt-3">
        {/* The owner's artwork: one generic airliner, seen from above, for every fixed-wing type. Helicopters have none yet. */}
        {!isHeli && (
          <div className="mb-3 flex justify-center pt-1">
            <img src={airlinerTop} alt="" width={560} height={526} loading="lazy" decoding="async" draggable={false} className="h-32 w-auto select-none drop-shadow-[0_10px_14px_rgba(0,0,0,0.45)]" />
          </div>
        )}
        <h3 className="truncate text-subhead font-semibold leading-tight">{title}</h3>
        <p className="mt-0.5 truncate text-caption text-white/50">
          {registration && (
            <>
              <span className="font-mono tracking-wide text-white/75" title="Registration">
                {registration}
              </span>
              <span aria-hidden> · </span>
            </>
          )}
          {about.filter(Boolean).join(' · ')}
        </p>
        {stats.length > 0 && (
          <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-white/[0.07] pt-2.5" aria-label="Type facts">
            {stats.map((s) => (
              <div key={s.label} className="min-w-0">
                <dt className="text-caption2 text-white/40">{s.label}</dt>
                <dd className="truncate text-footnote font-medium tabular-nums text-white/80">{s.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  )
}
