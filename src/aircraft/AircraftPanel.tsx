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
import { formatLength } from './format'
import { sideProfile } from './sideProfiles'
import { SideView } from './SideView'
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

export function AircraftPanel({ type, category, registration, dbName, dbManufacturer, onGround = false }: Props) {
  const altitudeUnit = useSettings((s) => s.altitudeUnit)
  const profile = aircraftProfile({ type, category, dbName, dbManufacturer })
  const facts = profile.facts
  const isHeli = profile.shape === 'ac-heli'
  const side = sideProfile({ shape: profile.shape, type, lengthM: facts?.lengthM, spanM: facts?.spanM, gear: onGround })
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
        {/* The drawing sits on a faint pool of light, so the pale airframe reads on the dark card. */}
        <div className="relative mx-auto h-[6.5rem] w-full max-w-[22rem]" style={{ backgroundImage: 'radial-gradient(60% 55% at 50% 60%, rgba(140,165,220,0.13), rgba(140,165,220,0) 75%)' }}>
          <SideView profile={side} label={`Side view of ${profile.title ?? 'the aircraft'}`} animKey={`${profile.shape}:${type ?? ''}`} className="absolute inset-x-1 inset-y-2 h-[calc(100%-1rem)] w-[calc(100%-0.5rem)] drop-shadow-[0_5px_6px_rgba(0,0,0,0.4)]" />
        </div>
        <h3 className="mt-2.5 truncate text-subhead font-semibold leading-tight">{title}</h3>
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
