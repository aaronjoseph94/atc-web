/**
 * Play/pause for the live radio, and the one-line status that goes with it.
 * Lives on the yellow station bar.
 */
import { Loader2, Pause, Play, VolumeX } from 'lucide-react'
import { useRadio, statusText } from '../live/radio/radioStore'
import { toggleRadio } from '../live/radio/useLiveRadio'

/** The big round play/pause. Starting audio needs a tap, which this is. */
export function RadioButton({ label }: { label: string }) {
  const on = useRadio((s) => s.on)
  const status = useRadio((s) => s.status)
  const playing = on && (status === 'live' || status === 'buffering' || status === 'connecting' || status === 'reconnecting' || status === 'offline')
  const waiting = status === 'connecting' || status === 'buffering' || status === 'reconnecting'
  // An offline feed is still being waited on (the status line counts down to the next try), and tapping stops that wait: so it shows pause, not a retry arrow that would promise the opposite.
  const Icon = status === 'nofeed' ? VolumeX : playing ? Pause : Play
  const name = status === 'nofeed' ? `No live audio for ${label}` : playing ? `Stop listening to ${label}` : `Listen live to ${label}`
  return (
    <button
      type="button"
      data-no-drag
      onClick={() => toggleRadio()}
      aria-label={name}
      title={name}
      aria-pressed={playing}
      className={`relative grid size-12 shrink-0 place-items-center rounded-full shadow-[0_2px_10px_rgba(0,0,0,0.25)] transition active:scale-90 ${
        status === 'nofeed' ? 'bg-black/15 text-black/60' : 'bg-black text-atc-yellow hover:bg-black/85'
      }`}
    >
      {waiting && <Loader2 aria-hidden className="absolute size-12 animate-spin text-atc-yellow/70 [stroke-width:1]" />}
      <Icon className={`size-5 ${Icon === Play || Icon === Pause ? 'fill-current' : ''} ${Icon === Play ? 'translate-x-px' : ''}`} strokeWidth={2.5} />
    </button>
  )
}

/** "● Live · KJFK Tower 119.1", plus transcript trouble when there is any. */
export function RadioStatusLine() {
  const on = useRadio((s) => s.on)
  const status = useRadio((s) => s.status)
  const retryInS = useRadio((s) => s.retryInS)
  const feed = useRadio((s) => s.feed)
  const transcripts = useRadio((s) => s.transcripts)
  if (!on || status === 'off') return null
  const text = statusText(status, retryInS)
  const note =
    transcripts === 'unavailable'
      ? 'Transcripts need the deployed site'
      : transcripts === 'limited'
        ? 'Transcripts paused'
        : transcripts === 'error'
          ? 'Transcripts unavailable'
          : null
  return (
    <p className="flex min-w-0 items-center gap-1.5 px-4 pb-0.5 text-[11px] font-semibold leading-4 text-black/70" role="status" aria-live="polite">
      {/* A slow, calm breath (not a blink): on the air, nothing urgent. */}
      {status === 'live' && <span className="size-1.5 shrink-0 animate-[pulse-dot_3.6s_ease-in-out_infinite] rounded-full bg-atc-live shadow-[0_0_6px_1px_rgba(255,59,48,0.45)]" />}
      <span className="shrink-0 uppercase tracking-wide">{text}</span>
      {note && status === 'live' ? (
        <span className="min-w-0 truncate font-medium text-black/55">· {note}</span>
      ) : (
        feed && status !== 'nofeed' && <span className="min-w-0 truncate font-medium text-black/55">· {feed.name}</span>
      )}
    </p>
  )
}
