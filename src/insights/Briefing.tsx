/**
 * The airport briefing on screen: a dismissible card over the station bar
 * (phones) or at the top of the side panel (desktop) when an airport opens
 * and every twenty minutes after, and a quieter block in the weather panel.
 *
 * `useBriefingSchedule` (hooks.ts, run once in Insights) gathers the numbers
 * at those moments into the insights store; everything here reads them from
 * there, so the card and the weather panel share one AI request.
 */
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { usePlayhead } from '../playback/playheadStore'
import { useDockActive } from '../ui/layout'
import { usePresence } from '../ui/usePresence'
import { AiMark } from './AiMark'
import { useBriefingText } from './hooks'
import { useInsights } from './insightsStore'

/** The card tucks itself away after this long unless someone is reading it. */
const CARD_MS = 30_000

/**
 * The card. `docked`: the side panel's version. Each layout shows it only
 * where it belongs (the phone card hides while a flight card is up).
 */
export function BriefingCard({ docked = false }: { docked?: boolean }) {
  const open = useInsights((s) => s.briefingOpen)
  const close = useInsights((s) => s.closeBriefing)
  const dockActive = useDockActive()
  // Out of the way while a flight is open: the phone's card sits where the flight card goes, and the side panel is the flight's.
  const quiet = usePlayhead((s) => s.mode === 'live' && s.sheet === 'closed' && !s.selectedIcao)
  const here = docked ? dockActive && quiet : !dockActive && quiet
  const { mounted, closing } = usePresence(open && here, 200)
  const brief = useBriefingText()
  const airport = usePlayhead((s) => s.airportIcao)
  const [hold, setHold] = useState(false)

  // Away on its own after a while, unless a pointer or focus is on it.
  useEffect(() => {
    if (!open || !here || hold) return
    const id = window.setTimeout(close, CARD_MS)
    return () => window.clearTimeout(id)
  }, [open, here, hold, close])

  if (!mounted || !brief) return null
  return (
    <section
      aria-label={`${airport} briefing`}
      data-closing={closing ? '' : undefined}
      onPointerEnter={() => setHold(true)}
      onPointerLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={() => setHold(false)}
      className={
        docked
          ? 'motion-rise mx-3 mb-2 shrink-0 rounded-2xl bg-atc-card/20 px-3.5 pb-3 pt-2.5 ring-1 ring-inset ring-atc-card/45'
          : 'motion-rise pointer-events-auto mx-3 mb-2 w-[calc(100%-1.5rem)] rounded-2xl glass-pop px-3.5 pb-3 pt-2.5 text-white shadow-pop ring-1 ring-white/[0.12] md:w-[min(92vw,40rem)]'
      }
    >
      <div className="flex items-center gap-2">
        <span className="rounded bg-atc-yellow px-1.5 py-0.5 font-display text-xs leading-none tracking-wide text-black">{airport}</span>
        <span className="flex min-w-0 flex-1 items-center gap-1 text-caption font-semibold text-white/60">
          Right now
          {brief.ai && <AiMark />}
        </span>
        <button type="button" aria-label="Dismiss briefing" className="pressable -mr-1.5 grid size-7 shrink-0 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white" onClick={close}>
          <X className="size-4" />
        </button>
      </div>
      <p className="mt-1.5 text-subhead leading-snug text-white/90">{brief.text}</p>
    </section>
  )
}

/** The weather panel's copy: always there once gathered, no dismiss. */
export function BriefingBlock() {
  const brief = useBriefingText()
  if (!brief) return null
  return (
    <section aria-label="Airport briefing" className="mt-5 rounded-2xl bg-atc-card/[0.16] px-3.5 py-3 ring-1 ring-inset ring-atc-card/40">
      <div className="flex items-center gap-1 text-caption font-semibold text-white/65">
        At the airport now
        {brief.ai && <AiMark />}
      </div>
      <p className="mt-1 text-subhead leading-snug text-white/90">{brief.text}</p>
    </section>
  )
}
