/**
 * The aircraft, in a compact card for the flight view: a side view of its
 * type (fin in the airline's colour, gear down when it is on the ground)
 * beside its name, maker and registration, then the type's key numbers as
 * small chips. The map keeps its top-view icons; this card is the only place
 * the side views appear.
 *
 * Unknown types are drawn by their class and show no numbers.
 */
import { useAirlineLogo } from '../airline/useAirlineLogo'
import { brandColour } from '../map/fx/brand'
import { useSettings } from '../settings/settingsStore'
import { formatCruise, formatLength, formatRange } from './format'
import { sideProfile } from './sideProfiles'
import { SideView } from './SideView'
import { aircraftProfile, describeEngines } from './types'

type Props = {
  /** ICAO type designator from the feed, e.g. "B738". */
  type: string | null | undefined
  /** ADS-B emitter category, used when the type is unknown. */
  category?: string | null
  registration?: string | null
  /** Airframe description from the registration database, e.g. "A321 231SL". */
  dbName?: string | null
  dbManufacturer?: string | null
  /** For the fin colour. */
  callsign?: string | null
  icao24?: string | null
  /** Draws the landing gear. */
  onGround?: boolean
}

function Chip({ label, value }: { label?: string; value: string }) {
  return (
    <li className="flex items-baseline gap-1 whitespace-nowrap rounded-full bg-white/[0.07] px-2 py-0.5 text-caption ring-1 ring-white/[0.05]">
      {label && <span className="text-white/45">{label}</span>}
      <span className="font-semibold tabular-nums text-white/90">{value}</span>
    </li>
  )
}

export function AircraftPanel({ type, category, registration, dbName, dbManufacturer, callsign, icao24, onGround = false }: Props) {
  const altitudeUnit = useSettings((s) => s.altitudeUnit)
  const speedUnit = useSettings((s) => s.speedUnit)
  // Re-renders once the airline's logo has loaded, when its colour can be read.
  useAirlineLogo(callsign, icao24)
  const profile = aircraftProfile({ type, category, dbName, dbManufacturer })
  const facts = profile.facts
  const isHeli = profile.shape === 'ac-heli'
  const side = sideProfile({ shape: profile.shape, type, lengthM: facts?.lengthM, spanM: facts?.spanM, gear: onGround })
  const fin = callsign && icao24 ? brandColour(callsign, icao24) || null : null
  const title = profile.title ?? 'Aircraft type not reported'
  const kind = facts ? `${facts.kind}${facts.firstFlight != null ? ` · since ${facts.firstFlight}` : ''}` : profile.title ? 'No specifications on file' : 'Type not reported; drawn by its class'

  const cruise = facts?.cruise ? formatCruise(facts.cruise, speedUnit) : null
  const chips: { label?: string; value: string }[] = facts
    ? [
        { value: describeEngines(facts.engines) },
        ...(facts.spanM != null ? [{ label: isHeli ? 'Rotor' : 'Span', value: formatLength(facts.spanM, altitudeUnit) }] : []),
        ...(facts.lengthM != null ? [{ label: 'Length', value: formatLength(facts.lengthM, altitudeUnit) }] : []),
        ...(facts.seats ? [{ value: `${facts.seats} seats` }] : []),
        ...(facts.rangeNm != null ? [{ label: 'Range', value: formatRange(facts.rangeNm, speedUnit) }] : []),
        ...(cruise ? [cruise.startsWith('Mach') ? { value: cruise } : { label: 'Cruise', value: cruise }] : []),
      ]
    : []

  return (
    <section aria-label="Aircraft" className="mb-4 overflow-hidden rounded-2xl bg-white/[0.06] ring-1 ring-white/[0.04]">
      <div className="flex items-center gap-3 px-3 pt-3">
        {/* The drawing sits on a faint pool of light, so the white airframe reads on the dark sheet. */}
        <div
          className="relative h-[4.25rem] w-[44%] max-w-[13rem] shrink-0 rounded-xl"
          style={{ backgroundImage: 'radial-gradient(70% 60% at 50% 62%, rgba(124,150,210,0.16), rgba(124,150,210,0) 72%)' }}
        >
          <SideView profile={side} fin={fin} label={`Side view of ${profile.title ?? 'the aircraft'}`} animKey={`${profile.shape}:${type ?? ''}`} className="absolute inset-x-1 inset-y-1.5 h-[calc(100%-0.75rem)] w-[calc(100%-0.5rem)] drop-shadow-[0_4px_5px_rgba(0,0,0,0.45)]" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-subhead font-bold leading-tight">{title}</h3>
          <p className="line-clamp-2 text-caption text-white/55">{kind}</p>
          {registration && (
            <span className="mt-1.5 inline-block rounded-md bg-white/10 px-1.5 py-px font-mono text-caption2 font-semibold tracking-wider text-white/85 ring-1 ring-white/10" title="Registration">
              {registration}
            </span>
          )}
        </div>
      </div>
      {chips.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5 px-3 pb-3 pt-2.5" aria-label="Type facts">
          {chips.map((c) => (
            <Chip key={`${c.label ?? ''}${c.value}`} {...c} />
          ))}
        </ul>
      ) : (
        <div className="h-3" />
      )}
    </section>
  )
}
