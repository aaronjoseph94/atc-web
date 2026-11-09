/**
 * The replay strip inside the yellow bar: transport, clock, and a timeline
 * with one block per transmission. Drag anywhere on it to scrub; arrow keys
 * step five seconds.
 */
import { Gauge, Pause, Play, Radio } from 'lucide-react'
import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { ClipPack } from '../api/types'
import { RATES, usePlayhead } from './playheadStore'

export function formatClock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`
}

/** "12 min ago", "just now": how far behind live a replay moment is. */
export function agoLabel(ms: number) {
  const s = Math.round(ms / 1000)
  if (s < 20) return 'just now'
  if (s < 90) return `${s} s ago`
  return `${Math.round(s / 60)} min ago`
}

export function Timeline({ clip, label }: { clip: ClipPack; label: string }) {
  const tMs = usePlayhead((s) => s.tMs)
  const playing = usePlayhead((s) => s.playing)
  const rate = usePlayhead((s) => s.rate)
  const setTMs = usePlayhead((s) => s.setTMs)
  const setPlaying = usePlayhead((s) => s.setPlaying)
  const setRate = usePlayhead((s) => s.setRate)
  const exitPlayback = usePlayhead((s) => s.exitPlayback)
  const track = useRef<HTMLDivElement>(null)
  const wasPlaying = useRef(false)

  const dur = clip.durationMs || 1
  const rewind = clip.kind === 'rewind'
  const at = Math.min(tMs, dur)

  const seekTo = (clientX: number) => {
    const el = track.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setTMs(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * dur)
  }
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    wasPlaying.current = playing
    // Hold the clock while dragging so the playhead stays under the finger.
    if (playing) setPlaying(false)
    seekTo(e.clientX)
  }
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) seekTo(e.clientX)
  }
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (wasPlaying.current) setPlaying(true)
  }
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 15_000 : 5_000
    if (e.key === 'ArrowRight') setTMs(Math.min(dur, at + step))
    else if (e.key === 'ArrowLeft') setTMs(Math.max(0, at - step))
    else if (e.key === 'Home') setTMs(0)
    else if (e.key === 'End') setTMs(dur)
    else return
    e.preventDefault()
  }

  const clock = rewind && clip.startedAt != null ? new Date(clip.startedAt + at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : `${formatClock(at)} / ${formatClock(dur)}`
  const nextRate = RATES[(RATES.indexOf(rate) + 1) % RATES.length]

  return (
    <div className="px-4 pb-[max(0.75rem,var(--safe-bottom))] pt-2.5 md:pb-3">
      <div className="truncate text-center text-[13px] font-semibold text-black/80">{label}</div>
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          aria-label={playing ? 'Pause' : 'Play'}
          className="grid size-10 shrink-0 place-items-center rounded-full text-black transition hover:bg-black/10 active:scale-90"
          onClick={() => setPlaying(!playing)}
        >
          {playing ? <Pause className="size-6 fill-current" /> : <Play className="size-6 translate-x-0.5 fill-current" />}
        </button>
        <span className="rounded-lg bg-black/10 px-2.5 py-1 text-[13px] font-semibold tabular-nums text-black/85">{clock}</span>
        {rewind && (
          <button
            type="button"
            aria-label={`Playback speed ${rate}×. Change to ${nextRate}×`}
            className="flex items-center gap-1 rounded-lg bg-black/10 px-2 py-1 text-[13px] font-semibold tabular-nums text-black/85 transition hover:bg-black/20 active:scale-95"
            onClick={() => setRate(nextRate)}
          >
            <Gauge className="size-3.5" />
            {rate}×
          </button>
        )}
        <button
          type="button"
          className="ml-auto flex items-center gap-1.5 rounded-full bg-black px-3 py-1.5 text-xs font-bold text-white transition hover:bg-black/80 active:scale-95"
          onClick={exitPlayback}
        >
          <Radio className="size-3.5 text-atc-live" /> Back to live
        </button>
      </div>

      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Replay position"
        aria-valuemin={0}
        aria-valuemax={Math.round(dur / 1000)}
        aria-valuenow={Math.round(at / 1000)}
        aria-valuetext={clock}
        className="relative mt-2 h-9 cursor-ew-resize touch-none select-none"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
      >
        {/* Ruler */}
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-black/20" />
        {/* One block per transmission: controller magenta, pilot red, logged events purple. */}
        {clip.cues.map((c) => {
          const pilot = /pilot/i.test(c.speaker ?? '')
          const log = /log/i.test(c.speaker ?? '')
          return (
            <span
              key={c.id}
              className={`absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full ${log ? 'bg-atc-card' : pilot ? 'bg-[#E5323B]' : 'bg-atc-magenta'} ${at >= c.startMs && at < c.endMs ? 'scale-y-[1.6] brightness-110' : ''} transition-transform duration-150`}
              style={{ left: `${(c.startMs / dur) * 100}%`, width: `max(3px, ${((c.endMs - c.startMs) / dur) * 100}%)` }}
            />
          )
        })}
        {/* Playhead */}
        <span className="absolute top-0 h-full w-0.5 -translate-x-1/2 rounded-full bg-black" style={{ left: `${(at / dur) * 100}%` }}>
          <span className="absolute -top-1 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-black" />
        </span>
      </div>
    </div>
  )
}
