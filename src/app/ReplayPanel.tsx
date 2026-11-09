/**
 * Replay chooser. Two kinds of replay share one player:
 *  - "Rewind": the live traffic this session has recorded, scrubbed back in time;
 *  - recorded scenes: bundled tower-radio clips with audio and a transcript.
 */
import { useQuery } from '@tanstack/react-query'
import { History, Play } from 'lucide-react'
import { getAirport } from '../api/airports'
import { getClip, getClipIndex } from '../api/client'
import { liveRecorder } from '../live/session'
import { formatClock } from '../playback/Timeline'
import { usePlayhead } from '../playback/playheadStore'
import { SectionLabel, Sheet } from '../ui/Panel'

const REWINDS: [number, string][] = [
  [2, '2 minutes'],
  [5, '5 minutes'],
  [15, '15 minutes'],
  [45, 'Everything recorded'],
]

export function ReplayPanel() {
  const open = usePlayhead((s) => s.panel === 'replay')
  const mode = usePlayhead((s) => s.mode)
  const airportIcao = usePlayhead((s) => s.airportIcao)
  const stationId = usePlayhead((s) => s.stationId)
  const liveUpdatedAt = usePlayhead((s) => s.liveUpdatedAt)
  const setPanel = usePlayhead((s) => s.setPanel)
  const enterPlayback = usePlayhead((s) => s.enterPlayback)
  const setTMs = usePlayhead((s) => s.setTMs)
  const setToast = usePlayhead((s) => s.setToast)

  const scenes = useQuery({ queryKey: ['clip-index'], queryFn: getClipIndex, staleTime: Infinity, enabled: open, retry: 0 })
  // `liveUpdatedAt` changes on every poll, so the available span stays current while the sheet is open.
  const spanMin = open && liveUpdatedAt ? liveRecorder.spanMs() / 60_000 : 0

  const rewind = (minutes: number) => {
    const clip = liveRecorder.toClip(airportIcao, stationId)
    if (!clip) {
      setToast('Not enough traffic recorded yet. Give it a minute.')
      return
    }
    enterPlayback(clip)
    setTMs(Math.max(0, clip.durationMs - minutes * 60_000))
  }

  const play = async (id: string) => {
    try {
      enterPlayback(await getClip(id))
    } catch {
      setToast({ message: 'That scene couldn’t be loaded. Check your connection and try again.', tone: 'error' })
    }
  }

  return (
    <Sheet open={open} title="Replay" onClose={() => setPanel(null)}>
      <SectionLabel>Rewind {airportIcao}</SectionLabel>
      <div className="rounded-2xl bg-white/[0.05] p-3.5">
        <p className="flex items-start gap-2.5 text-sm leading-relaxed text-white/75">
          <History className="mt-0.5 size-4 shrink-0 text-atc-yellow" />
          {mode === 'playback'
            ? 'Go back to live to rewind what has been recorded.'
            : spanMin < 0.25
              ? 'Traffic is recorded while the app is open. Come back in a moment and you can scrub back through it.'
              : `The last ${spanMin < 1.5 ? 'minute' : `${Math.round(spanMin)} minutes`} of traffic here ${spanMin < 1.5 ? 'is' : 'are'} recorded. Scrub back to watch a landing again.`}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {REWINDS.map(([min, label]) => {
            const enabled = mode === 'live' && spanMin >= 0.25 && (min === 45 || spanMin >= min * 0.6)
            return (
              <button
                key={min}
                type="button"
                disabled={!enabled}
                className="rounded-xl bg-atc-yellow px-3 py-2.5 text-sm font-bold text-black transition hover:brightness-105 active:scale-[0.97] disabled:bg-white/10 disabled:text-white/35"
                onClick={() => rewind(min)}
              >
                {min === 45 ? label : `Back ${label}`}
              </button>
            )
          })}
        </div>
      </div>

      <SectionLabel>Recorded scenes</SectionLabel>
      {scenes.isPending ? (
        <div className="space-y-2">
          <div className="skeleton h-[4.5rem] w-full rounded-2xl" />
          <div className="skeleton h-[4.5rem] w-full rounded-2xl" />
        </div>
      ) : !scenes.data?.length ? (
        <p className="rounded-2xl bg-white/[0.05] p-3.5 text-sm text-atc-muted">No recorded scenes are available right now.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {scenes.data.map((c) => (
            <li key={c.id}>
              <button type="button" className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.05] p-3 text-left transition hover:bg-white/10 active:scale-[0.99]" onClick={() => void play(c.id)}>
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-atc-magenta text-white">
                  <Play className="size-5 translate-x-0.5 fill-current" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{c.title}</span>
                  {c.description && <span className="line-clamp-2 block text-xs leading-snug text-atc-muted">{c.description}</span>}
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-display text-lg leading-none text-atc-yellow">{getAirport(c.airport).icao}</span>
                  <span className="block text-xs tabular-nums text-atc-muted">{formatClock(c.durationMs)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-[11px] leading-relaxed text-atc-muted">
        Scenes are scripted and voiced by a speech synthesizer, with aircraft moving on the real runways. Recordings of real tower radio can’t be redistributed, so none are bundled.
      </p>
    </Sheet>
  )
}
