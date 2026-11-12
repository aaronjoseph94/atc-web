/**
 * The selected aircraft's most recent radio call, summarised, for the yellow
 * station bar: the AI's plain-English line when it has one, else the call as
 * shown (cleaned, or as recognised). A dot in the speaker's colour (ATC pink,
 * pilot blue) says who spoke. Nothing heard yet says so quietly.
 */
import { Radio, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useFlight } from '../flight/useFlight'
import { useNow } from '../hooks/useNow'
import { callsFor, useRadio, type Transmission } from '../live/radio/radioStore'
import { useUnderstood } from '../live/radio/understand/store'
import { usePlayhead } from '../playback/playheadStore'
import { speakerColors } from '../ui/speaker'
import { StreamText } from '../ui/textMotion'

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s} s ago`
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

/** The newest finished call about `icao24` on any channel. */
function useLastCall(icao24: string | null): Transmission | null {
  return useRadio((s) => {
    if (!icao24) return null
    const calls = callsFor(s.log, icao24)
    return calls[calls.length - 1] ?? null
  })
}

export function LastCall({ callsign }: { callsign: string }) {
  const icao24 = usePlayhead((s) => s.selectedIcao)
  const call = useLastCall(icao24)
  const understood = useUnderstood(call?.id)
  const now = useNow(10_000)
  const summary = understood?.plain?.trim() || call?.text || null
  const ai = !!understood?.plain?.trim()
  const colors = speakerColors(call?.speaker)
  const who = call?.speaker === 'controller' ? 'Tower' : call?.speaker === 'pilot' ? callsign : null
  // Only a call (or its summary) that arrives while this flight is selected streams in; the one already there just shows.
  const line = call ? `${call.id}:${ai ? 'ai' : 'heard'}` : ''
  const [opened, setOpened] = useState({ icao24, line })
  if (opened.icao24 !== icao24) setOpened({ icao24, line })

  return (
    <div className="mx-3 mb-2 rounded-2xl bg-black/10 px-3 py-2" aria-live="polite" aria-label={`Latest radio call for ${callsign}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-bold text-black/60">
        {ai ? <Sparkles className="size-3" aria-label="Summarised by AI" /> : <Radio className="size-3" aria-hidden />}
        <span className="truncate">Last call · {callsign}</span>
        {call && <span className="ml-auto shrink-0 tabular-nums font-semibold">{ago(now - call.at)}</span>}
      </div>
      {call && summary ? (
        <p className="mt-0.5 flex items-start gap-2 text-[15px] font-semibold leading-snug text-black/90">
          <span className="mt-[0.45em] size-2 shrink-0 rounded-full ring-1 ring-black/20" style={{ background: colors.base }} aria-hidden />
          <span className="line-clamp-2 min-w-0">
            {who && <span className="text-black/60">{who}: </span>}
            <StreamText key={line} id={`last-call:${line}`} text={summary} play={opened.icao24 === icao24 && line !== opened.line} />
          </span>
        </p>
      ) : (
        <p className="mt-0.5 text-[14px] font-medium text-black/60">No radio calls heard for this flight yet.</p>
      )}
    </div>
  )
}

/** The line for whichever aircraft is selected; mounted only while one is. */
export function SelectedLastCall() {
  const flight = useFlight()
  if (!flight) return null
  return <LastCall callsign={flight.callsign} />
}
