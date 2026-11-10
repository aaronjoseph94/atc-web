/**
 * "What did I miss?": offered when the app comes back to the foreground after
 * five minutes or more away (if the person wants that), or opened from the
 * menu for the last half hour. A summary (AI-written when possible), the
 * counts, and the notable moments with their times.
 */
import { useState } from 'react'
import { useHistory } from '../live/history/store'
import { liveBuffer } from '../live/session'
import { usePlayhead } from '../playback/playheadStore'
import { Segmented, Sheet } from '../ui/Panel'
import { useAiTask } from './ai'
import { AiMark } from './AiMark'
import { buildCatchUp, fallbackCatchUp } from './catchUpModel'
import { openCatchUp } from './hooks'
import { useInsights } from './insightsStore'
import { parseCatchUp } from './parse'
import { localClock } from './weatherBrief'

const WINDOWS: [number, string][] = [
  [15, '15 min'],
  [30, '30 min'],
  [60, '1 h'],
  [180, '3 h'],
]

export function CatchUpSheet() {
  const w = useInsights((s) => s.catchUp)
  const close = useInsights((s) => s.closeCatchUp)
  const airport = usePlayhead((s) => s.airportIcao)
  return (
    <Sheet open={!!w} title={w?.auto ? `While you were away from ${airport}` : `What did I miss at ${airport}?`} onClose={close}>
      {w && <Body key={`${w.since}-${w.until}`} since={w.since} until={w.until} auto={w.auto} />}
    </Sheet>
  )
}

function Body({ since, until, auto }: { since: number; until: number; auto: boolean }) {
  const airport = usePlayhead((s) => s.airportIcao)
  // Built once per window: the history keeps growing while the sheet is open, and the summary shouldn't shift under the reader.
  const [built] = useState(() => buildCatchUp({ airport, since, until, entries: useHistory.getState().entries, alerts: useInsights.getState().alerts, runwayLog: useInsights.getState().runwayLog, clock: localClock }))
  const quiet = built.input.moments.length === 0 && built.input.runwayChanges.length === 0
  // Nothing at all to summarise isn't worth a request.
  const empty = quiet && built.input.counts.takeoffs + built.input.counts.landings + built.input.counts.radioCalls === 0
  const ai = useAiTask('catchUp', empty ? null : built.input, parseCatchUp, 5 * 60_000)
  const shown = ai.data ?? fallbackCatchUp(built.input)
  const minutes = Math.round((until - since) / 60_000)
  const c = built.input.counts

  return (
    <>
      {!auto && (
        <div className="mb-3 flex justify-center">
          <Segmented label="How far back" value={WINDOWS.some(([m]) => m === minutes) ? minutes : 30} options={WINDOWS} onChange={(m) => openCatchUp(m)} />
        </div>
      )}
      <div className="rounded-2xl bg-atc-card/15 px-3.5 py-3 ring-1 ring-inset ring-atc-card/40" aria-live="polite">
        <p className="text-body leading-snug text-white/90">
          {ai.data && <AiMark className="mr-1" />}
          {shown.summary}
        </p>
      </div>
      <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
        {(
          [
            ['Takeoffs', c.takeoffs],
            ['Landings', c.landings],
            ['Go-arounds', c.goArounds],
            ['Calls', c.radioCalls],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-2xl bg-white/[0.05] px-1 py-2.5">
            <dd className="text-title3 font-semibold tabular-nums">{v}</dd>
            <dt className="text-caption text-white/55">{k}</dt>
          </div>
        ))}
      </dl>
      {shown.highlights.length > 0 && (
        <>
          <h3 className="mb-2 mt-5 px-1 text-footnote font-semibold text-white/55">Worth knowing</h3>
          <ul className="space-y-1.5">
            {shown.highlights.map((h, i) => (
              <li key={i} className="rounded-2xl bg-white/[0.05] px-3.5 py-2.5 text-subhead leading-snug text-white/85">
                {h}
              </li>
            ))}
          </ul>
        </>
      )}
      {built.moments.some((m) => m.icao24 && liveBuffer.get(m.icao24)) && (
        <p className="mt-3 px-1 text-caption text-white/45">Some of these aircraft are still on the map: find them in Traffic.</p>
      )}
      {empty && <p className="mt-3 px-1 text-footnote text-white/55">Nothing was logged in that time. The history fills in while the app is open at this airport.</p>}
    </>
  )
}
